import { frameDurationUs } from './time.js';

// Modelo do projeto de edição (JSON puro, salvo na pasta do corte no Drive).
//
//   { schema, videoUid, name, canvas:{width,height,fps}, assets:{id:Asset},
//     videoTracks:[Track], audioTracks:[Track], nextId }
//
// - Faixas de vídeo: índice 0 = a de baixo; as seguintes ficam por cima (ordem de composição).
// - Faixas de áudio: ordem só visual. Qualquer quantidade de faixas dos dois tipos (até o limite).
// - Todo tempo é inteiro em microssegundos (ver time.js).
export const SCHEMA = 1;
export const MAX_TRACKS_PER_KIND = 12;

export function defaultTransform() {
  return { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, crop: { l: 0, t: 0, r: 0, b: 0 } };
}

export function minClipDur(p) { return frameDurationUs(p.canvas.fps); }

export function newId(p, prefix) { return prefix + (p.nextId++); }

export function tracksOf(p, kind) {
  if (kind === 'video') return p.videoTracks;
  if (kind === 'audio') return p.audioTracks;
  throw new Error('Tipo de faixa inválido: ' + kind);
}

export function allTracks(p) { return p.videoTracks.concat(p.audioTracks); }

export function findTrack(p, trackId) {
  return allTracks(p).filter(function (t) { return t.id === trackId; })[0] || null;
}

export function findClip(p, clipId) {
  const tracks = allTracks(p);
  for (let i = 0; i < tracks.length; i++) {
    const clip = tracks[i].clips.filter(function (c) { return c.id === clipId; })[0];
    if (clip) return { track: tracks[i], clip: clip };
  }
  return null;
}

export function clipEnd(clip) { return clip.start + clip.dur; }

export function projectDuration(p) {
  let end = 0;
  allTracks(p).forEach(function (t) { t.clips.forEach(function (c) { end = Math.max(end, clipEnd(c)); }); });
  return end;
}

function nextTrackName(p, kind) {
  const base = kind === 'video' ? 'Vídeo ' : 'Áudio ';
  const used = new Set(tracksOf(p, kind).map(function (t) { return t.name; }));
  for (let n = 1; ; n++) if (!used.has(base + n)) return base + n;
}

export function createProject(opts) {
  opts = opts || {};
  const p = {
    schema: SCHEMA,
    videoUid: opts.videoUid || '',
    name: opts.name || '',
    canvas: Object.assign({ width: 1080, height: 1920, fps: 30 }, opts.canvas || {}),
    assets: {},
    videoTracks: [],
    audioTracks: [],
    nextId: 1
  };
  // começa com 2 faixas de cada tipo; o editor cria/remove quantas quiser depois
  addTrack(p, 'video'); addTrack(p, 'video');
  addTrack(p, 'audio'); addTrack(p, 'audio');
  return p;
}

// ---------- mídias ----------

// source: { type:'drive', fileId } (arquivo que já está no Drive) ou { type:'project', fileId } (importado
// do computador e guardado na pasta do projeto)
export function addAsset(p, spec) {
  if (!spec || !spec.kind || !spec.source || !spec.source.fileId) throw new Error('Mídia inválida.');
  const existing = findAssetBySource(p, spec.source.fileId);
  if (existing) return existing;
  const asset = {
    id: newId(p, 'A'),
    kind: spec.kind,
    name: spec.name || 'sem nome',
    source: { type: spec.source.type || 'drive', fileId: spec.source.fileId },
    durationUs: spec.durationUs == null ? null : Math.round(spec.durationUs),
    width: spec.width || null,
    height: spec.height || null,
    hasAudio: spec.hasAudio == null ? null : !!spec.hasAudio,
    size: spec.size || null,
    mimeType: spec.mimeType || ''
  };
  p.assets[asset.id] = asset;
  return asset;
}

export function findAssetBySource(p, fileId) {
  const ids = Object.keys(p.assets);
  for (let i = 0; i < ids.length; i++) if (p.assets[ids[i]].source.fileId === fileId) return p.assets[ids[i]];
  return null;
}

export function removeAsset(p, assetId) {
  if (!p.assets[assetId]) throw new Error('Mídia não encontrada.');
  const used = allTracks(p).some(function (t) { return t.clips.some(function (c) { return c.assetId === assetId; }); });
  if (used) throw new Error('Essa mídia ainda está sendo usada na timeline.');
  delete p.assets[assetId];
}

// ---------- faixas ----------

export function addTrack(p, kind, opts) {
  opts = opts || {};
  const list = tracksOf(p, kind);
  if (list.length >= MAX_TRACKS_PER_KIND) {
    throw new Error('Limite de ' + MAX_TRACKS_PER_KIND + ' faixas de ' + (kind === 'video' ? 'vídeo' : 'áudio') + ' atingido.');
  }
  const track = {
    id: newId(p, 'T'),
    kind: kind,
    name: (opts.name && String(opts.name).trim()) || nextTrackName(p, kind),
    muted: false,
    locked: false,
    hidden: false,
    volume: 1,
    clips: []
  };
  const index = opts.index == null ? list.length : Math.max(0, Math.min(list.length, opts.index));
  list.splice(index, 0, track);
  return track;
}

export function removeTrack(p, trackId) {
  const track = findTrack(p, trackId);
  if (!track) throw new Error('Faixa não encontrada.');
  const list = tracksOf(p, track.kind);
  if (list.length <= 1) throw new Error('Precisa existir pelo menos uma faixa de ' + (track.kind === 'video' ? 'vídeo' : 'áudio') + '.');
  if (track.locked) throw new Error('A faixa "' + track.name + '" está bloqueada.');
  const gone = new Set(track.clips.map(function (c) { return c.id; }));
  list.splice(list.indexOf(track), 1);
  // clipes ligados (vídeo+áudio) das faixas que sobraram perdem o par que foi embora
  allTracks(p).forEach(function (t) {
    t.clips.forEach(function (c) {
      if (c.linkId && !allTracks(p).some(function (o) { return o.clips.some(function (x) { return x !== c && x.linkId === c.linkId; }); })) c.linkId = null;
    });
  });
  return gone.size;
}

export function renameTrack(p, trackId, name) {
  const track = findTrack(p, trackId);
  if (!track) throw new Error('Faixa não encontrada.');
  name = String(name || '').trim();
  if (!name) throw new Error('Dê um nome à faixa.');
  if (name.length > 40) throw new Error('Nome de faixa muito longo (máximo 40 letras).');
  track.name = name;
}

export function setTrackFlags(p, trackId, flags) {
  const track = findTrack(p, trackId);
  if (!track) throw new Error('Faixa não encontrada.');
  ['muted', 'locked', 'hidden'].forEach(function (k) { if (flags && flags[k] !== undefined) track[k] = !!flags[k]; });
  if (flags && flags.volume !== undefined) {
    const v = Number(flags.volume);
    if (!(v >= 0 && v <= 4)) throw new Error('Volume da faixa precisa estar entre 0 e 400%.');
    track.volume = v;
  }
}

// Move a faixa uma posição pra cima (+1) ou pra baixo (-1) dentro do próprio tipo.
export function moveTrack(p, trackId, delta) {
  const track = findTrack(p, trackId);
  if (!track) throw new Error('Faixa não encontrada.');
  const list = tracksOf(p, track.kind);
  const from = list.indexOf(track);
  const to = Math.max(0, Math.min(list.length - 1, from + delta));
  if (to === from) return false;
  list.splice(from, 1);
  list.splice(to, 0, track);
  return true;
}

// ---------- validação ----------

function isInt(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }

function assetFitsTrack(asset, track) {
  if (track.kind === 'video') return asset.kind === 'video' || asset.kind === 'image';
  return asset.kind === 'audio' || asset.kind === 'video'; // áudio de um vídeo vira clipe de áudio ligado
}

// Confere TODAS as regras do modelo. Lança Error com a primeira que falhar.
export function validate(p) {
  if (!p || typeof p !== 'object') throw new Error('Projeto inválido.');
  if (p.schema !== SCHEMA) throw new Error('Versão de projeto desconhecida: ' + p.schema);
  const c = p.canvas;
  if (!c || !(c.width > 0) || !(c.height > 0) || !(c.fps > 0)) throw new Error('Tela do projeto inválida.');
  if (!Array.isArray(p.videoTracks) || !Array.isArray(p.audioTracks)) throw new Error('Faixas inválidas.');
  if (!p.videoTracks.length || !p.audioTracks.length) throw new Error('Precisa existir pelo menos uma faixa de cada tipo.');
  if (p.videoTracks.length > MAX_TRACKS_PER_KIND || p.audioTracks.length > MAX_TRACKS_PER_KIND) throw new Error('Faixas demais.');

  const minDur = minClipDur(p);
  const trackIds = new Set(), clipIds = new Set();
  const linkCount = {};
  [['video', p.videoTracks], ['audio', p.audioTracks]].forEach(function (pair) {
    pair[1].forEach(function (t) {
      if (t.kind !== pair[0]) throw new Error('Faixa "' + t.name + '" está na lista errada.');
      if (!t.id || trackIds.has(t.id)) throw new Error('Id de faixa repetido: ' + t.id);
      trackIds.add(t.id);
      if (!Array.isArray(t.clips)) throw new Error('Faixa sem lista de clipes.');
      let prevEnd = 0;
      t.clips.forEach(function (clip, i) {
        if (!clip.id || clipIds.has(clip.id)) throw new Error('Id de clipe repetido: ' + clip.id);
        clipIds.add(clip.id);
        const asset = p.assets[clip.assetId];
        if (!asset) throw new Error('O clipe ' + clip.id + ' usa uma mídia que não existe.');
        if (!assetFitsTrack(asset, t)) throw new Error('A mídia "' + asset.name + '" não cabe numa faixa de ' + t.kind + '.');
        if (!isInt(clip.start) || clip.start < 0) throw new Error('Início inválido no clipe ' + clip.id + '.');
        if (!isInt(clip.dur) || clip.dur < minDur) throw new Error('Duração inválida no clipe ' + clip.id + '.');
        if (!isInt(clip.srcIn) || clip.srcIn < 0) throw new Error('Ponto de entrada inválido no clipe ' + clip.id + '.');
        if (!(clip.speed > 0)) throw new Error('Velocidade inválida no clipe ' + clip.id + '.');
        if (i > 0 && clip.start < prevEnd) throw new Error('Clipes se sobrepõem na faixa "' + t.name + '".');
        prevEnd = clip.start + clip.dur;
        if (asset.kind !== 'image' && asset.durationUs != null) {
          const srcEnd = clip.srcIn + Math.round(clip.dur * clip.speed);
          if (srcEnd > asset.durationUs + minDur) throw new Error('O clipe ' + clip.id + ' passa do fim da mídia "' + asset.name + '".');
        }
        if (clip.linkId) linkCount[clip.linkId] = (linkCount[clip.linkId] || 0) + 1;
      });
    });
  });
  Object.keys(linkCount).forEach(function (id) {
    if (linkCount[id] < 2) throw new Error('Grupo de clipes ligados incompleto: ' + id);
  });
}

// ---------- gravar / ler ----------

export function serialize(p) { return JSON.stringify(p); }

// Completa campos que versões antigas do projeto não tinham (o modelo vai crescendo).
function fillDefaults(p) {
  allTracks(p).forEach(function (t) {
    if (t.volume === undefined) t.volume = 1;
    if (t.hidden === undefined) t.hidden = false;
    if (t.locked === undefined) t.locked = false;
    if (t.muted === undefined) t.muted = false;
    t.clips.forEach(function (c) {
      if (c.speed === undefined) c.speed = 1;
      if (c.linkId === undefined) c.linkId = null;
      if (c.enabled === undefined) c.enabled = true;
      if (c.volume === undefined) c.volume = 1;
      if (c.fit === undefined) c.fit = 'cover';
      c.transform = Object.assign(defaultTransform(), c.transform || {});
      c.transform.crop = Object.assign({ l: 0, t: 0, r: 0, b: 0 }, c.transform.crop || {});
    });
  });
  return p;
}

export function deserialize(text) {
  let o;
  try { o = JSON.parse(text); } catch (e) { throw new Error('O arquivo do projeto está corrompido.'); }
  if (!o || typeof o !== 'object') throw new Error('O arquivo do projeto está corrompido.');
  if (o.schema > SCHEMA) throw new Error('Esse projeto foi salvo por uma versão mais nova do editor. Recarregue a página (F5) e tente de novo.');
  fillDefaults(o);
  validate(o);
  return o;
}
