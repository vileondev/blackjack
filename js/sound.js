// Efeitos sonoros sintetizados com Web Audio: sem arquivos, funcionam offline.
let ctx = null;
let master = null;
let enabled = true;

/** Precisa ser chamado depois de um toque/clique (regra dos navegadores para áudio). */
export function unlock() {
  if (!ctx) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}

export function setEnabled(on) { enabled = !!on; }

function ready() { return enabled && ctx && ctx.state === 'running'; }

let noiseBuf = null;
function noise() {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  return s;
}

function env(node, t, a, peak, dur) {
  node.gain.setValueAtTime(0.0001, t);
  node.gain.exponentialRampToValueAtTime(peak, t + a);
  node.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

/** Ruído filtrado: carta deslizando na mesa. */
function swish(t, { freq = 2400, q = 0.8, dur = 0.12, vol = 0.5 } = {}) {
  const src = noise();
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.Q.value = q;
  f.frequency.setValueAtTime(freq * 1.6, t);
  f.frequency.exponentialRampToValueAtTime(freq * 0.6, t + dur);
  const g = ctx.createGain(); env(g, t, 0.008, vol, dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.3); src.stop(t + dur + 0.02);
}

function tone(t, freq, { type = 'sine', dur = 0.25, vol = 0.25, a = 0.01, slide = 0 } = {}) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  const g = ctx.createGain(); env(g, t, a, vol, dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

const SOUNDS = {
  card(t) { swish(t, { freq: 2600, dur: 0.11, vol: 0.45 }); tone(t + 0.07, 180, { type: 'triangle', dur: 0.05, vol: 0.12 }); },
  flip(t) { swish(t, { freq: 3400, dur: 0.08, vol: 0.3 }); swish(t + 0.05, { freq: 1800, dur: 0.07, vol: 0.25 }); },
  chip(t) {
    tone(t, 2400, { type: 'triangle', dur: 0.07, vol: 0.18 });
    tone(t + 0.035, 3100, { type: 'triangle', dur: 0.08, vol: 0.12 });
    swish(t, { freq: 5000, q: 2, dur: 0.04, vol: 0.12 });
  },
  bet(t) { for (let i = 0; i < 3; i++) SOUNDS.chip(t + i * 0.055); },
  shuffle(t) { for (let i = 0; i < 14; i++) swish(t + i * 0.045 + Math.random() * 0.01, { freq: 2000 + Math.random() * 1500, dur: 0.06, vol: 0.28 }); },
  win(t) { [523.25, 659.25, 783.99].forEach((f, i) => tone(t + i * 0.09, f, { dur: 0.35, vol: 0.16 })); },
  blackjack(t) {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(t + i * 0.08, f, { dur: 0.45, vol: 0.16 }));
    [1568, 2093].forEach((f, i) => tone(t + 0.36 + i * 0.06, f, { type: 'triangle', dur: 0.3, vol: 0.06 }));
  },
  lose(t) { tone(t, 330, { dur: 0.25, vol: 0.14, slide: 0.9 }); tone(t + 0.16, 247, { dur: 0.4, vol: 0.14, slide: 0.85 }); },
  push(t) { tone(t, 440, { dur: 0.25, vol: 0.12 }); tone(t + 0.12, 440, { dur: 0.25, vol: 0.1 }); },
  bust(t) { tone(t, 140, { type: 'triangle', dur: 0.3, vol: 0.28, slide: 0.5 }); swish(t, { freq: 600, dur: 0.18, vol: 0.2 }); },
  tap(t) { tone(t, 900, { type: 'triangle', dur: 0.04, vol: 0.06 }); },
};

export function play(name) {
  if (!ready() || !SOUNDS[name]) return;
  try { SOUNDS[name](ctx.currentTime + 0.005); } catch { /* áudio indisponível */ }
}
