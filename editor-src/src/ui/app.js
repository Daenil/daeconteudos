import { h, icon, fmtBytes, setChildren } from './dom.js';
import { STYLES } from './styles.js';
import { createProject, addAsset, addTrack, removeTrack, renameTrack, setTrackFlags, moveTrack } from '../core/project.js';
import { History } from '../core/history.js';
import { CommandRegistry, comboFromEvent } from '../core/commands.js';
import { DriveClient, parseDriveLink } from '../media/drive.js';
import { MediaCache } from '../media/cache.js';
import { OpfsStore } from '../media/store.js';
import { formatDuration } from '../core/time.js';

function injectStyles() {
  if (document.getElementById('dae-editor-css')) return;
  const s = document.createElement('style');
  s.id = 'dae-editor-css';
  s.textContent = STYLES;
  document.head.appendChild(s);
}

// Abre o editor por cima do painel. host:
//   info          — o que openEditProject devolveu (uid, name, raw, projectFolderId, accessToken, pastas...)
//   toast(msg, isErr), refreshInfo() -> Promise<info novo> (token novo), onClose()
// deps (só testes): { store, quota, fetchImpl }
export function openEditor(host, deps) {
  deps = deps || {};
  injectStyles();

  const root = h('div', { class: 'dae-root', tabindex: '-1' });
  document.body.appendChild(root);
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  let closed = false;
  let ui = null; // preenchido depois que o projeto abre
  const downloads = new Set(); // AbortControllers de downloads em andamento

  function toast(msg, isErr) { try { host.toast(msg, isErr); } catch (e) { /* sem toast, segue */ } }

  function finish() {
    if (closed) return;
    closed = true;
    downloads.forEach(function (c) { c.abort(); });
    document.removeEventListener('keydown', onKey, true);
    root.remove();
    document.body.style.overflow = prevOverflow;
    if (host.onClose) host.onClose();
  }

  function requestClose() {
    if (ui && ui.history.dirty && !confirm('Você tem alterações que ainda não foram salvas. Fechar mesmo assim?')) return;
    finish();
  }

  const registry = new CommandRegistry();

  function onKey(e) {
    if (closed) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const id = registry.findByCombo(comboFromEvent(e));
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    const r = registry.execute(id, ui);
    if (!r.ok) toast(r.reason, false);
  }

  function showCenter(children) {
    setChildren(root, h('div', { class: 'dae-center' }, children));
  }

  function fatal(err) {
    showCenter([
      h('div', { class: 'dae-err', text: (err && err.message) || String(err) }),
      h('button', { class: 'dae-btn', onclick: finish, text: 'Fechar' })
    ]);
  }

  showCenter([h('div', { class: 'dae-muted', text: 'Abrindo o projeto…' })]);

  boot().then(function (state) {
    if (closed) return;
    ui = state;
    registerCommands();
    document.addEventListener('keydown', onKey, true);
    build();
    root.focus();
  }).catch(function (err) { if (!closed) fatal(err); });

  // ---------- abertura: acha o vídeo bruto e monta o projeto ----------

  async function boot() {
    const info = host.info;
    const parsed = parseDriveLink(info.raw);
    if (!parsed) throw new Error('O link do vídeo bruto deste corte não é do Google Drive, então o editor não consegue abri-lo.');
    const drive = new DriveClient({
      fetchImpl: deps.fetchImpl,
      getToken: async function (force) {
        if (force) {
          if (!host.refreshInfo) throw new Error('A sessão com o Drive expirou. Feche e abra o editor de novo.');
          const fresh = await host.refreshInfo();
          info.accessToken = fresh.accessToken;
        }
        return info.accessToken;
      }
    });
    const meta = await drive.getMeta(parsed.id);
    let items;
    if (meta.isFolder) {
      items = await drive.listFolder(parsed.id, { mimePrefixes: ['video/'] });
      if (!items.length) throw new Error('A pasta do vídeo bruto não tem nenhum vídeo.');
    } else {
      if ((meta.mimeType || '').indexOf('video/') !== 0) throw new Error('O arquivo bruto não parece ser um vídeo (' + meta.mimeType + ').');
      items = [meta];
    }
    const project = createProject({ videoUid: info.uid, name: info.name });
    items.forEach(function (it) {
      addAsset(project, { kind: 'video', name: it.name, source: { type: 'drive', fileId: it.id }, durationUs: it.durationUs, width: it.width, height: it.height, size: it.size, mimeType: it.mimeType });
    });
    return {
      info: info, drive: drive, items: items, history: new History(project),
      cache: new MediaCache({ store: deps.store || new OpfsStore(), quota: deps.quota }),
      dl: {}, els: {}
    };
  }

  // ---------- comandos ----------

  function registerCommands() {
    registry.register({ id: 'edit.undo', label: 'Desfazer', shortcuts: ['Ctrl+Z'],
      enabled: function (c) { return c.history.canUndo ? true : 'Nada para desfazer.'; },
      run: function (c) { c.history.undo(); } });
    registry.register({ id: 'edit.redo', label: 'Refazer', shortcuts: ['Ctrl+Shift+Z', 'Ctrl+Y'],
      enabled: function (c) { return c.history.canRedo ? true : 'Nada para refazer.'; },
      run: function (c) { c.history.redo(); } });
    registry.register({ id: 'track.addVideo', label: 'Nova faixa de vídeo',
      run: function () { edit('Adicionar faixa de vídeo', function (d) { addTrack(d, 'video'); }); } });
    registry.register({ id: 'track.addAudio', label: 'Nova faixa de áudio',
      run: function () { edit('Adicionar faixa de áudio', function (d) { addTrack(d, 'audio'); }); } });
  }

  function edit(label, fn, opts) {
    try { return ui.history.edit(label, fn, opts); }
    catch (e) { toast(e.message, true); return undefined; }
  }

  // ---------- tela ----------

  let topEls = null, tracksEl = null;

  function build() {
    const history = ui.history;
    topEls = {
      status: h('div', { class: 'dae-status' }),
      undo: h('button', { class: 'dae-ibtn', html: icon('undo', 16), onclick: function () { run('edit.undo'); } }),
      redo: h('button', { class: 'dae-ibtn', html: icon('redo', 16), onclick: function () { run('edit.redo'); } })
    };
    tracksEl = h('div', { class: 'dae-tl-body' });

    const mediaPanel = h('aside', { class: 'dae-media' },
      h('div', { class: 'dae-h', text: 'Vídeo bruto' }),
      h('div', {}, ui.items.map(renderMediaItem)),
      lazySection('Músicas para edições', ui.info.musicFolderId, ['audio/', 'video/']),
      lazySection('Sons para edições', ui.info.soundsFolderId, ['audio/', 'video/'])
    );

    setChildren(root, 
      h('div', { class: 'dae-top' },
        h('button', { class: 'dae-btn', onclick: requestClose, html: icon('x', 12) + ' Fechar' }),
        h('div', { class: 'dae-title', text: ui.info.name || 'Corte sem nome' }),
        topEls.undo, topEls.redo, topEls.status),
      h('div', { class: 'dae-main' },
        mediaPanel,
        h('section', { class: 'dae-preview' },
          h('div', { class: 'dae-screen', text: 'A prévia do vídeo chega na próxima etapa.' }))),
      h('section', { class: 'dae-timeline' },
        h('div', { class: 'dae-tl-head' },
          h('div', { class: 'dae-h', style: 'margin:0', text: 'Linha do tempo' }),
          h('button', { class: 'dae-btn small', onclick: function () { run('track.addVideo'); }, html: icon('plus', 12) + ' Faixa de vídeo' }),
          h('button', { class: 'dae-btn small', onclick: function () { run('track.addAudio'); }, html: icon('plus', 12) + ' Faixa de áudio' }),
          h('div', { class: 'dae-muted', text: 'Começa vazia: os vídeos do painel de mídia serão arrastados pra cá na próxima etapa.' })),
        tracksEl)
    );
    history.onChange(function () { renderTop(); renderTracks(); });
    renderTop();
    renderTracks();
    refreshDownloadStates();
  }

  function run(id) {
    const r = registry.execute(id, ui);
    if (!r.ok) toast(r.reason, false);
  }

  function renderTop() {
    const hs = ui.history;
    topEls.undo.disabled = !hs.canUndo;
    topEls.redo.disabled = !hs.canRedo;
    topEls.undo.title = hs.canUndo ? 'Desfazer: ' + hs.undoLabel + ' (' + registry.shortcutsOf('edit.undo')[0] + ')' : 'Nada para desfazer';
    topEls.redo.title = hs.canRedo ? 'Refazer: ' + hs.redoLabel + ' (' + registry.shortcutsOf('edit.redo')[0] + ')' : 'Nada para refazer';
    topEls.status.textContent = hs.dirty ? 'Alterações ainda não salvas (o salvamento no Drive chega em breve)' : 'Sem alterações';
  }

  // ---------- timeline: faixas ----------

  function renderTracks() {
    const p = ui.history.project;
    const rows = [h('div', { class: 'dae-tl-label', text: 'Vídeo' })];
    for (let i = p.videoTracks.length - 1; i >= 0; i--) rows.push(trackRow(p.videoTracks[i], i, p.videoTracks.length));
    rows.push(h('div', { class: 'dae-tl-label', text: 'Áudio' }));
    p.audioTracks.forEach(function (t, i) { rows.push(trackRow(t, i, p.audioTracks.length)); });
    setChildren(tracksEl, rows);
  }

  function trackRow(t, index, count) {
    const isVideo = t.kind === 'video';
    const flagOn = isVideo ? t.hidden : t.muted;
    // nas faixas de vídeo, "pra cima" = camada mais alta (índice maior); nas de áudio a lista já é de cima pra baixo
    const upDelta = isVideo ? +1 : -1;
    const canUp = isVideo ? index < count - 1 : index > 0;
    const canDown = isVideo ? index > 0 : index < count - 1;

    const name = h('div', { class: 'dae-track-name', title: 'Duplo clique para renomear', text: t.name });
    name.addEventListener('dblclick', function () { startRename(name, t); });

    const head = h('div', { class: 'dae-track-head' },
      name,
      h('button', { class: 'dae-ibtn' + (flagOn ? ' on' : ''), title: isVideo ? (t.hidden ? 'Mostrar faixa' : 'Ocultar faixa') : (t.muted ? 'Tirar do mudo' : 'Silenciar faixa'),
        html: icon(isVideo ? (t.hidden ? 'eyeOff' : 'eye') : (t.muted ? 'volumeOff' : 'volume')),
        onclick: function () { edit((isVideo ? 'Ocultar' : 'Silenciar') + ' faixa', function (d) { setTrackFlags(d, t.id, isVideo ? { hidden: !t.hidden } : { muted: !t.muted }); }); } }),
      h('button', { class: 'dae-ibtn' + (t.locked ? ' on' : ''), title: t.locked ? 'Desbloquear faixa' : 'Bloquear faixa', html: icon(t.locked ? 'lock' : 'unlock'),
        onclick: function () { edit((t.locked ? 'Desbloquear' : 'Bloquear') + ' faixa', function (d) { setTrackFlags(d, t.id, { locked: !t.locked }); }); } }),
      h('button', { class: 'dae-ibtn', title: 'Mover para cima', html: icon('up'), disabled: !canUp,
        onclick: function () { edit('Mover faixa', function (d) { moveTrack(d, t.id, upDelta); }); } }),
      h('button', { class: 'dae-ibtn', title: 'Mover para baixo', html: icon('down'), disabled: !canDown,
        onclick: function () { edit('Mover faixa', function (d) { moveTrack(d, t.id, -upDelta); }); } }),
      h('button', { class: 'dae-ibtn', title: 'Remover faixa', html: icon('x'),
        onclick: function () { removeTrackUi(t); } })
    );
    return h('div', { class: 'dae-track ' + t.kind, 'data-id': t.id }, head, h('div', { class: 'dae-lane' }));
  }

  function startRename(nameEl, t) {
    const input = h('input', { class: 'dae-input', value: t.name, maxlength: '40' });
    let done = false;
    function commit(save) {
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (save && v && v !== t.name) edit('Renomear faixa', function (d) { renameTrack(d, t.id, v); });
      else renderTracks();
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') commit(true);
      else if (e.key === 'Escape') commit(false);
      e.stopPropagation();
    });
    input.addEventListener('blur', function () { commit(true); });
    setChildren(nameEl, input);
    input.focus();
    input.select();
  }

  function removeTrackUi(t) {
    if (t.clips.length && !confirm('A faixa "' + t.name + '" tem ' + t.clips.length + ' clipe(s). Remover mesmo assim?')) return;
    edit('Remover faixa "' + t.name + '"', function (d) { removeTrack(d, t.id); });
  }

  // ---------- painel de mídia: vídeo bruto ----------

  function renderMediaItem(item) {
    const el = h('div', { class: 'dae-mi' });
    ui.els[item.id] = el;
    fillMediaItem(item);
    return el;
  }

  function mediaMeta(item) {
    return [item.width && item.height ? item.width + '×' + item.height : null, formatDuration(item.durationUs), item.size != null ? fmtBytes(item.size) : 'tamanho desconhecido']
      .filter(Boolean).join(' · ');
  }

  function fillMediaItem(item) {
    const el = ui.els[item.id];
    const st = ui.dl[item.id] || { state: 'checking' };
    const row = h('div', { class: 'dae-mi-row' });

    if (st.state === 'checking') {
      row.append(h('span', { class: 'dae-muted', text: 'Verificando o que já está no navegador…' }));
    } else if (st.state === 'downloading') {
      row.append(
        h('div', { class: 'dae-bar' }, h('i', { 'data-bar': '1' })),
        h('span', { class: 'dae-muted', 'data-txt': '1', text: '0%' }),
        h('button', { class: 'dae-btn small', text: 'Cancelar', onclick: function () { if (st.ctl) st.ctl.abort(); } })
      );
    } else if (st.state === 'complete') {
      row.append(
        h('span', { class: 'dae-ok', text: 'Pronto no navegador' }),
        h('button', { class: 'dae-btn small', text: 'Remover do navegador', onclick: function () { removeFromCache(item); } })
      );
    } else if (item.size == null) {
      row.append(h('span', { class: 'dae-err', text: 'O Drive não informou o tamanho; não dá pra baixar.' }));
    } else {
      const partial = st.state === 'partial' && st.downloaded > 0;
      row.append(h('button', { class: 'dae-btn primary small', html: icon('download', 12) + (partial ? ' Continuar (' + Math.round(st.downloaded / item.size * 100) + '%)' : ' Baixar'),
        onclick: function () { startDownload(item); } }));
    }

    setChildren(el, 
      h('div', { class: 'dae-mi-name', text: item.name }),
      h('div', { class: 'dae-mi-meta', text: mediaMeta(item) }),
      row,
      st.error ? h('div', { class: 'dae-err', text: st.error }) : null,
      h('button', { class: 'dae-btn small', disabled: true, title: 'Chega na próxima etapa', text: 'Adicionar à timeline' })
    );
    if (st.state === 'downloading') paintProgress(item);
  }

  function paintProgress(item) {
    const st = ui.dl[item.id];
    const el = ui.els[item.id];
    if (!st || !el) return;
    const bar = el.querySelector('[data-bar]'), txt = el.querySelector('[data-txt]');
    if (!bar || !txt) return;
    const pct = st.total ? Math.floor(st.done / st.total * 100) : 0;
    bar.style.width = pct + '%';
    const secs = Math.max(0.5, (Date.now() - st.t0) / 1000);
    const speed = st.done > st.base ? ' · ' + fmtBytes((st.done - st.base) / secs) + '/s' : '';
    txt.textContent = pct + '%' + speed;
  }

  async function refreshDownloadStates() {
    for (let i = 0; i < ui.items.length && !closed; i++) {
      const it = ui.items[i];
      if (it.size == null) { ui.dl[it.id] = { state: 'none' }; fillMediaItem(it); continue; }
      try {
        const s = await ui.cache.status(it.id, it);
        if (closed) return;
        if (!ui.dl[it.id] || ui.dl[it.id].state === 'checking') ui.dl[it.id] = { state: s.state, downloaded: s.downloaded };
      } catch (e) {
        ui.dl[it.id] = { state: 'none', error: 'Não consegui ler o armazenamento do navegador: ' + e.message };
      }
      fillMediaItem(it);
    }
  }

  async function startDownload(item) {
    if (ui.dl[item.id] && ui.dl[item.id].state === 'downloading') return;
    const ctl = new AbortController();
    downloads.add(ctl);
    const before = ui.dl[item.id] || {};
    const st = { state: 'downloading', ctl: ctl, done: before.downloaded || 0, base: before.downloaded || 0, total: item.size, t0: Date.now() };
    ui.dl[item.id] = st;
    fillMediaItem(item);
    try {
      await ui.cache.ensure(item.id, item, {
        signal: ctl.signal,
        fetchRange: function (s, e, sig) { return ui.drive.fetchRange(item.id, s, e, sig); },
        onProgress: function (done) { st.done = done; if (!closed) paintProgress(item); }
      });
      ui.dl[item.id] = { state: 'complete' };
      toast('"' + item.name + '" baixado e guardado no navegador.', false);
    } catch (e) {
      if (e && e.name === 'AbortError') {
        const s = await ui.cache.status(item.id, item).catch(function () { return { state: 'none', downloaded: 0 }; });
        ui.dl[item.id] = { state: s.state, downloaded: s.downloaded };
      } else {
        const s = await ui.cache.status(item.id, item).catch(function () { return { state: 'none', downloaded: 0 }; });
        ui.dl[item.id] = { state: s.state, downloaded: s.downloaded, error: e.message };
        toast(e.message, true);
      }
    } finally {
      downloads.delete(ctl);
      if (!closed) fillMediaItem(item);
    }
  }

  async function removeFromCache(item) {
    try { await ui.cache.remove(item.id); ui.dl[item.id] = { state: 'none' }; }
    catch (e) { toast('Não consegui remover: ' + e.message, true); }
    fillMediaItem(item);
  }

  // ---------- painel de mídia: pastas de músicas e sons (carregam ao abrir) ----------

  function lazySection(title, folderId, prefixes) {
    const body = h('div', { class: 'dae-sec-body' });
    const sec = h('div', { class: 'dae-sec' });
    let loaded = false;
    const head = h('button', { class: 'dae-sec-head', html: icon('chevron', 12) });
    head.append(document.createTextNode(' ' + title));
    head.addEventListener('click', function () {
      sec.classList.toggle('open');
      if (sec.classList.contains('open') && !loaded) { loaded = true; load(); }
    });
    sec.append(head, body);

    async function load() {
      setChildren(body, h('div', { class: 'dae-muted', text: 'Carregando…' }));
      try {
        const files = await ui.drive.listFolder(folderId, { mimePrefixes: prefixes });
        if (closed) return;
        if (!files.length) { setChildren(body, h('div', { class: 'dae-muted', text: 'Nenhum arquivo de áudio nessa pasta.' })); return; }
        const list = h('div', {});
        const draw = function (q) {
          const f = q ? files.filter(function (x) { return x.name.toLowerCase().indexOf(q) !== -1; }) : files;
          setChildren(list, f.map(function (x) {
            return h('div', { class: 'dae-li', title: x.name }, h('span', { text: x.name }), h('span', { text: x.durationUs ? formatDuration(x.durationUs) : fmtBytes(x.size) }));
          }));
          if (!f.length) list.append(h('div', { class: 'dae-muted', text: 'Nada encontrado.' }));
        };
        const search = h('input', { class: 'dae-input', placeholder: 'Buscar (' + files.length + ')…', style: 'margin-bottom:6px' });
        search.addEventListener('input', function () { draw(search.value.trim().toLowerCase()); });
        search.addEventListener('keydown', function (e) { e.stopPropagation(); });
        setChildren(body, files.length > 8 ? search : null, list);
        draw('');
      } catch (e) {
        loaded = false;
        setChildren(body, h('div', { class: 'dae-err', text: e.message }));
      }
    }
    return sec;
  }

  return { close: finish };
}
