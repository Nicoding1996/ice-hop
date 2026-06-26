// Tiny synthesized sound effects via the Web Audio API. No audio files needed.
// Everything routes through a soft low-pass master so the tones stay warm and
// "icy" rather than harsh beeps. The AudioContext is created lazily and resumed
// on first use (always inside a tap gesture), satisfying the autoplay policy.
// A mute preference persists locally.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let enabled = true;
let musicEnabled = false;
const STORE_KEY = 'icehop.sound';
const MUSIC_KEY = 'icehop.music';

export const initAudioPrefs = (): void => {
  try {
    enabled = localStorage.getItem(STORE_KEY) !== 'off';
  } catch {
    enabled = true;
  }
  try {
    // Music is opt-in (default off): Reddit is a feed people scroll with the
    // sound down, so we never start a soundtrack uninvited.
    musicEnabled = localStorage.getItem(MUSIC_KEY) === 'on';
  } catch {
    musicEnabled = false;
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

export const isMusicOn = (): boolean => musicEnabled;

export const setMusicOn = (on: boolean): void => {
  musicEnabled = on;
  try {
    localStorage.setItem(MUSIC_KEY, on ? 'on' : 'off');
  } catch {
    /* ignore storage failures */
  }
  if (on) startMusic();
  else stopMusic();
};

// Lazily create (and resume) the shared AudioContext + the soft master bus.
// Split out from audio() so music can use the context independently of the SFX
// mute (the two have separate toggles).
const ensureCtx = (): AudioContext | null => {
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

const audio = (): AudioContext | null => {
  if (!enabled) return null;
  return ensureCtx();
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
// shimmering tail. Reads as icy/twinkly. Routes to `dest` (the SFX master by
// default; the music bed passes its own gain bus so twinkles fade with it).
const bell = (
  ac: AudioContext,
  freq: number,
  at: number,
  gain: number,
  dur: number,
  dest: AudioNode = out(ac)
): void => {
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  g.connect(dest);
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

// --- Background music: a real, looping ambient track ------------------------
// Synthesis could not sound like real instruments, so the soundtrack is now a
// recorded loop (src/client/public/ice-hop-music.ogg, copied to the client root
// at build time). It is fetched and decoded once into a Web Audio buffer, then
// looped gaplessly through its own quiet gain - independent of the SFX mute, and
// paused with the shared context on tab-hide. Only in the expanded game view;
// opt-in via the hub toggle (default off, the feed is muted). If the file is
// ever missing or undecodable it simply stays silent - never an error.

const MUSIC_URL = 'ice-hop-music.ogg'; // served from dist/client root (public/)
const MUSIC_VOL = 0.3; // sits under the SFX but present; tune to taste

let musicGain: GainNode | null = null;
let musicSource: AudioBufferSourceNode | null = null;
let musicBuffer: AudioBuffer | null = null; // decoded once, then cached
let musicLoading = false;
let lifecycleArmed = false;

const loadMusicBuffer = async (ac: AudioContext): Promise<AudioBuffer | null> => {
  if (musicBuffer) return musicBuffer;
  try {
    const res = await fetch(MUSIC_URL);
    if (!res.ok) return null;
    musicBuffer = await ac.decodeAudioData(await res.arrayBuffer());
    return musicBuffer;
  } catch {
    return null; // missing or undecodable - just play nothing
  }
};

/** Start the looping track. No-op when music is off or already playing. Must be
 *  called from a user gesture the first time (browser autoplay policy). */
export const startMusic = (): void => {
  if (!musicEnabled || musicSource || musicLoading) return;
  const ac = ensureCtx();
  if (!ac) return;
  musicLoading = true;
  void loadMusicBuffer(ac).then((buf) => {
    musicLoading = false;
    // The toggle may have flipped off (or music already started) while decoding.
    if (!buf || !musicEnabled || musicSource) return;
    const t = ac.currentTime;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(MUSIC_VOL, t + 1.5); // gentle fade-in
    gain.connect(ac.destination);
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(gain);
    src.start();
    musicGain = gain;
    musicSource = src;
  });
};

/** Fade the track out and free it. No-op when nothing is playing. */
export const stopMusic = (): void => {
  const src = musicSource;
  const gain = musicGain;
  musicSource = null;
  musicGain = null;
  if (!src || !gain || !ctx) {
    try {
      src?.stop();
    } catch {
      /* already stopped */
    }
    return;
  }
  const t = ctx.currentTime;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
  window.setTimeout(() => {
    try {
      src.stop();
    } catch {
      /* already stopped */
    }
    try {
      gain.disconnect();
    } catch {
      /* ignore */
    }
  }, 700);
};

/** Wire one-time window listeners: start music on the first user gesture (the
 *  autoplay policy needs one) and suspend/resume the context with tab
 *  visibility. Call once from the client bootstrap. */
export const installAudioLifecycle = (): void => {
  if (lifecycleArmed) return;
  lifecycleArmed = true;
  const onFirstGesture = (): void => {
    startMusic(); // no-op when music is off
    window.removeEventListener('pointerdown', onFirstGesture);
    window.removeEventListener('keydown', onFirstGesture);
  };
  window.addEventListener('pointerdown', onFirstGesture);
  window.addEventListener('keydown', onFirstGesture);
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend();
    else void ctx.resume();
  });
};
