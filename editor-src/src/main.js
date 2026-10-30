import { openEditor } from './ui/app.js';

// Única coisa que o painel enxerga: window.DaeEditor.
//   apiVersion — precisa bater com EDITOR_API_VERSION do servidor (Código.js)
//   open(host) — abre o editor por cima do painel; devolve { close() }
const api = {
  apiVersion: 1,
  version: '0.1.0',
  open: function (host, deps) { return openEditor(host, deps); }
};

window.DaeEditor = api;
