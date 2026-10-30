// Montagem de elementos sem framework. Textos dinâmicos (nomes de arquivos etc.) entram SEMPRE como
// texto, nunca como HTML — só os ícones (strings fixas daqui) usam innerHTML.
export function h(tag, attrs) {
  const el = document.createElement(tag);
  const a = attrs || {};
  Object.keys(a).forEach(function (k) {
    const v = a[k];
    if (v == null || v === false) return;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  });
  for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
  return el;
}

function append(el, child) {
  if (child == null || child === false) return;
  if (Array.isArray(child)) { child.forEach(function (c) { append(el, c); }); return; }
  el.appendChild(child.nodeType ? child : document.createTextNode(String(child)));
}

const P = {
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 00-15-6.7L3 13"/>',
  redo: '<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0115-6.7L21 13"/>',
  eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M17.94 17.94A10.07 10.07 0 0112 19c-7 0-11-7-11-7a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 7 11 7a18.5 18.5 0 01-2.16 3.19"/><path d="M1 1l22 22"/>',
  volume: '<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 010 7"/>',
  volumeOff: '<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M22 9l-6 6M16 9l6 6"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>',
  unlock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 019.9-1"/>',
  up: '<path d="M18 15l-6-6-6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/>',
  film: '<rect x="2" y="2" width="20" height="20" rx="2.2"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>'
};

export function icon(name, size) {
  const s = size || 14;
  return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (P[name] || '') + '</svg>';
}

export function fmtBytes(n) {
  if (n == null) return '';
  if (n < 1048576) return Math.max(1, Math.round(n / 1024)) + ' KB';
  const mb = n / 1048576;
  if (mb >= 1024) return (mb / 1024).toFixed(2).replace('.', ',') + ' GB';
  return mb.toFixed(mb >= 100 ? 0 : 1).replace('.', ',') + ' MB';
}

function flatten(list, out) {
  list.forEach(function (c) {
    if (Array.isArray(c)) flatten(c, out);
    else if (c != null && c !== false) out.push(c.nodeType ? c : document.createTextNode(String(c)));
  });
  return out;
}

// Troca TODO o conteúdo de um elemento. Aceita nós, textos, listas e ignora null/false
// (o replaceChildren nativo escreveria a palavra "null" na tela).
export function setChildren(el) {
  el.replaceChildren.apply(el, flatten(Array.prototype.slice.call(arguments, 1), []));
}
