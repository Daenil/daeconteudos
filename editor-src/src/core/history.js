import { validate } from './project.js';

// Desfazer/refazer. Cada edição trabalha numa CÓPIA do projeto: se algo der errado (regra violada,
// erro de uma operação), a cópia é jogada fora e o projeto continua intacto. Quando dá certo, o
// projeto antigo vai para a pilha de "desfazer" (até 200 passos).
function clone(p) { return JSON.parse(JSON.stringify(p)); }

export class History {
  constructor(project, opts) {
    opts = opts || {};
    this._p = project;
    this._limit = opts.limit || 200;
    this._undo = [];
    this._redo = [];
    this._listeners = new Set();
    this._merge = null;
    this._saved = project;
  }

  get project() { return this._p; }
  get canUndo() { return this._undo.length > 0; }
  get canRedo() { return this._redo.length > 0; }
  get undoLabel() { return this._undo.length ? this._undo[this._undo.length - 1].label : ''; }
  get redoLabel() { return this._redo.length ? this._redo[this._redo.length - 1].label : ''; }
  get dirty() { return this._p !== this._saved; }

  markSaved() { this._saved = this._p; this._emit('saved'); }

  onChange(cb) {
    this._listeners.add(cb);
    const self = this;
    return function () { self._listeners.delete(cb); };
  }

  _emit(kind, label) {
    const self = this;
    this._listeners.forEach(function (cb) { cb(kind, label, self._p); });
  }

  // fn(draft) altera a cópia. mergeKey: edições seguidas com a mesma chave (ex.: arrastar um
  // controle) viram UM passo de desfazer.
  edit(label, fn, opts) {
    opts = opts || {};
    const draft = clone(this._p);
    const result = fn(draft);
    validate(draft);
    const t = (opts.now || Date.now)();
    const window_ = opts.mergeWindowMs == null ? 1000 : opts.mergeWindowMs;
    if (opts.mergeKey && this._merge && this._merge.key === opts.mergeKey && t - this._merge.t <= window_ && this._undo.length) {
      this._merge.t = t;
    } else {
      this._undo.push({ label: label, project: this._p });
      if (this._undo.length > this._limit) this._undo.shift();
      this._merge = opts.mergeKey ? { key: opts.mergeKey, t: t } : null;
    }
    this._redo.length = 0;
    this._p = draft;
    this._emit('edit', label);
    return result;
  }

  undo() {
    const e = this._undo.pop();
    if (!e) return false;
    this._redo.push({ label: e.label, project: this._p });
    this._p = e.project;
    this._merge = null;
    this._emit('undo', e.label);
    return true;
  }

  redo() {
    const e = this._redo.pop();
    if (!e) return false;
    this._undo.push({ label: e.label, project: this._p });
    this._p = e.project;
    this._merge = null;
    this._emit('redo', e.label);
    return true;
  }
}
