// Estilos do editor (injetados uma vez). Usa as cores do site (--surface, --accent...) com valores
// de reserva, e tudo começa com "dae-" pra nunca esbarrar no CSS do painel.
export const STYLES = `
.dae-root { position: fixed; inset: 0; z-index: 190; display: flex; flex-direction: column; background: var(--bg, #0b0c10); color: var(--text, #eceef1);
  font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; outline: none; }
.dae-root * { box-sizing: border-box; }
.dae-top { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: var(--surface, #131519); border-bottom: 1px solid var(--border, rgba(255,255,255,.08)); flex: none; }
.dae-title { font-weight: 700; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.dae-status { color: var(--text-dim, #9a9ea8); font-size: 12px; margin-left: auto; white-space: nowrap; }
.dae-btn { display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: 12.5px; padding: 6px 10px; border-radius: var(--radius-sm, 8px); cursor: pointer;
  border: 1px solid var(--border-strong, rgba(255,255,255,.14)); background: var(--surface-2, #191c22); color: var(--text, #eceef1); min-height: 30px; }
.dae-btn:hover:not(:disabled) { background: var(--surface-hover, #1e2129); }
.dae-btn:disabled { opacity: .45; cursor: default; }
.dae-btn.primary { background: var(--accent, #6469e0); border-color: var(--accent, #6469e0); color: #fff; }
.dae-btn.primary:hover:not(:disabled) { background: var(--accent-hover, #7378e8); }
.dae-btn.danger { color: var(--danger, #ef5a68); }
.dae-btn.small { padding: 3px 7px; min-height: 24px; font-size: 12px; }
.dae-ibtn { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border-radius: 6px; cursor: pointer; font: inherit;
  border: 1px solid transparent; background: transparent; color: var(--text-dim, #9a9ea8); }
.dae-ibtn:hover:not(:disabled) { background: var(--surface-hover, #1e2129); color: var(--text, #eceef1); }
.dae-ibtn:disabled { opacity: .3; cursor: default; }
.dae-ibtn.on { color: var(--warn, #e8a33d); }
.dae-main { display: flex; flex: 1; min-height: 0; }
.dae-media { width: 320px; flex: none; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; padding: 12px; background: var(--surface, #131519); border-right: 1px solid var(--border, rgba(255,255,255,.08)); }
.dae-h { font-size: 11px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; color: var(--text-faint, #6b6f78); margin: 2px 0 6px; }
.dae-mi { border: 1px solid var(--border, rgba(255,255,255,.08)); border-radius: var(--radius-md, 10px); padding: 10px; background: var(--surface-2, #191c22); display: flex; flex-direction: column; gap: 6px; }
.dae-mi + .dae-mi { margin-top: 8px; }
.dae-mi-name { font-weight: 600; overflow-wrap: anywhere; }
.dae-mi-meta { color: var(--text-dim, #9a9ea8); font-size: 12px; }
.dae-mi-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dae-bar { height: 6px; border-radius: 4px; background: var(--border, rgba(255,255,255,.08)); overflow: hidden; flex: 1; min-width: 80px; }
.dae-bar > i { display: block; height: 100%; width: 0; background: var(--accent, #6469e0); transition: width .15s linear; }
.dae-ok { color: var(--success, #34c77b); font-weight: 600; }
.dae-err { color: var(--danger, #ef5a68); font-size: 12px; }
.dae-muted { color: var(--text-dim, #9a9ea8); font-size: 12px; }
.dae-sec-head { display: flex; align-items: center; justify-content: flex-start; gap: 6px; width: 100%; background: none; border: 0; color: var(--text, #eceef1); font: inherit; font-weight: 600; cursor: pointer; padding: 6px 0; text-align: left; }
.dae-sec-head svg { transition: transform .15s; }
.dae-sec.open .dae-sec-head svg { transform: rotate(90deg); }
.dae-sec-body { display: none; padding: 2px 0 6px; }
.dae-sec.open .dae-sec-body { display: block; }
.dae-li { display: flex; justify-content: space-between; gap: 8px; padding: 4px 6px; border-radius: 6px; font-size: 12.5px; }
.dae-li:hover { background: var(--surface-hover, #1e2129); }
.dae-li span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dae-li span:last-child { color: var(--text-faint, #6b6f78); flex: none; }
.dae-input { font: inherit; padding: 5px 8px; border-radius: 6px; border: 1px solid var(--border-strong, rgba(255,255,255,.14)); background: var(--bg, #0b0c10); color: var(--text, #eceef1); width: 100%; }
.dae-preview { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: center; padding: 14px; background: #07080b; }
.dae-screen { height: 100%; max-height: 100%; aspect-ratio: 9 / 16; max-width: 100%; display: flex; align-items: center; justify-content: center; text-align: center; padding: 20px;
  border: 1px dashed var(--border-strong, rgba(255,255,255,.14)); border-radius: 10px; color: var(--text-faint, #6b6f78); background: #000; }
.dae-timeline { flex: none; height: 34vh; min-height: 220px; display: flex; flex-direction: column; background: var(--surface, #131519); border-top: 1px solid var(--border, rgba(255,255,255,.08)); }
.dae-tl-head { display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-bottom: 1px solid var(--border, rgba(255,255,255,.08)); }
.dae-tl-body { flex: 1; overflow: auto; }
.dae-tl-label { position: sticky; left: 0; padding: 6px 12px 2px; font-size: 11px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; color: var(--text-faint, #6b6f78); }
.dae-track { display: flex; min-width: 900px; border-bottom: 1px solid var(--border, rgba(255,255,255,.08)); }
.dae-track-head { width: 230px; flex: none; position: sticky; left: 0; z-index: 2; display: flex; align-items: center; gap: 2px; padding: 4px 8px; background: var(--surface-2, #191c22); border-right: 1px solid var(--border, rgba(255,255,255,.08)); }
.dae-track-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: text; padding: 2px 4px; border-radius: 4px; }
.dae-track-name:hover { background: var(--surface-hover, #1e2129); }
.dae-lane { flex: 1; min-height: 42px; background: repeating-linear-gradient(90deg, transparent 0 99px, rgba(255,255,255,.04) 99px 100px); }
.dae-track.video .dae-lane { background-color: rgba(100,105,224,.05); }
.dae-track.audio .dae-lane { background-color: rgba(52,199,123,.04); }
.dae-empty { padding: 10px 14px; color: var(--text-faint, #6b6f78); }
.dae-center { margin: auto; padding: 30px; text-align: center; max-width: 460px; display: flex; flex-direction: column; gap: 12px; align-items: center; }
@media (max-width: 900px) { .dae-media { width: 260px; } .dae-track-head { width: 190px; } }
`;
