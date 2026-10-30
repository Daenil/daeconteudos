import { allTracks, clipEnd, defaultTransform, findClip, findTrack, minClipDur, newId } from './project.js';

// Operações de edição sobre um projeto. Todas MEXEM no projeto recebido e lançam Error quando algo
// não pode ser feito — por isso devem rodar sempre dentro de History.edit(), que trabalha numa cópia
// e descarta tudo se der erro. Clipes "ligados" (mesmo linkId — o vídeo e o áudio dele) andam juntos
// em dividir, apagar, aparar e mover.

const IMAGE_DEFAULT_DUR = 5000000; // 5 s

function sortClips(track) { track.clips.sort(function (a, b) { return a.start - b.start; }); }

function mustFindClip(p, clipId) {
  const f = findClip(p, clipId);
  if (!f) throw new Error('Clipe não encontrado.');
  return f;
}

function mustFindTrack(p, trackId) {
  const t = findTrack(p, trackId);
  if (!t) throw new Error('Faixa não encontrada.');
  return t;
}

// O clipe + todos os ligados a ele (inclui o próprio).
export function linkedGroup(p, clipId) {
  const f = mustFindClip(p, clipId);
  if (!f.clip.linkId) return [f];
  const group = [];
  allTracks(p).forEach(function (t) {
    t.clips.forEach(function (c) { if (c.linkId === f.clip.linkId) group.push({ track: t, clip: c }); });
  });
  return group;
}

function assertTrackUnlocked(track) {
  if (track.locked) throw new Error('A faixa "' + track.name + '" está bloqueada.');
}

function assertNoOverlap(track, start, dur, ignore) {
  const end = start + dur;
  for (let i = 0; i < track.clips.length; i++) {
    const c = track.clips[i];
    if (ignore && ignore.indexOf(c) !== -1) continue;
    if (start < clipEnd(c) && end > c.start) throw new Error('Já existe um clipe nesse trecho da faixa "' + track.name + '".');
  }
}

function neighborBounds(track, clip, ignore) {
  let prevEnd = 0, nextStart = Infinity;
  track.clips.forEach(function (c) {
    if (c === clip || (ignore && ignore.indexOf(c) !== -1)) return;
    if (clipEnd(c) <= clip.start) prevEnd = Math.max(prevEnd, clipEnd(c));
    else if (c.start >= clipEnd(clip)) nextStart = Math.min(nextStart, c.start);
  });
  return { prevEnd: prevEnd, nextStart: nextStart };
}

function assetOf(p, clip) { return p.assets[clip.assetId]; }

// ---------- adicionar ----------

// Coloca uma mídia numa faixa. spec: { assetId, start, dur?, srcIn?, linkId? }
export function addClip(p, trackId, spec) {
  const track = mustFindTrack(p, trackId);
  assertTrackUnlocked(track);
  const asset = p.assets[spec.assetId];
  if (!asset) throw new Error('Mídia não encontrada.');
  const ok = track.kind === 'video' ? (asset.kind === 'video' || asset.kind === 'image') : (asset.kind === 'audio' || asset.kind === 'video');
  if (!ok) throw new Error('Essa mídia não pode ir numa faixa de ' + (track.kind === 'video' ? 'vídeo' : 'áudio') + '.');

  const srcIn = Math.round(spec.srcIn || 0);
  let dur = spec.dur;
  if (dur == null) {
    if (asset.kind === 'image') dur = IMAGE_DEFAULT_DUR;
    else if (asset.durationUs != null) dur = asset.durationUs - srcIn;
    else throw new Error('Não sei a duração dessa mídia ainda.');
  }
  dur = Math.round(dur);
  const start = Math.round(spec.start || 0);
  assertNoOverlap(track, start, dur);
  const clip = {
    id: newId(p, 'C'), assetId: asset.id, start: start, dur: dur, srcIn: srcIn, speed: 1,
    linkId: spec.linkId || null, enabled: true, volume: 1, fit: 'cover', transform: defaultTransform()
  };
  track.clips.push(clip);
  sortClips(track);
  return clip;
}

// Atalho para o caso mais comum: jogar um vídeo na timeline cria o clipe de vídeo E (se tiver áudio)
// o clipe de áudio ligado a ele. opts: { start, videoTrackId, audioTrackId, srcIn, dur }
export function addAssetToTimeline(p, assetId, opts) {
  const asset = p.assets[assetId];
  if (!asset) throw new Error('Mídia não encontrada.');
  const created = [];
  if (asset.kind === 'audio') {
    if (!opts.audioTrackId) throw new Error('Escolha uma faixa de áudio.');
    created.push(addClip(p, opts.audioTrackId, { assetId: assetId, start: opts.start, srcIn: opts.srcIn, dur: opts.dur }));
    return created;
  }
  if (!opts.videoTrackId) throw new Error('Escolha uma faixa de vídeo.');
  const withAudio = asset.kind === 'video' && asset.hasAudio !== false && !!opts.audioTrackId;
  const linkId = withAudio ? newId(p, 'L') : null;
  const video = addClip(p, opts.videoTrackId, { assetId: assetId, start: opts.start, srcIn: opts.srcIn, dur: opts.dur, linkId: linkId });
  created.push(video);
  if (withAudio) {
    created.push(addClip(p, opts.audioTrackId, { assetId: assetId, start: video.start, srcIn: video.srcIn, dur: video.dur, linkId: linkId }));
  }
  return created;
}

// ---------- dividir ----------

export function splitClip(p, clipId, at) {
  at = Math.round(at);
  const group = linkedGroup(p, clipId);
  const md = minClipDur(p);
  group.forEach(function (g) {
    assertTrackUnlocked(g.track);
    if (at - g.clip.start < md || clipEnd(g.clip) - at < md) throw new Error('Esse ponto está colado demais na borda do clipe.');
  });
  const newLink = group.length > 1 ? newId(p, 'L') : null;
  const rights = [];
  group.forEach(function (g) {
    const left = g.clip;
    const delta = at - left.start;
    const right = JSON.parse(JSON.stringify(left));
    right.id = newId(p, 'C');
    right.start = at;
    right.dur = left.dur - delta;
    right.srcIn = left.srcIn + Math.round(delta * left.speed);
    right.linkId = newLink;
    left.dur = delta;
    g.track.clips.push(right);
    sortClips(g.track);
    rights.push(right);
  });
  return rights;
}

// ---------- apagar ----------

// ripple: fecha o buraco, puxando pra trás o que vinha depois (só nas faixas dos clipes apagados).
export function removeClips(p, clipIds, opts) {
  const ripple = !!(opts && opts.ripple);
  const targets = new Map();
  clipIds.forEach(function (id) { linkedGroup(p, id).forEach(function (g) { targets.set(g.clip.id, g); }); });
  const removals = [];
  targets.forEach(function (g) {
    assertTrackUnlocked(g.track);
    removals.push({ track: g.track, start: g.clip.start, dur: g.clip.dur });
  });
  targets.forEach(function (g) { g.track.clips.splice(g.track.clips.indexOf(g.clip), 1); });
  if (ripple) {
    removals.sort(function (a, b) { return b.start - a.start; });
    removals.forEach(function (r) {
      const limit = r.start + r.dur;
      r.track.clips.forEach(function (c) { if (c.start >= limit) c.start -= r.dur; });
    });
  }
  return targets.size;
}

// ---------- aparar ----------

// Quanto cada borda do clipe pode andar: { min, max } em tempo de timeline. Considera os vizinhos,
// o começo/fim da mídia e a duração mínima (1 quadro) — de todos os clipes ligados.
export function trimLimits(p, clipId, edge) {
  const group = linkedGroup(p, clipId);
  const md = minClipDur(p);
  let min = -Infinity, max = Infinity;
  group.forEach(function (g) {
    const c = g.clip, asset = assetOf(p, c);
    const nb = neighborBounds(g.track, c);
    if (edge === 'start') {
      let lo = nb.prevEnd;
      if (asset.kind !== 'image') lo = Math.max(lo, c.start - Math.floor(c.srcIn / c.speed));
      min = Math.max(min, lo);
      max = Math.min(max, clipEnd(c) - md);
    } else {
      let hi = nb.nextStart;
      if (asset.kind !== 'image' && asset.durationUs != null) hi = Math.min(hi, c.start + Math.floor((asset.durationUs - c.srcIn) / c.speed));
      max = Math.min(max, hi);
      min = Math.max(min, c.start + md);
    }
  });
  return { min: min, max: max };
}

// edge: 'start' | 'end'; toUs = novo instante (timeline) dessa borda.
export function trimClip(p, clipId, edge, toUs) {
  toUs = Math.round(toUs);
  const group = linkedGroup(p, clipId);
  group.forEach(function (g) { assertTrackUnlocked(g.track); });
  const lim = trimLimits(p, clipId, edge);
  if (toUs < lim.min || toUs > lim.max) throw new Error('Esse ajuste passa do limite do clipe (vizinhos, fim da mídia ou duração mínima).');
  const main = group.filter(function (g) { return g.clip.id === clipId; })[0].clip;
  if (edge === 'start') {
    const d = toUs - main.start;
    group.forEach(function (g) {
      g.clip.srcIn += Math.round(d * g.clip.speed);
      g.clip.start += d;
      g.clip.dur -= d;
    });
  } else {
    const newDur = toUs - main.start;
    group.forEach(function (g) { g.clip.dur = newDur; });
  }
}

// ---------- mover ----------

// Muda o início do clipe (e de todos os ligados, pelo mesmo tanto). opts.trackId troca o clipe
// clicado de faixa (do mesmo tipo); os ligados continuam nas faixas deles.
export function moveClip(p, clipId, opts) {
  const group = linkedGroup(p, clipId);
  const main = group.filter(function (g) { return g.clip.id === clipId; })[0];
  const delta = opts.start == null ? 0 : Math.round(opts.start) - main.clip.start;
  const members = group.map(function (g) {
    let track = g.track;
    if (g === main && opts.trackId && opts.trackId !== g.track.id) {
      track = mustFindTrack(p, opts.trackId);
      if (track.kind !== g.track.kind) throw new Error('Só dá pra mover pra uma faixa do mesmo tipo.');
      assertTrackUnlocked(track);
    }
    assertTrackUnlocked(g.track);
    const start = g.clip.start + delta;
    if (start < 0) throw new Error('O clipe não pode começar antes do zero.');
    return { from: g.track, to: track, clip: g.clip, start: start };
  });
  const moving = members.map(function (m) { return m.clip; });
  members.forEach(function (m) { assertNoOverlap(m.to, m.start, m.clip.dur, moving); });
  members.forEach(function (m) {
    m.from.clips.splice(m.from.clips.indexOf(m.clip), 1);
    m.clip.start = m.start;
    m.to.clips.push(m.clip);
    sortClips(m.to);
  });
}

// ---------- propriedades ----------

const FITS = ['cover', 'contain', 'none'];

function num(v, name) {
  v = Number(v);
  if (!isFinite(v)) throw new Error('Valor inválido em ' + name + '.');
  return v;
}

// patch: { volume, enabled, fit, transform:{x,y,scale,rotation,opacity,crop:{l,t,r,b}} } — só o que vier.
export function setClipProps(p, clipId, patch) {
  const f = mustFindClip(p, clipId);
  assertTrackUnlocked(f.track);
  const c = f.clip;
  if (patch.volume !== undefined) {
    const v = num(patch.volume, 'volume');
    if (v < 0 || v > 4) throw new Error('Volume precisa estar entre 0 e 400%.');
    c.volume = v;
  }
  if (patch.enabled !== undefined) c.enabled = !!patch.enabled;
  if (patch.fit !== undefined) {
    if (FITS.indexOf(patch.fit) === -1) throw new Error('Ajuste de enquadramento inválido.');
    c.fit = patch.fit;
  }
  if (patch.transform) {
    const t = patch.transform, cur = c.transform;
    if (t.x !== undefined) cur.x = num(t.x, 'posição X');
    if (t.y !== undefined) cur.y = num(t.y, 'posição Y');
    if (t.scale !== undefined) {
      const s = num(t.scale, 'escala');
      if (!(s > 0 && s <= 20)) throw new Error('Escala precisa estar entre 0 e 2000%.');
      cur.scale = s;
    }
    if (t.rotation !== undefined) cur.rotation = num(t.rotation, 'rotação');
    if (t.opacity !== undefined) {
      const o = num(t.opacity, 'opacidade');
      if (o < 0 || o > 1) throw new Error('Opacidade precisa estar entre 0 e 100%.');
      cur.opacity = o;
    }
    if (t.crop) {
      const next = Object.assign({}, cur.crop, t.crop);
      ['l', 't', 'r', 'b'].forEach(function (k) {
        next[k] = num(next[k], 'recorte');
        if (next[k] < 0 || next[k] >= 1) throw new Error('Recorte precisa estar entre 0 e 100%.');
      });
      if (next.l + next.r >= 1 || next.t + next.b >= 1) throw new Error('Os recortes se cruzam.');
      cur.crop = next;
    }
  }
}

// ---------- encaixe (snap) ----------

// Instantes "magnéticos": 0, começo e fim de todos os clipes (menos os de `exclude`) e os `extra`
// (ex.: a posição do cursor).
export function snapPoints(p, opts) {
  opts = opts || {};
  const exclude = new Set(opts.exclude || []);
  const pts = new Set([0]);
  (opts.extra || []).forEach(function (x) { pts.add(Math.round(x)); });
  allTracks(p).forEach(function (t) {
    t.clips.forEach(function (c) {
      if (exclude.has(c.id)) return;
      pts.add(c.start); pts.add(clipEnd(c));
    });
  });
  return Array.from(pts).sort(function (a, b) { return a - b; });
}

export function snap(value, points, threshold) {
  let best = value, bestDist = threshold + 1;
  points.forEach(function (pt) {
    const d = Math.abs(pt - value);
    if (d <= threshold && d < bestDist) { best = pt; bestDist = d; }
  });
  return best;
}

// Primeiro instante (a partir de `from`) em que cabe um clipe de `dur` em TODAS as faixas dadas.
export function firstFreeStart(p, trackIds, dur, from) {
  let start = Math.round(from || 0);
  for (let guard = 0; guard < 10000; guard++) {
    let clash = null;
    for (let i = 0; i < trackIds.length && !clash; i++) {
      const t = mustFindTrack(p, trackIds[i]);
      clash = t.clips.filter(function (c) { return start < clipEnd(c) && start + dur > c.start; })[0] || null;
    }
    if (!clash) return start;
    start = clipEnd(clash);
  }
  return start;
}

