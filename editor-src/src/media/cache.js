// Cache dos vídeos baixados do Drive no armazenamento do navegador.
//
//  - Baixa em pedaços de 8 MB e guarda o progresso: se a aba fechar no meio, continua de onde parou.
//  - Se o arquivo mudou no Drive (tamanho, md5 ou data), joga fora o que tinha e baixa de novo.
//  - Se faltar espaço, apaga os baixados há mais tempo (e só eles) até caber.
const MB = 1024 * 1024;

export const DEFAULT_CHUNK = 8 * MB;
export const DEFAULT_RESERVE = 256 * MB; // folga que sempre deixamos livre no navegador

function abortError() {
  const e = new Error('Download cancelado.');
  e.name = 'AbortError';
  return e;
}

export async function browserQuota() {
  const est = await navigator.storage.estimate();
  return { quota: est.quota || 0, usage: est.usage || 0 };
}

export class MediaCache {
  // store: MemoryStore/OpfsStore. quota(): Promise<{quota, usage}>.
  constructor(opts) {
    this.store = opts.store;
    this.quota = opts.quota || browserQuota;
    this.chunkSize = opts.chunkSize || DEFAULT_CHUNK;
    this.reserve = opts.reserveBytes == null ? DEFAULT_RESERVE : opts.reserveBytes;
    this.now = opts.now || Date.now;
    this._inflight = new Map();
  }

  _metaName(id) { return id + '.json'; }
  _dataName(id) { return id + '.bin'; }

  async _readMeta(id) {
    const text = await this.store.readText(this._metaName(id));
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  async _writeMeta(meta) { await this.store.writeText(this._metaName(meta.fileId), JSON.stringify(meta)); }

  // O arquivo no Drive ainda é o mesmo que baixamos?
  _same(meta, remote) {
    return meta.size === Number(remote.size) &&
      (meta.md5 || '') === (remote.md5Checksum || '') &&
      (meta.modifiedTime || '') === (remote.modifiedTime || '');
  }

  // 'none' | 'partial' | 'complete' (e quanto já baixou), sem tocar em nada.
  async status(id, remote) {
    const meta = await this._readMeta(id);
    const total = Number(remote.size);
    if (!meta || !this._same(meta, remote)) return { state: 'none', downloaded: 0, size: total };
    if (meta.complete) return { state: 'complete', downloaded: total, size: total };
    return { state: meta.downloaded > 0 ? 'partial' : 'none', downloaded: meta.downloaded, size: total };
  }

  // O arquivo, se já estiver completo e atual; senão null.
  async open(id, remote) {
    const meta = await this._readMeta(id);
    if (!meta || !meta.complete || !this._same(meta, remote)) return null;
    meta.lastUsed = this.now();
    await this._writeMeta(meta);
    return this.store.getFile(this._dataName(id));
  }

  async remove(id) {
    await this.store.remove(this._dataName(id));
    await this.store.remove(this._metaName(id));
  }

  async listCached() {
    const files = await this.store.list();
    const out = [];
    for (let i = 0; i < files.length; i++) {
      if (!/\.json$/.test(files[i].name)) continue;
      const meta = await this._readMeta(files[i].name.replace(/\.json$/, ''));
      if (meta) out.push(meta);
    }
    return out;
  }

  async usage() {
    const files = await this.store.list();
    return files.reduce(function (sum, f) { return sum + f.size; }, 0);
  }

  // Apaga os mais antigos (menos usados) até sobrar `needed` + folga. `protect`: ids que não podem sair.
  async _makeRoom(needed, protect) {
    const free = async () => { const q = await this.quota(); return q.quota - q.usage; };
    if ((await free()) >= needed + this.reserve) return;
    const metas = (await this.listCached())
      .filter(function (m) { return !protect.has(m.fileId); })
      .sort(function (a, b) { return (a.lastUsed || 0) - (b.lastUsed || 0); });
    for (let i = 0; i < metas.length; i++) {
      await this.remove(metas[i].fileId);
      if ((await free()) >= needed + this.reserve) return;
    }
    const left = await free();
    throw new Error('Sem espaço suficiente no navegador para baixar esse vídeo (precisa de ' +
      Math.ceil(needed / MB) + ' MB, restam ' + Math.max(0, Math.floor((left - this.reserve) / MB)) + ' MB). Feche outros projetos ou libere espaço.');
  }

  // Garante o arquivo inteiro no cache e devolve o File. remote: { size, md5Checksum?, modifiedTime?, name?, mimeType? }.
  // fetchRange(start, endInclusive, signal) -> Uint8Array. Chamadas simultâneas pro mesmo arquivo dividem o mesmo download.
  ensure(id, remote, opts) {
    opts = opts || {};
    const existing = this._inflight.get(id);
    if (existing) {
      if (opts.onProgress) existing.listeners.add(opts.onProgress);
      return existing.promise;
    }
    const entry = { listeners: new Set(opts.onProgress ? [opts.onProgress] : []), promise: null };
    entry.promise = this._download(id, remote, opts, entry).finally(() => { this._inflight.delete(id); });
    this._inflight.set(id, entry);
    return entry.promise;
  }

  async _download(id, remote, opts, entry) {
    const total = Number(remote.size);
    if (!(total >= 0)) throw new Error('Não sei o tamanho desse arquivo no Drive.');
    const signal = opts.signal;
    const progress = function (done) { entry.listeners.forEach(function (cb) { cb(done, total); }); };
    const dataName = this._dataName(id);

    let meta = await this._readMeta(id);
    if (meta && !this._same(meta, remote)) { await this.remove(id); meta = null; }
    if (meta && meta.complete && (await this.store.size(dataName)) === total) {
      meta.lastUsed = this.now();
      await this._writeMeta(meta);
      progress(total);
      return this.store.getFile(dataName);
    }
    if (!meta || meta.complete) {
      meta = {
        fileId: id, name: remote.name || '', size: total, md5: remote.md5Checksum || '', modifiedTime: remote.modifiedTime || '',
        mimeType: remote.mimeType || '', downloaded: 0, complete: false, lastUsed: this.now()
      };
    }
    // o que está no disco precisa bater com o que o registro diz que já baixou
    const onDisk = await this.store.size(dataName);
    if (onDisk < meta.downloaded) meta.downloaded = 0;
    if (onDisk > meta.downloaded) await this.store.truncate(dataName, meta.downloaded);

    await this._makeRoom(total - meta.downloaded, new Set([id]));
    meta.lastUsed = this.now();
    await this._writeMeta(meta);
    progress(meta.downloaded);

    while (meta.downloaded < total) {
      if (signal && signal.aborted) throw abortError();
      const start = meta.downloaded;
      const end = Math.min(start + this.chunkSize, total) - 1;
      const bytes = await opts.fetchRange(start, end, signal);
      if (signal && signal.aborted) throw abortError();
      if (bytes.length !== end - start + 1) throw new Error('O Drive devolveu um pedaço incompleto do vídeo. Tente baixar de novo.');
      await this.store.write(dataName, start, bytes);
      meta.downloaded = end + 1;
      meta.lastUsed = this.now();
      await this._writeMeta(meta);
      progress(meta.downloaded);
    }
    if (total === 0) await this.store.write(dataName, 0, new Uint8Array(0));
    if ((await this.store.size(dataName)) !== total) {
      await this.remove(id);
      throw new Error('O arquivo baixado não tem o tamanho esperado. Tente baixar de novo.');
    }
    meta.complete = true;
    await this._writeMeta(meta);
    return this.store.getFile(dataName);
  }
}
