import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProject, addAsset, removeAsset, addTrack, removeTrack, renameTrack, setTrackFlags, moveTrack,
  validate, serialize, deserialize, findClip, projectDuration, MAX_TRACKS_PER_KIND, allTracks
} from '../src/core/project.js';
import {
  addClip, addAssetToTimeline, splitClip, removeClips, trimClip, trimLimits, moveClip, setClipProps,
  snapPoints, snap, firstFreeStart, linkedGroup
} from '../src/core/ops.js';
import { History } from '../src/core/history.js';
import { CommandRegistry, normalizeCombo, comboFromEvent } from '../src/core/commands.js';
import { secToUs, formatTimecode, formatDuration, snapToFrame, frameDurationUs } from '../src/core/time.js';

const S = secToUs;

function base() {
  const p = createProject({ videoUid: 'u1', name: 'Corte' });
  const v = addAsset(p, { kind: 'video', name: 'raw.mp4', source: { type: 'drive', fileId: 'FILE_VIDEO_1' }, durationUs: S(60), hasAudio: true });
  const m = addAsset(p, { kind: 'audio', name: 'musica.mp3', source: { type: 'drive', fileId: 'FILE_AUDIO_1' }, durationUs: S(30) });
  const img = addAsset(p, { kind: 'image', name: 'logo.png', source: { type: 'project', fileId: 'FILE_IMG_1' } });
  return { p, v, m, img, V1: p.videoTracks[0].id, V2: p.videoTracks[1].id, A1: p.audioTracks[0].id, A2: p.audioTracks[1].id };
}

// ---------- projeto e faixas ----------

test('projeto novo começa com 2 faixas de vídeo e 2 de áudio, 9:16 a 30 fps', () => {
  const p = createProject({});
  assert.equal(p.videoTracks.length, 2);
  assert.equal(p.audioTracks.length, 2);
  assert.deepEqual(p.canvas, { width: 1080, height: 1920, fps: 30 });
  assert.equal(p.videoTracks[0].name, 'Vídeo 1');
  assert.equal(p.audioTracks[1].name, 'Áudio 2');
  validate(p);
});

test('dá pra criar quantas faixas quiser até o limite, de vídeo e de áudio', () => {
  const p = createProject({});
  for (let i = 0; i < MAX_TRACKS_PER_KIND - 2; i++) addTrack(p, 'video');
  assert.equal(p.videoTracks.length, MAX_TRACKS_PER_KIND);
  assert.throws(() => addTrack(p, 'video'), /Limite/);
  addTrack(p, 'audio');
  assert.equal(p.audioTracks.length, 3);
  validate(p);
});

test('nome de faixa nova nunca repete um que já existe', () => {
  const p = createProject({});
  removeTrack(p, p.videoTracks[0].id); // sobra "Vídeo 2"
  const t = addTrack(p, 'video');
  assert.equal(t.name, 'Vídeo 1');
  const t2 = addTrack(p, 'video');
  assert.equal(t2.name, 'Vídeo 3');
});

test('nova faixa de vídeo entra por cima; dá pra escolher a posição', () => {
  const p = createProject({});
  const top = addTrack(p, 'video');
  assert.equal(p.videoTracks[p.videoTracks.length - 1].id, top.id);
  const bottom = addTrack(p, 'video', { index: 0, name: 'Fundo' });
  assert.equal(p.videoTracks[0].id, bottom.id);
  assert.equal(bottom.name, 'Fundo');
});

test('sempre sobra pelo menos uma faixa de cada tipo', () => {
  const p = createProject({});
  removeTrack(p, p.audioTracks[0].id);
  assert.throws(() => removeTrack(p, p.audioTracks[0].id), /pelo menos uma faixa de áudio/);
  removeTrack(p, p.videoTracks[0].id);
  assert.throws(() => removeTrack(p, p.videoTracks[0].id), /pelo menos uma faixa de vídeo/);
});

test('renomear, silenciar, bloquear, esconder e mover faixas', () => {
  const { p, V1, V2, A1 } = base();
  renameTrack(p, V1, '  Gameplay ');
  assert.equal(p.videoTracks[0].name, 'Gameplay');
  assert.throws(() => renameTrack(p, V1, '   '), /nome/);
  assert.throws(() => renameTrack(p, V1, 'x'.repeat(41)), /longo/);
  setTrackFlags(p, A1, { muted: true, volume: 0.5 });
  assert.equal(p.audioTracks[0].muted, true);
  assert.equal(p.audioTracks[0].volume, 0.5);
  assert.throws(() => setTrackFlags(p, A1, { volume: 9 }), /400%/);
  setTrackFlags(p, V2, { hidden: true, locked: true });
  assert.equal(p.videoTracks[1].hidden, true);
  assert.equal(moveTrack(p, V1, +1), true);
  assert.equal(p.videoTracks[1].id, V1);
  assert.equal(moveTrack(p, V1, +1), false); // já está no topo
  validate(p);
});

test('remover faixa leva os clipes dela; clipe ligado que ficou sozinho perde o vínculo', () => {
  const { p, v, V1, A1 } = base();
  const [vc, ac] = addAssetToTimeline(p, v.id, { start: 0, videoTrackId: V1, audioTrackId: A1 });
  assert.equal(vc.linkId, ac.linkId);
  const n = removeTrack(p, A1);
  assert.equal(n, 1);
  assert.equal(findClip(p, vc.id).clip.linkId, null);
  validate(p);
});

test('faixa bloqueada não pode ser removida', () => {
  const { p, V2 } = base();
  setTrackFlags(p, V2, { locked: true });
  assert.throws(() => removeTrack(p, V2), /bloqueada/);
});

test('mídias: a mesma origem não vira duas mídias; mídia em uso não sai', () => {
  const { p, v, V1 } = base();
  const again = addAsset(p, { kind: 'video', name: 'outro nome', source: { type: 'drive', fileId: 'FILE_VIDEO_1' } });
  assert.equal(again.id, v.id);
  addClip(p, V1, { assetId: v.id, start: 0, dur: S(5) });
  assert.throws(() => removeAsset(p, v.id), /sendo usada/);
});

test('validate recusa regras quebradas', () => {
  const { p, v, V1 } = base();
  addClip(p, V1, { assetId: v.id, start: 0, dur: S(10) });
  const bad = (fn, re) => { const q = JSON.parse(JSON.stringify(p)); fn(q); assert.throws(() => validate(q), re); };
  bad(q => { q.videoTracks[0].clips[0].dur = 0; }, /Duração/);
  bad(q => { q.videoTracks[0].clips[0].start = -1; }, /Início/);
  bad(q => { q.videoTracks[0].clips[0].assetId = 'A999'; }, /não existe/);
  bad(q => { q.videoTracks[0].clips[0].dur = S(70); }, /passa do fim/);
  bad(q => { q.videoTracks[0].clips[0].linkId = 'L1'; }, /incompleto/);
  bad(q => { q.audioTracks[0].clips.push(JSON.parse(JSON.stringify(q.videoTracks[0].clips[0]))); }, /repetido/);
  bad(q => { q.schema = 99; }, /desconhecida/);
  bad(q => { q.videoTracks = []; }, /pelo menos uma/);
});

test('salvar e ler devolve o mesmo projeto; projeto mais novo é recusado; lixo é recusado', () => {
  const { p, v, V1, A1 } = base();
  addAssetToTimeline(p, v.id, { start: S(2), videoTrackId: V1, audioTrackId: A1, dur: S(10) });
  const back = deserialize(serialize(p));
  assert.deepEqual(back, p);
  const futuro = JSON.parse(serialize(p)); futuro.schema = 2;
  assert.throws(() => deserialize(JSON.stringify(futuro)), /mais nova/);
  assert.throws(() => deserialize('{nao e json'), /corrompido/);
  assert.throws(() => deserialize('null'), /corrompido/);
});

test('projeto antigo sem campos novos é completado com os padrões ao ler', () => {
  const { p, v, V1 } = base();
  addClip(p, V1, { assetId: v.id, start: 0, dur: S(5) });
  const velho = JSON.parse(serialize(p));
  const c = velho.videoTracks[0].clips[0];
  delete c.volume; delete c.fit; delete c.transform; delete c.enabled;
  delete velho.videoTracks[0].hidden;
  const lido = deserialize(JSON.stringify(velho));
  const lc = lido.videoTracks[0].clips[0];
  assert.equal(lc.volume, 1);
  assert.equal(lc.fit, 'cover');
  assert.equal(lc.enabled, true);
  assert.equal(lc.transform.scale, 1);
  assert.deepEqual(lc.transform.crop, { l: 0, t: 0, r: 0, b: 0 });
  assert.equal(lido.videoTracks[0].hidden, false);
});

// ---------- operações ----------

test('jogar um vídeo na timeline cria vídeo + áudio ligados, com o mesmo trecho', () => {
  const { p, v, V1, A1 } = base();
  const [vc, ac] = addAssetToTimeline(p, v.id, { start: S(3), videoTrackId: V1, audioTrackId: A1, srcIn: S(10), dur: S(20) });
  assert.equal(vc.start, S(3)); assert.equal(ac.start, S(3));
  assert.equal(vc.dur, S(20)); assert.equal(ac.dur, S(20));
  assert.equal(vc.srcIn, S(10)); assert.equal(ac.srcIn, S(10));
  assert.ok(vc.linkId && vc.linkId === ac.linkId);
  assert.equal(linkedGroup(p, vc.id).length, 2);
  validate(p);
});

test('sem duração informada usa a mídia inteira; vídeo sem áudio não gera clipe de áudio; imagem dura 5 s', () => {
  const { p, v, img, V1, V2, A1 } = base();
  const [a] = addAssetToTimeline(p, v.id, { start: 0, videoTrackId: V1, audioTrackId: A1 });
  assert.equal(a.dur, S(60));
  const mudo = addAsset(p, { kind: 'video', name: 'mudo.mp4', source: { type: 'drive', fileId: 'FILE_MUDO' }, durationUs: S(8), hasAudio: false });
  const got = addAssetToTimeline(p, mudo.id, { start: 0, videoTrackId: V2, audioTrackId: A1 });
  assert.equal(got.length, 1);
  const [i] = addAssetToTimeline(p, img.id, { start: S(60), videoTrackId: V1 });
  assert.equal(i.dur, S(5));
});

test('não deixa clipes se sobreporem nem pôr áudio em faixa de vídeo', () => {
  const { p, v, m, V1, A1 } = base();
  addClip(p, V1, { assetId: v.id, start: 0, dur: S(10) });
  assert.throws(() => addClip(p, V1, { assetId: v.id, start: S(5), dur: S(10) }), /Já existe/);
  addClip(p, V1, { assetId: v.id, start: S(10), dur: S(5) }); // colado, sem sobrepor: ok
  assert.throws(() => addClip(p, V1, { assetId: m.id, start: S(20), dur: S(2) }), /faixa de vídeo/);
  addClip(p, A1, { assetId: m.id, start: 0, dur: S(2) });
});

test('dividir parte vídeo e áudio ligados no mesmo ponto, em dois pares novos', () => {
  const { p, v, V1, A1 } = base();
  const [vc, ac] = addAssetToTimeline(p, v.id, { start: 0, videoTrackId: V1, audioTrackId: A1, dur: S(10) });
  const rights = splitClip(p, vc.id, S(4));
  assert.equal(rights.length, 2);
  assert.equal(p.videoTracks[0].clips.length, 2);
  assert.equal(p.audioTracks[0].clips.length, 2);
  const [l, r] = p.videoTracks[0].clips;
  assert.equal(l.dur, S(4)); assert.equal(r.start, S(4)); assert.equal(r.dur, S(6)); assert.equal(r.srcIn, S(4));
  assert.equal(l.linkId, ac.linkId);
  assert.notEqual(r.linkId, l.linkId); // o par da direita é um grupo novo
  assert.equal(r.linkId, p.audioTracks[0].clips[1].linkId);
  validate(p);
});

test('dividir respeita o srcIn e a velocidade; recusa ponto colado na borda', () => {
  const { p, v, V1 } = base();
  const c = addClip(p, V1, { assetId: v.id, start: S(1), dur: S(10), srcIn: S(5) });
  const [r] = splitClip(p, c.id, S(4));
  assert.equal(r.srcIn, S(8)); // 5 s + 3 s de timeline
  assert.throws(() => splitClip(p, c.id, S(1)), /borda/);
  assert.throws(() => splitClip(p, c.id, S(1) + 1000), /borda/);
});

test('apagar leva o par ligado; com ripple fecha o buraco só nas faixas afetadas', () => {
  const { p, v, V1, V2, A1 } = base();
  const [v1] = addAssetToTimeline(p, v.id, { start: 0, videoTrackId: V1, audioTrackId: A1, dur: S(5) });
  const [v2] = addAssetToTimeline(p, v.id, { start: S(5), videoTrackId: V1, audioTrackId: A1, dur: S(5), srcIn: S(5) });
  const outra = addClip(p, V2, { assetId: v.id, start: S(7), dur: S(2) });
  assert.equal(removeClips(p, [v1.id], { ripple: true }), 2);
  assert.equal(p.videoTracks[0].clips[0].start, 0); // v2 puxado pra trás
  assert.equal(p.audioTracks[0].clips[0].start, 0);
  assert.equal(findClip(p, outra.id).clip.start, S(7)); // outra faixa não mexe
  assert.equal(findClip(p, v2.id).clip.id, v2.id);
  validate(p);
});

test('apagar sem ripple deixa o buraco', () => {
  const { p, v, V1 } = base();
  const a = addClip(p, V1, { assetId: v.id, start: 0, dur: S(5) });
  const b = addClip(p, V1, { assetId: v.id, start: S(5), dur: S(5) });
  removeClips(p, [a.id], { ripple: false });
  assert.equal(findClip(p, b.id).clip.start, S(5));
});

test('ripple com vários clipes apagados de uma vez fecha todos os buracos', () => {
  const { p, v, V1 } = base();
  const a = addClip(p, V1, { assetId: v.id, start: 0, dur: S(2) });
  const b = addClip(p, V1, { assetId: v.id, start: S(2), dur: S(3) });
  const c = addClip(p, V1, { assetId: v.id, start: S(5), dur: S(4) });
  const d = addClip(p, V1, { assetId: v.id, start: S(9), dur: S(1) });
  removeClips(p, [a.id, c.id], { ripple: true });
  const left = p.videoTracks[0].clips;
  assert.equal(left.length, 2);
  assert.equal(left[0].id, b.id); assert.equal(left[0].start, 0);
  assert.equal(left[1].id, d.id); assert.equal(left[1].start, S(3));
});

test('faixa bloqueada protege os clipes de apagar, dividir e mover', () => {
  const { p, v, V1 } = base();
  const c = addClip(p, V1, { assetId: v.id, start: 0, dur: S(10) });
  setTrackFlags(p, V1, { locked: true });
  assert.throws(() => removeClips(p, [c.id]), /bloqueada/);
  assert.throws(() => splitClip(p, c.id, S(5)), /bloqueada/);
  assert.throws(() => moveClip(p, c.id, { start: S(1) }), /bloqueada/);
  assert.throws(() => setClipProps(p, c.id, { volume: 0.5 }), /bloqueada/);
});

test('aparar a borda de trás muda duração; a da frente mexe no srcIn; ligados andam juntos', () => {
  const { p, v, V1, A1 } = base();
  const [vc, ac] = addAssetToTimeline(p, v.id, { start: S(2), videoTrackId: V1, audioTrackId: A1, srcIn: S(10), dur: S(10) });
  trimClip(p, vc.id, 'end', S(9)); // fim em 9 s -> dur 7 s
  assert.equal(findClip(p, vc.id).clip.dur, S(7));
  assert.equal(findClip(p, ac.id).clip.dur, S(7));
  trimClip(p, vc.id, 'start', S(4)); // começo +2 s
  const v2 = findClip(p, vc.id).clip, a2 = findClip(p, ac.id).clip;
  assert.equal(v2.start, S(4)); assert.equal(v2.srcIn, S(12)); assert.equal(v2.dur, S(5));
  assert.equal(a2.start, S(4)); assert.equal(a2.srcIn, S(12)); assert.equal(a2.dur, S(5));
  validate(p);
});

test('limites do aparo: vizinho, começo/fim da mídia e duração mínima', () => {
  const { p, v, V1 } = base();
  const a = addClip(p, V1, { assetId: v.id, start: 0, dur: S(5), srcIn: S(1) });
  const b = addClip(p, V1, { assetId: v.id, start: S(8), dur: S(5), srcIn: S(20) });
  const la = trimLimits(p, a.id, 'end');
  assert.equal(la.max, S(8)); // vizinho
  assert.equal(la.min, 0 + frameDurationUs(30));
  const lb = trimLimits(p, b.id, 'start');
  assert.equal(lb.min, S(5)); // fim do vizinho (o começo da mídia, em -12 s, não limita)
  const ls = trimLimits(p, a.id, 'start');
  assert.equal(ls.min, 0); // srcIn=1s permitiria -1 s, mas a timeline começa em 0
  assert.throws(() => trimClip(p, a.id, 'end', S(9)), /limite/);
  assert.throws(() => trimClip(p, b.id, 'start', S(4)), /limite/);
  // mídia de 60 s: clipe b usa 20..25 s, só pode crescer até 60 s de mídia
  const lb2 = trimLimits(p, b.id, 'end');
  assert.equal(lb2.max, S(8) + S(40));
});

test('aparar o começo não pode ir antes do início da mídia', () => {
  const { p, v, V1 } = base();
  const c = addClip(p, V1, { assetId: v.id, start: S(10), dur: S(5), srcIn: S(2) });
  assert.equal(trimLimits(p, c.id, 'start').min, S(8));
  assert.throws(() => trimClip(p, c.id, 'start', S(7)), /limite/);
  trimClip(p, c.id, 'start', S(8));
  assert.equal(findClip(p, c.id).clip.srcIn, 0);
});

test('mover leva os ligados juntos, não deixa sobrepor nem ficar negativo; troca de faixa só do mesmo tipo', () => {
  const { p, v, V1, V2, A1 } = base();
  const [vc, ac] = addAssetToTimeline(p, v.id, { start: S(5), videoTrackId: V1, audioTrackId: A1, dur: S(5) });
  moveClip(p, vc.id, { start: S(20) });
  assert.equal(findClip(p, vc.id).clip.start, S(20));
  assert.equal(findClip(p, ac.id).clip.start, S(20));
  assert.throws(() => moveClip(p, vc.id, { start: -S(1) }), /antes do zero/);
  moveClip(p, vc.id, { trackId: V2 });
  assert.equal(findClip(p, vc.id).track.id, V2);
  assert.equal(findClip(p, ac.id).track.id, A1);
  assert.throws(() => moveClip(p, vc.id, { trackId: A1 }), /mesmo tipo/);
  const outro = addClip(p, V2, { assetId: v.id, start: 0, dur: S(5) });
  assert.throws(() => moveClip(p, vc.id, { start: S(3) }), /Já existe/);
  assert.equal(findClip(p, outro.id).clip.start, 0);
  validate(p);
});

test('propriedades do clipe: valida faixas de valores', () => {
  const { p, v, V1 } = base();
  const c = addClip(p, V1, { assetId: v.id, start: 0, dur: S(5) });
  setClipProps(p, c.id, { volume: 2, fit: 'contain', transform: { x: 100, scale: 1.5, opacity: 0.5, crop: { l: 0.1, r: 0.2 } } });
  const cc = findClip(p, c.id).clip;
  assert.equal(cc.volume, 2); assert.equal(cc.fit, 'contain');
  assert.equal(cc.transform.x, 100); assert.equal(cc.transform.scale, 1.5); assert.equal(cc.transform.opacity, 0.5);
  assert.deepEqual(cc.transform.crop, { l: 0.1, t: 0, r: 0.2, b: 0 });
  assert.throws(() => setClipProps(p, c.id, { volume: 5 }), /400%/);
  assert.throws(() => setClipProps(p, c.id, { fit: 'esticar' }), /inválido/);
  assert.throws(() => setClipProps(p, c.id, { transform: { scale: 0 } }), /Escala/);
  assert.throws(() => setClipProps(p, c.id, { transform: { opacity: 2 } }), /Opacidade/);
  assert.throws(() => setClipProps(p, c.id, { transform: { crop: { l: 0.6, r: 0.5 } } }), /cruzam/);
  assert.throws(() => setClipProps(p, c.id, { transform: { x: 'abc' } }), /inválido/);
});

test('encaixe magnético: pontos, ímã por distância e primeiro espaço livre', () => {
  const { p, v, V1, V2 } = base();
  const a = addClip(p, V1, { assetId: v.id, start: S(2), dur: S(3) });
  addClip(p, V2, { assetId: v.id, start: S(10), dur: S(2) });
  const pts = snapPoints(p, { exclude: [], extra: [S(7)] });
  assert.deepEqual(pts, [0, S(2), S(5), S(7), S(10), S(12)]);
  assert.deepEqual(snapPoints(p, { exclude: [a.id] }), [0, S(10), S(12)]);
  assert.equal(snap(S(5) + 20000, pts, 50000), S(5));
  assert.equal(snap(S(6), pts, 50000), S(6)); // longe de qualquer ponto
  assert.equal(firstFreeStart(p, [V1], S(2), 0), 0); // 0..2 s encosta no clipe (2..5 s) mas não sobrepõe
  assert.equal(firstFreeStart(p, [V1], S(3), 0), S(5)); // 0..3 bate no clipe (2..5), próximo livre é 5
  assert.equal(firstFreeStart(p, [V1, V2], S(8), S(4)), S(12));
});

test('duração do projeto = fim do último clipe', () => {
  const { p, v, V1, A1, m } = base();
  assert.equal(projectDuration(p), 0);
  addClip(p, V1, { assetId: v.id, start: 0, dur: S(5) });
  addClip(p, A1, { assetId: m.id, start: S(3), dur: S(10) });
  assert.equal(projectDuration(p), S(13));
});

// ---------- desfazer / refazer ----------

test('desfazer e refazer voltam e avançam exatamente', () => {
  const { p, v, V1 } = base();
  const h = new History(p);
  h.edit('Adicionar faixa de vídeo', d => addTrack(d, 'video'));
  h.edit('Colocar clipe', d => addClip(d, V1, { assetId: v.id, start: 0, dur: S(5) }));
  assert.equal(h.project.videoTracks.length, 3);
  assert.equal(h.undoLabel, 'Colocar clipe');
  assert.equal(h.undo(), true);
  assert.equal(h.project.videoTracks[0].clips.length, 0);
  assert.equal(h.redoLabel, 'Colocar clipe');
  assert.equal(h.undo(), true);
  assert.equal(h.project.videoTracks.length, 2);
  assert.equal(h.undo(), false);
  h.redo(); h.redo();
  assert.equal(h.project.videoTracks[0].clips.length, 1);
  assert.equal(h.redo(), false);
});

test('edição que dá erro não muda nada e não entra no histórico', () => {
  const { p, V1, v } = base();
  const h = new History(p);
  const antes = h.project;
  assert.throws(() => h.edit('Ruim', d => { addClip(d, V1, { assetId: v.id, start: 0, dur: S(5) }); throw new Error('falhou'); }), /falhou/);
  assert.equal(h.project, antes);
  assert.equal(h.canUndo, false);
  // erro de validação no fim também descarta
  assert.throws(() => h.edit('Quebra regra', d => { d.videoTracks[0].clips.push({ id: 'X', assetId: 'nao-existe', start: 0, dur: 1, srcIn: 0, speed: 1 }); }));
  assert.equal(h.project, antes);
});

test('nova edição depois de desfazer apaga o "refazer"', () => {
  const { p } = base();
  const h = new History(p);
  h.edit('a', d => addTrack(d, 'audio'));
  h.undo();
  assert.equal(h.canRedo, true);
  h.edit('b', d => addTrack(d, 'video'));
  assert.equal(h.canRedo, false);
});

test('limite de 200 passos de desfazer', () => {
  const { p } = base();
  const h = new History(p, { limit: 200 });
  for (let i = 0; i < 210; i++) h.edit('renomear ' + i, d => renameTrack(d, d.videoTracks[0].id, 'N' + i));
  let n = 0; while (h.undo()) n++;
  assert.equal(n, 200);
});

test('edições com a mesma chave em sequência viram um único passo (arrastar)', () => {
  const { p, v, V1 } = base();
  const h = new History(p);
  const c = h.edit('Colocar', d => addClip(d, V1, { assetId: v.id, start: 0, dur: S(5) }));
  let t = 1000;
  for (let i = 1; i <= 5; i++) h.edit('Mover clipe', d => moveClip(d, c.id, { start: S(i) }), { mergeKey: 'move:' + c.id, now: () => t += 100 });
  assert.equal(findClip(h.project, c.id).clip.start, S(5));
  h.undo(); // desfaz TODO o arrasto de uma vez
  assert.equal(findClip(h.project, c.id).clip.start, 0);
  h.undo();
  assert.equal(h.canUndo, false);
});

test('passado o tempo da janela, o arrasto vira outro passo', () => {
  const { p, v, V1 } = base();
  const h = new History(p);
  const c = h.edit('Colocar', d => addClip(d, V1, { assetId: v.id, start: 0, dur: S(5) }));
  h.edit('Mover', d => moveClip(d, c.id, { start: S(1) }), { mergeKey: 'm', now: () => 1000 });
  h.edit('Mover', d => moveClip(d, c.id, { start: S(2) }), { mergeKey: 'm', now: () => 5000 });
  h.undo();
  assert.equal(findClip(h.project, c.id).clip.start, S(1));
});

test('avisa quem está ouvindo e controla "alterações não salvas"', () => {
  const { p } = base();
  const h = new History(p);
  const events = [];
  const off = h.onChange((kind, label) => events.push(kind + ':' + label));
  assert.equal(h.dirty, false);
  h.edit('x', d => addTrack(d, 'video'));
  assert.equal(h.dirty, true);
  h.markSaved();
  assert.equal(h.dirty, false);
  h.undo();
  assert.equal(h.dirty, true);
  h.redo();
  assert.equal(h.dirty, false); // voltou exatamente ao estado salvo
  off();
  h.undo();
  assert.deepEqual(events, ['edit:x', 'saved:undefined', 'undo:x', 'redo:x']);
});

// ---------- comandos e atalhos ----------

test('normaliza combinações de teclas', () => {
  assert.equal(normalizeCombo('ctrl+shift+z'), 'Ctrl+Shift+Z');
  assert.equal(normalizeCombo('Shift+Ctrl+Z'), 'Ctrl+Shift+Z');
  assert.equal(normalizeCombo('cmd+z'), 'Ctrl+Z');
  assert.equal(normalizeCombo('delete'), 'Delete');
  assert.equal(normalizeCombo(' '), '');
  assert.equal(comboFromEvent({ key: 'z', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+Z');
  assert.equal(comboFromEvent({ key: ' ' }), 'Space');
  assert.equal(comboFromEvent({ key: 'Shift', shiftKey: true }), '');
  assert.equal(comboFromEvent({ key: 'ArrowLeft', altKey: true }), 'Alt+ArrowLeft');
});

test('comandos: registrar, executar, checar se pode, achar por atalho', () => {
  const reg = new CommandRegistry();
  const log = [];
  reg.register({ id: 'edit.undo', label: 'Desfazer', shortcuts: ['Ctrl+Z'], enabled: (c) => c.canUndo ? true : 'Nada para desfazer.', run: () => log.push('undo') });
  reg.register({ id: 'edit.redo', label: 'Refazer', shortcuts: ['Ctrl+Shift+Z', 'Ctrl+Y'], run: () => log.push('redo') });
  assert.throws(() => reg.register({ id: 'edit.undo', label: 'x', run() {} }), /já registrado/);
  assert.equal(reg.findByCombo('ctrl+y'), 'edit.redo');
  assert.deepEqual(reg.execute('edit.undo', { canUndo: false }), { ok: false, reason: 'Nada para desfazer.' });
  assert.deepEqual(reg.execute('edit.undo', { canUndo: true }), { ok: true, result: 1 });
  assert.equal(reg.execute('nao.existe', {}).ok, false);
  assert.deepEqual(log, ['undo']);
});

test('personalizar atalhos: troca, conflito, restaurar, salvar/carregar', () => {
  const reg = new CommandRegistry();
  reg.register({ id: 'edit.undo', label: 'Desfazer', shortcuts: ['Ctrl+Z'], run() {} });
  reg.register({ id: 'clip.split', label: 'Dividir', shortcuts: ['S'], run() {} });
  reg.setShortcuts('clip.split', ['Ctrl+B']);
  assert.deepEqual(reg.shortcutsOf('clip.split'), ['Ctrl+B']);
  assert.equal(reg.findByCombo('S'), null);
  assert.throws(() => reg.setShortcuts('clip.split', ['Ctrl+Z']), /já é o atalho de "Desfazer"/);
  const saved = reg.exportOverrides();
  const reg2 = new CommandRegistry();
  reg2.register({ id: 'edit.undo', label: 'Desfazer', shortcuts: ['Ctrl+Z'], run() {} });
  reg2.register({ id: 'clip.split', label: 'Dividir', shortcuts: ['S'], run() {} });
  reg2.importOverrides(saved);
  assert.equal(reg2.findByCombo('ctrl+b'), 'clip.split');
  reg2.resetShortcuts('clip.split');
  assert.deepEqual(reg2.shortcutsOf('clip.split'), ['S']);
});

// ---------- tempo ----------

test('tempo em microssegundos: quadros, timecode e duração', () => {
  assert.equal(frameDurationUs(30), 33333);
  assert.equal(snapToFrame(S(1) + 10000, 30), S(1)); // 10 ms depois do quadro 30 -> volta pro quadro 30
  assert.equal(snapToFrame(S(1) + 25000, 30), 1033333); // mais perto do quadro 31
  assert.equal(formatTimecode(S(65.5), 30), '01:05:15');
  assert.equal(formatTimecode(0, 30), '00:00:00');
  assert.equal(formatDuration(S(567)), '9:27');
  assert.equal(formatDuration(S(3725)), '1:02:05');
  assert.equal(formatDuration(null), '--:--');
});

test('todas as faixas aparecem em allTracks (vídeo e depois áudio)', () => {
  const { p } = base();
  assert.deepEqual(allTracks(p).map(t => t.kind), ['video', 'video', 'audio', 'audio']);
});
