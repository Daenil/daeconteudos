// Todo tempo do editor é um número INTEIRO em microssegundos (o mesmo que o WebCodecs usa).
// Assim as contas de corte/posição não acumulam erro de ponto flutuante.
export const US = 1000000;

export const secToUs = (s) => Math.round(s * US);
export const usToSec = (us) => us / US;
export const frameDurationUs = (fps) => Math.round(US / fps);

// Alinha um instante ao quadro mais próximo.
export function snapToFrame(us, fps) {
  const frame = US / fps;
  return Math.round(Math.round(us / frame) * frame);
}

function pad(n) { return String(n).padStart(2, '0'); }

// MM:SS:QQ (minutos, segundos, quadros)
export function formatTimecode(us, fps = 30) {
  const f = Math.max(1, Math.round(fps));
  const totalFrames = Math.max(0, Math.round((us / US) * f));
  const frames = totalFrames % f;
  const totalSec = Math.floor(totalFrames / f);
  return pad(Math.floor(totalSec / 60)) + ':' + pad(totalSec % 60) + ':' + pad(frames);
}

// "9:27" / "1:02:03" para durações mostradas em listas.
export function formatDuration(us) {
  if (us == null || !isFinite(us)) return '--:--';
  const total = Math.round(us / US);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
}
