// Tiny synthesized sound effects via the Web Audio API. No audio files needed.
// Everything routes through a soft low-pass master so the tones stay warm and
// "icy" rather than harsh beeps. The AudioContext is created lazily and resumed
// on first use (always inside a tap gesture), satisfying the autoplay policy.
// A mute preference persists locally.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let enabled = true;
const STORE_KEY = 'icehop.sound';

export const initAudioPrefs = (): void => {
  try {
    enabled = localStorage.getItem(STORE_KEY) !== 'off';
  } catch {
    enabled = true;
  }
};

export const isSoundOn = (): boolean => enabled;

export const setSoundOn = (on: boolean): void => {
  enabled = on;
  try {
    localStorage.setItem(STORE_KEY, on ? 'on' : 'off');
  } catch {
    /* ignore storage failures */
  }
};

const audio = (): AudioContext | null => {
  if (!enabled) return null;
  const AC = window.AudioContext;
  if (!AC) return null;
  if (!ctx) {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.85;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 6500;
    master.connect(lp).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
};

const out = (ac: AudioContext): AudioNode => master ?? ac.destination;

const noise = (ac: AudioContext): AudioBuffer => {
  if (!noiseBuf) {
    const len = Math.floor(ac.sampleRate * 0.4);
    noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
};

type Tone = {
  freq: number;
  dur: number;
  at: number;
  type?: OscillatorType;
  gain?: number;
  slideTo?: number;
  attack?: number;
};

const tone = (ac: AudioContext, o: Tone): void => {
  const osc = ac.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.freq, o.at);
  if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, o.at + o.dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, o.at);
  g.gain.exponentialRampToValueAtTime(o.gain ?? 0.05, o.at + (o.attack ?? 0.01));
  g.gain.exponentialRampToValueAtTime(0.0001, o.at + o.dur);
  osc.connect(g).connect(out(ac));
  osc.start(o.at);
  osc.stop(o.at + o.dur + 0.03);
};

// A glockenspiel-ish bell note: a sine plus a quieter octave, with a long
// shimmering tail. Reads as icy/twinkly.
const bell = (ac: AudioContext, freq: number, at: number, gain: number, dur: number): void => {
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  g.connect(out(ac));
  const o1 = ac.createOscillator();
  o1.type = 'sine';
  o1.frequency.value = freq;
  o1.connect(g);
  const o2 = ac.createOscillator();
  o2.type = 'sine';
  o2.frequency.value = freq * 2;
  const g2 = ac.createGain();
  g2.gain.value = 0.35;
  o2.connect(g2).connect(g);
  o1.start(at);
  o2.start(at);
  o1.stop(at + dur + 0.03);
  o2.stop(at + dur + 0.03);
};

/** A light, cute penguin hop ("plip"). */
export const playHop = (): void => {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  tone(ac, { freq: 360, slideTo: 560, dur: 0.1, type: 'sine', gain: 0.05, at: t });
  tone(ac, { freq: 720, slideTo: 1120, dur: 0.08, type: 'triangle', gain: 0.016, at: t });
};

/** A soft "shhh" of a seal sliding across ice (filtered noise sweep). */
export const playSlide = (): void => {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  const src = ac.createBufferSource();
  src.buffer = noise(ac);
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 0.7;
  bp.frequency.setValueAtTime(1900, t);
  bp.frequency.exponentialRampToValueAtTime(550, t + 0.18);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  src.connect(bp).connect(g).connect(out(ac));
  src.start(t);
  src.stop(t + 0.22);
};

/** A watery "bloop" with a little droplet tick as a penguin dives in. */
export const playSplash = (): void => {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  tone(ac, { freq: 240, slideTo: 680, dur: 0.16, type: 'sine', gain: 0.06, at: t });
  const src = ac.createBufferSource();
  src.buffer = noise(ac);
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2600;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.03, t + 0.035);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  src.connect(hp).connect(g).connect(out(ac));
  src.start(t + 0.02);
  src.stop(t + 0.14);
};

/** A twinkly music-box arpeggio for a win, with a final high shimmer. */
export const playWin = (): void => {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((f, i) => bell(ac, f, t + i * 0.1, 0.06, 0.6));
  bell(ac, 1318.51, t + notes.length * 0.1 + 0.04, 0.04, 0.85); // E6 shimmer
};
