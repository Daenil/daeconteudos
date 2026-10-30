// Junta tudo em UM arquivo (editor.js) na pasta que vai pro GitHub (../github-upload/editor/).
// Usa o esbuild via npx — não instala nada dentro desta pasta (que fica no Drive).
import { spawnSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '..', 'github-upload', 'editor', 'editor.js');
mkdirSync(dirname(out), { recursive: true });

const args = [
  '--yes', 'esbuild@0.25.0', 'src/main.js',
  '--bundle', '--minify', '--format=iife', '--target=es2020', '--legal-comments=none',
  '--banner:js=/*EditorDePaineldeCortes-gerado-por-build.mjs-nao-edite-este-arquivo*/',
  '--outfile="' + out + '"'
];
const r = spawnSync('npx', args, { cwd: here, stdio: 'inherit', shell: true });
if (r.status !== 0) process.exit(r.status || 1);
console.log('OK -> ' + out + ' (' + Math.round(statSync(out).size / 1024) + ' KB)');
