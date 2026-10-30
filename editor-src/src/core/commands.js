// Registro de comandos: toda ação do editor (desfazer, dividir, apagar...) é um comando com id,
// rótulo, atalhos padrão e uma checagem de "pode rodar agora?". É isso que permite o editor de
// atalhos (os editores trocam as teclas sem mexer no código) e, no futuro, uma paleta de comandos.

const MODS = ['Ctrl', 'Alt', 'Shift'];

// "ctrl+shift+z" / "Shift+Ctrl+Z" / "Cmd+Z"  ->  "Ctrl+Shift+Z"
export function normalizeCombo(str) {
  const parts = String(str || '').split('+').map(function (s) { return s.trim(); }).filter(Boolean);
  if (!parts.length) return '';
  const mods = new Set();
  let key = '';
  parts.forEach(function (raw) {
    const low = raw.toLowerCase();
    if (low === 'ctrl' || low === 'control' || low === 'cmd' || low === 'meta') mods.add('Ctrl');
    else if (low === 'alt' || low === 'option') mods.add('Alt');
    else if (low === 'shift') mods.add('Shift');
    else key = raw.length === 1 ? raw.toUpperCase() : raw[0].toUpperCase() + raw.slice(1);
  });
  if (key === ' ') key = 'Space';
  return MODS.filter(function (m) { return mods.has(m); }).concat(key ? [key] : []).join('+');
}

// Evento de teclado -> combinação normalizada ("" quando só tem modificador apertado).
export function comboFromEvent(e) {
  let key = e.key;
  if (!key || key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') return '';
  if (key === ' ') key = 'Space';
  const mods = [];
  if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  return normalizeCombo(mods.concat([key]).join('+'));
}

export class CommandRegistry {
  constructor() {
    this._cmds = new Map();
    this._overrides = {};
  }

  // cmd: { id, label, shortcuts?: ['Ctrl+Z'], enabled?(ctx) -> true | 'motivo', run(ctx, args) }
  register(cmd) {
    if (!cmd.id || typeof cmd.run !== 'function') throw new Error('Comando inválido.');
    if (this._cmds.has(cmd.id)) throw new Error('Comando já registrado: ' + cmd.id);
    this._cmds.set(cmd.id, Object.assign({ shortcuts: [], enabled: function () { return true; } }, cmd, {
      shortcuts: (cmd.shortcuts || []).map(normalizeCombo)
    }));
    return this;
  }

  get(id) { return this._cmds.get(id) || null; }
  list() { return Array.from(this._cmds.values()); }

  shortcutsOf(id) {
    const c = this._cmds.get(id);
    if (!c) return [];
    return this._overrides[id] !== undefined ? this._overrides[id] : c.shortcuts;
  }

  // Troca as teclas de um comando. Recusa se alguma já for de outro comando.
  setShortcuts(id, combos) {
    if (!this._cmds.has(id)) throw new Error('Comando desconhecido: ' + id);
    const list = (combos || []).map(normalizeCombo).filter(Boolean);
    const self = this;
    list.forEach(function (combo) {
      const owner = self.findByCombo(combo);
      if (owner && owner !== id) throw new Error('"' + combo + '" já é o atalho de "' + self._cmds.get(owner).label + '".');
    });
    this._overrides[id] = list;
  }

  resetShortcuts(id) { delete this._overrides[id]; }

  findByCombo(combo) {
    combo = normalizeCombo(combo);
    if (!combo) return null;
    const cmds = this.list();
    for (let i = 0; i < cmds.length; i++) {
      if (this.shortcutsOf(cmds[i].id).indexOf(combo) !== -1) return cmds[i].id;
    }
    return null;
  }

  // O que o editor guardou de personalizado (para salvar nas preferências).
  exportOverrides() { return JSON.parse(JSON.stringify(this._overrides)); }

  importOverrides(obj) {
    this._overrides = {};
    const self = this;
    Object.keys(obj || {}).forEach(function (id) {
      if (self._cmds.has(id) && Array.isArray(obj[id])) self._overrides[id] = obj[id].map(normalizeCombo).filter(Boolean);
    });
  }

  // { ok:true, result } | { ok:false, reason }
  execute(id, ctx, args) {
    const cmd = this._cmds.get(id);
    if (!cmd) return { ok: false, reason: 'Comando desconhecido.' };
    const can = cmd.enabled(ctx);
    if (can !== true) return { ok: false, reason: typeof can === 'string' ? can : 'Não dá pra fazer isso agora.' };
    return { ok: true, result: cmd.run(ctx, args) };
  }
}
