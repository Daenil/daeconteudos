// Onde os arquivos baixados ficam. Duas implementações da MESMA interface:
//  - OpfsStore: o armazenamento privado do navegador (OPFS) — é o que o editor usa de verdade.
//  - MemoryStore: tudo na memória — usado nos testes automatizados.
//
// Interface: list(), size(name), readText(name), writeText(name, text), write(name, position, bytes),
//            truncate(name, size), remove(name), getFile(name)   (nomes planos, sem pastas)

export class MemoryStore {
  constructor() { this.files = new Map(); }

  async list() {
    return Array.from(this.files.entries()).map(function (e) { return { name: e[0], size: e[1].length }; });
  }

  async size(name) { return this.files.has(name) ? this.files.get(name).length : 0; }

  async readText(name) {
    const b = this.files.get(name);
    return b ? new TextDecoder().decode(b) : null;
  }

  async writeText(name, text) { this.files.set(name, new TextEncoder().encode(text)); }

  async write(name, position, bytes) {
    const cur = this.files.get(name) || new Uint8Array(0);
    const need = position + bytes.length;
    const next = need > cur.length ? new Uint8Array(need) : cur;
    if (next !== cur) next.set(cur);
    next.set(bytes, position);
    this.files.set(name, next);
  }

  async truncate(name, size) {
    const cur = this.files.get(name) || new Uint8Array(0);
    const next = new Uint8Array(size);
    next.set(cur.subarray(0, Math.min(size, cur.length)));
    this.files.set(name, next);
  }

  async remove(name) { this.files.delete(name); }

  async getFile(name) {
    const b = this.files.get(name);
    return b ? new File([b], name) : null;
  }
}

export class OpfsStore {
  constructor(dirName) {
    this._dirName = dirName || 'dae-media';
    this._dir = null;
  }

  async _root() {
    if (!this._dir) {
      const root = await navigator.storage.getDirectory();
      this._dir = await root.getDirectoryHandle(this._dirName, { create: true });
    }
    return this._dir;
  }

  async _handle(name, create) {
    const dir = await this._root();
    try { return await dir.getFileHandle(name, { create: !!create }); }
    catch (e) { if (e && e.name === 'NotFoundError') return null; throw e; }
  }

  async list() {
    const dir = await this._root();
    const out = [];
    for await (const entry of dir.values()) {
      if (entry.kind !== 'file') continue;
      const f = await entry.getFile();
      out.push({ name: entry.name, size: f.size });
    }
    return out;
  }

  async size(name) {
    const h = await this._handle(name, false);
    return h ? (await h.getFile()).size : 0;
  }

  async readText(name) {
    const h = await this._handle(name, false);
    return h ? await (await h.getFile()).text() : null;
  }

  async writeText(name, text) {
    const h = await this._handle(name, true);
    const w = await h.createWritable();
    await w.write(text);
    await w.close();
  }

  // Cada gravação abre e FECHA o arquivo: só o que foi fechado fica no disco, então um download
  // interrompido (aba fechada, queda de energia) continua de onde o último pedaço terminou.
  async write(name, position, bytes) {
    const h = await this._handle(name, true);
    const w = await h.createWritable({ keepExistingData: true });
    await w.write({ type: 'write', position: position, data: bytes });
    await w.close();
  }

  async truncate(name, size) {
    const h = await this._handle(name, true);
    const w = await h.createWritable({ keepExistingData: true });
    await w.truncate(size);
    await w.close();
  }

  async remove(name) {
    const dir = await this._root();
    try { await dir.removeEntry(name); }
    catch (e) { if (!(e && e.name === 'NotFoundError')) throw e; }
  }

  async getFile(name) {
    const h = await this._handle(name, false);
    return h ? await h.getFile() : null;
  }
}
