import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/media/store.js';
import { MediaCache } from '../src/media/cache.js';
import { DriveClient, DriveError, parseDriveLink, normalizeMeta, FOLDER_MIME } from '../src/media/drive.js';

// ---------- ferramentas ----------

function bytes(n, seed) {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 31 + (seed || 0)) & 255;
  return b;
}

function remoteOf(data, extra) {
  return Object.assign({ size: data.length, md5Checksum: 'md5-a', modifiedTime: '2026-01-01T00:00:00Z', name: 'v.mp4', mimeType: 'video/mp4' }, extra || {});
}

// "Drive" falso: devolve pedaços de `data`, contando as chamadas.
function fakeRemote(data) {
  const calls = [];
  const fn = async (start, end) => { calls.push([start, end]); return data.slice(start, end + 1); };
  fn.calls = calls;
  return fn;
}

// quota calculada a partir do que há de fato no store (como o navegador faria)
function quotaFor(store, total) {
  return async () => {
    const files = await store.list();
    return { quota: total, usage: files.reduce((s, f) => s + f.size, 0) };
  };
}

function newCache(opts) {
  const store = new MemoryStore();
  let clock = 1000;
  const cache = new MediaCache(Object.assign({ store, chunkSize: 10, reserveBytes: 0, quota: quotaFor(store, 1e9), now: () => ++clock }, opts || {}));
  return { store, cache };
}

async function fileBytes(file) { return new Uint8Array(await file.arrayBuffer()); }

// ---------- MemoryStore ----------

test('store em memória: gravar em posição, crescer, truncar, listar, apagar', async () => {
  const s = new MemoryStore();
  await s.write('a.bin', 0, new Uint8Array([1, 2, 3]));
  await s.write('a.bin', 5, new Uint8Array([9]));
  assert.deepEqual(Array.from(await fileBytes(await s.getFile('a.bin'))), [1, 2, 3, 0, 0, 9]);
  await s.truncate('a.bin', 2);
  assert.equal(await s.size('a.bin'), 2);
  await s.writeText('m.json', '{"x":"é"}');
  assert.equal(await s.readText('m.json'), '{"x":"é"}');
  assert.equal(await s.readText('nada'), null);
  assert.equal(await s.getFile('nada'), null);
  assert.deepEqual((await s.list()).map(f => f.name).sort(), ['a.bin', 'm.json']);
  await s.remove('a.bin');
  assert.equal(await s.size('a.bin'), 0);
});

// ---------- cache ----------

test('baixa em pedaços, avisa o progresso e guarda o arquivo inteiro', async () => {
  const { cache } = newCache();
  const data = bytes(35, 1);
  const fetchRange = fakeRemote(data);
  const progress = [];
  const file = await cache.ensure('F1', remoteOf(data), { fetchRange, onProgress: (d, t) => progress.push(d + '/' + t) });
  assert.deepEqual(Array.from(await fileBytes(file)), Array.from(data));
  assert.deepEqual(fetchRange.calls, [[0, 9], [10, 19], [20, 29], [30, 34]]);
  assert.deepEqual(progress, ['0/35', '10/35', '20/35', '30/35', '35/35']);
  assert.deepEqual(await cache.status('F1', remoteOf(data)), { state: 'complete', downloaded: 35, size: 35 });
});

test('pedir de novo o que já está completo não baixa nada', async () => {
  const { cache } = newCache();
  const data = bytes(25, 2);
  const f1 = fakeRemote(data);
  await cache.ensure('F1', remoteOf(data), { fetchRange: f1 });
  const f2 = fakeRemote(data);
  const file = await cache.ensure('F1', remoteOf(data), { fetchRange: f2 });
  assert.equal(f2.calls.length, 0);
  assert.equal((await fileBytes(file)).length, 25);
  assert.ok(await cache.open('F1', remoteOf(data)));
  assert.equal(await cache.open('F2', remoteOf(data)), null);
});

test('download interrompido continua de onde parou (não recomeça)', async () => {
  const { cache } = newCache();
  const data = bytes(50, 3);
  let n = 0;
  const flaky = async (s, e) => { if (++n === 3) throw new Error('rede caiu'); return data.slice(s, e + 1); };
  await assert.rejects(cache.ensure('F1', remoteOf(data), { fetchRange: flaky }), /rede caiu/);
  const st = await cache.status('F1', remoteOf(data));
  assert.deepEqual(st, { state: 'partial', downloaded: 20, size: 50 });
  const again = fakeRemote(data);
  const file = await cache.ensure('F1', remoteOf(data), { fetchRange: again });
  assert.deepEqual(again.calls[0], [20, 29]); // retomou do byte 20
  assert.deepEqual(Array.from(await fileBytes(file)), Array.from(data));
});

test('cancelar para no meio e deixa o que já baixou pra retomar depois', async () => {
  const { cache } = newCache();
  const data = bytes(40, 4);
  const ctl = new AbortController();
  let n = 0;
  const fetchRange = async (s, e) => { if (++n === 2) ctl.abort(); return data.slice(s, e + 1); };
  await assert.rejects(cache.ensure('F1', remoteOf(data), { fetchRange, signal: ctl.signal }), (e) => e.name === 'AbortError');
  assert.equal((await cache.status('F1', remoteOf(data))).state, 'partial');
  const file = await cache.ensure('F1', remoteOf(data), { fetchRange: fakeRemote(data) });
  assert.deepEqual(Array.from(await fileBytes(file)), Array.from(data));
});

test('se o arquivo mudou no Drive, descarta o antigo e baixa de novo', async () => {
  const { cache } = newCache();
  const v1 = bytes(30, 5), v2 = bytes(30, 99);
  await cache.ensure('F1', remoteOf(v1), { fetchRange: fakeRemote(v1) });
  assert.equal((await cache.status('F1', remoteOf(v2, { md5Checksum: 'md5-b' }))).state, 'none');
  const fr = fakeRemote(v2);
  const file = await cache.ensure('F1', remoteOf(v2, { md5Checksum: 'md5-b' }), { fetchRange: fr });
  assert.equal(fr.calls.length, 3);
  assert.deepEqual(Array.from(await fileBytes(file)), Array.from(v2));
});

test('pedaço incompleto do Drive vira erro claro e não marca como pronto', async () => {
  const { cache } = newCache();
  const data = bytes(30, 6);
  const curto = async (s, e) => data.slice(s, e); // um byte a menos
  await assert.rejects(cache.ensure('F1', remoteOf(data), { fetchRange: curto }), /incompleto/);
  assert.notEqual((await cache.status('F1', remoteOf(data))).state, 'complete');
});

test('dois pedidos ao mesmo tempo dividem UM download e os dois recebem o progresso', async () => {
  const { cache } = newCache();
  const data = bytes(30, 7);
  const fr = fakeRemote(data);
  const a = [], b = [];
  const p1 = cache.ensure('F1', remoteOf(data), { fetchRange: fr, onProgress: (d) => a.push(d) });
  const p2 = cache.ensure('F1', remoteOf(data), { fetchRange: fr, onProgress: (d) => b.push(d) });
  const [f1, f2] = await Promise.all([p1, p2]);
  assert.equal(fr.calls.length, 3);
  assert.equal(f1.size, f2.size);
  assert.ok(a.length >= 3 && b.length >= 1 && b[b.length - 1] === 30);
});

test('lixo no disco além do que o registro diz é cortado antes de continuar', async () => {
  const { store, cache } = newCache();
  const data = bytes(40, 8);
  await cache.ensure('F1', remoteOf(data), { fetchRange: async (s, e) => { if (s >= 20) throw new Error('parou'); return data.slice(s, e + 1); } }).catch(() => {});
  await store.write('F1.bin', 20, new Uint8Array([7, 7, 7, 7, 7])); // caiu a energia depois de gravar e antes de anotar
  const file = await cache.ensure('F1', remoteOf(data), { fetchRange: fakeRemote(data) });
  assert.deepEqual(Array.from(await fileBytes(file)), Array.from(data));
});

test('registro diz que baixou mais do que existe no disco: recomeça do zero', async () => {
  const { store, cache } = newCache();
  const data = bytes(30, 9);
  await cache.ensure('F1', remoteOf(data), { fetchRange: async (s, e) => { if (s >= 20) throw new Error('parou'); return data.slice(s, e + 1); } }).catch(() => {});
  await store.truncate('F1.bin', 5);
  const fr = fakeRemote(data);
  const file = await cache.ensure('F1', remoteOf(data), { fetchRange: fr });
  assert.deepEqual(fr.calls[0], [0, 9]);
  assert.deepEqual(Array.from(await fileBytes(file)), Array.from(data));
});

test('sem espaço: apaga os usados há mais tempo, nunca o que está sendo baixado', async () => {
  const store = new MemoryStore();
  let clock = 0;
  const cache = new MediaCache({ store, chunkSize: 50, reserveBytes: 0, quota: quotaFor(store, 1000), now: () => ++clock });
  const a = bytes(400, 1), b = bytes(400, 2), c = bytes(300, 3);
  await cache.ensure('A', remoteOf(a), { fetchRange: fakeRemote(a) });
  await cache.ensure('B', remoteOf(b), { fetchRange: fakeRemote(b) });
  await cache.open('A', remoteOf(a)); // A foi usado agora há pouco -> B é o mais antigo
  const file = await cache.ensure('C', remoteOf(c), { fetchRange: fakeRemote(c) });
  assert.equal(file.size, 300);
  const left = (await cache.listCached()).map(m => m.fileId).sort();
  assert.deepEqual(left, ['A', 'C']);
});

test('sem espaço mesmo depois de apagar tudo que dava: erro em português com os números', async () => {
  const store = new MemoryStore();
  const cache = new MediaCache({ store, chunkSize: 50, reserveBytes: 0, quota: quotaFor(store, 100), now: () => 1 });
  const big = bytes(500, 1);
  await assert.rejects(cache.ensure('X', remoteOf(big), { fetchRange: fakeRemote(big) }), /Sem espaço suficiente/);
});

test('a folga reservada conta: não encosta no limite do navegador', async () => {
  const store = new MemoryStore();
  const cache = new MediaCache({ store, chunkSize: 50, reserveBytes: 200, quota: quotaFor(store, 1000), now: () => 1 });
  const d = bytes(850, 1);
  await assert.rejects(cache.ensure('X', remoteOf(d), { fetchRange: fakeRemote(d) }), /Sem espaço/);
  const ok = bytes(800, 1);
  await cache.ensure('Y', remoteOf(ok), { fetchRange: fakeRemote(ok) });
});

test('arquivo de 0 bytes também fecha certo', async () => {
  const { cache } = newCache();
  const file = await cache.ensure('Z', remoteOf(new Uint8Array(0)), { fetchRange: fakeRemote(new Uint8Array(0)) });
  assert.equal(file.size, 0);
  assert.equal((await cache.status('Z', remoteOf(new Uint8Array(0)))).state, 'complete');
});

test('remover tira dados e registro', async () => {
  const { store, cache } = newCache();
  const d = bytes(20, 1);
  await cache.ensure('F1', remoteOf(d), { fetchRange: fakeRemote(d) });
  assert.equal(await cache.usage() > 20, true);
  await cache.remove('F1');
  assert.equal(await cache.usage(), 0);
  assert.equal((await store.list()).length, 0);
});

// ---------- links e API do Drive ----------

test('reconhece links de arquivo e de pasta como o servidor reconhece', () => {
  const id = 'AAAAAAAAAAAAAAAAAAAAAAAAA';
  assert.deepEqual(parseDriveLink('https://drive.google.com/file/d/' + id + '/view?usp=sharing'), { kind: 'file', id });
  assert.deepEqual(parseDriveLink('https://drive.google.com/open?id=' + id), { kind: 'file', id });
  assert.deepEqual(parseDriveLink('https://drive.google.com/uc?export=download&id=' + id), { kind: 'file', id });
  assert.deepEqual(parseDriveLink('https://drive.google.com/drive/folders/' + id + '?usp=sharing'), { kind: 'folder', id });
  assert.deepEqual(parseDriveLink('https://drive.google.com/drive/u/1/folders/' + id), { kind: 'folder', id });
  assert.equal(parseDriveLink('https://youtube.com/watch?v=abc'), null);
  assert.equal(parseDriveLink(''), null);
  assert.equal(parseDriveLink(null), null);
});

function json(obj, status) { return new Response(JSON.stringify(obj), { status: status || 200 }); }

function makeClient(handler, extra) {
  const calls = [];
  let tokens = 0;
  const client = new DriveClient(Object.assign({
    getToken: async (force) => { if (force) tokens++; return 'tok' + tokens; },
    fetchImpl: async (url, init) => { calls.push({ url, init }); return handler(url, init, calls.length); },
    sleep: async () => {},
    retries: 3
  }, extra || {}));
  return { client, calls, tokens: () => tokens };
}

test('getMeta pede os campos certos com o token e normaliza a resposta', async () => {
  const { client, calls } = makeClient(() => json({
    id: 'F', name: 'raw.mp4', mimeType: 'video/mp4', size: '545906688', md5Checksum: 'abc', modifiedTime: '2026-01-02T00:00:00Z',
    videoMediaMetadata: { width: 1920, height: 1080, durationMillis: '567000' }
  }));
  const m = await client.getMeta('F');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok0');
  assert.match(calls[0].url, /fields=.*videoMediaMetadata/);
  assert.match(calls[0].url, /supportsAllDrives=true/);
  assert.deepEqual(m, { id: 'F', name: 'raw.mp4', mimeType: 'video/mp4', isFolder: false, size: 545906688, md5Checksum: 'abc', modifiedTime: '2026-01-02T00:00:00Z', width: 1920, height: 1080, durationUs: 567000000 });
  assert.equal(normalizeMeta({ id: 'P', mimeType: FOLDER_MIME }).isFolder, true);
});

test('lista pasta: junta as páginas e só deixa vídeo e áudio', async () => {
  const pages = [
    { files: [{ id: '1', name: 'a.mp4', mimeType: 'video/mp4', size: '10' }, { id: '2', name: 'nota.txt', mimeType: 'text/plain' }, { id: '3', name: 'sub', mimeType: FOLDER_MIME }], nextPageToken: 'P2' },
    { files: [{ id: '4', name: 'b.mp3', mimeType: 'audio/mpeg', size: '5' }] }
  ];
  const { client, calls } = makeClient((url) => json(url.indexOf('pageToken=P2') !== -1 ? pages[1] : pages[0]));
  const files = await client.listFolder('PASTA');
  assert.deepEqual(files.map(f => f.name), ['a.mp4', 'b.mp3']);
  assert.equal(calls.length, 2);
  assert.match(decodeURIComponent(calls[0].url), /'PASTA' in parents and trashed=false/);
  const onlyVideo = await makeClient(() => json(pages[1])).client.listFolder('PASTA', { mimePrefixes: ['video/'] });
  assert.deepEqual(onlyVideo, []);
});

test('baixa um intervalo com o cabeçalho Range; se o servidor mandar o arquivo todo, recorta', async () => {
  const data = bytes(100, 1);
  const { client, calls } = makeClient((url, init) => {
    const m = /bytes=(\d+)-(\d+)/.exec(init.headers.Range);
    return new Response(data.slice(Number(m[1]), Number(m[2]) + 1), { status: 206 });
  });
  const got = await client.fetchRange('F', 10, 19);
  assert.deepEqual(Array.from(got), Array.from(data.slice(10, 20)));
  assert.equal(calls[0].init.headers.Range, 'bytes=10-19');
  const ignorou = makeClient(() => new Response(data, { status: 200 })).client;
  assert.deepEqual(Array.from(await ignorou.fetchRange('F', 10, 19)), Array.from(data.slice(10, 20)));
});

test('401: pede token novo uma vez e repete; se continuar 401, avisa que a sessão venceu', async () => {
  let n = 0;
  const { client, tokens } = makeClient(() => (++n === 1 ? json({}, 401) : json({ id: 'F', name: 'x', mimeType: 'video/mp4' })));
  const m = await client.getMeta('F');
  assert.equal(m.id, 'F');
  assert.equal(tokens(), 1);
  const sempre401 = makeClient(() => json({}, 401));
  await assert.rejects(sempre401.client.getMeta('F'), (e) => e instanceof DriveError && e.status === 401 && /sessão com o Drive expirou/.test(e.message));
  assert.equal(sempre401.tokens(), 1);
});

test('erro 5xx e 429 tentam de novo; passou do limite, vira erro claro', async () => {
  let n = 0;
  const { client, calls } = makeClient(() => (++n < 3 ? json({}, 503) : json({ id: 'F', name: 'x', mimeType: 'video/mp4' })));
  assert.equal((await client.getMeta('F')).id, 'F');
  assert.equal(calls.length, 3);
  await assert.rejects(makeClient(() => json({}, 500)).client.getMeta('F'), /erro 500/);
  await assert.rejects(makeClient(() => json({}, 429)).client.getMeta('F'), /mais devagar/);
});

test('404 e 403 viram mensagens em português', async () => {
  await assert.rejects(makeClient(() => json({}, 404)).client.getMeta('F'), /Não encontrei o arquivo no Drive/);
  await assert.rejects(makeClient(() => json({}, 403)).client.listFolder('P'), /recusou o acesso a pasta/);
});

test('sem internet: tenta algumas vezes e avisa; cancelamento passa direto', async () => {
  let n = 0;
  const offline = makeClient(() => { n++; throw new TypeError('Failed to fetch'); });
  await assert.rejects(offline.client.getMeta('F'), /Sem conexão/);
  assert.equal(n, 4);
  const abort = makeClient(() => { const e = new Error('abortado'); e.name = 'AbortError'; throw e; });
  await assert.rejects(abort.client.fetchRange('F', 0, 9), (e) => e.name === 'AbortError');
});
