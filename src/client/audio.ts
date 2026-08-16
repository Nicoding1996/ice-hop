// Synthesized sound effects plus one lazily loaded ambient music loop.
// Everything routes through soft gain/filter buses so the mix stays warm and
// "icy" rather than harsh. The AudioContext is created lazily from a deliberate
// gesture, and lifecycle gates keep hidden/offscreen webviews silent.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let enabled = true;
let musicEnabled = false;
let viewportVisible = true;
const STORE_KEY = 'icehop.sound';
const MUSIC_KEY = 'icehop.music';

export const initAudioPrefs = (): void => {
  try {
    enabled = localStorage.getItem(STORE_KEY) !== 'off';
  } catch {
    enabled = true;
  }
  try {
    // Both entrypoints honor one sticky preference. Playback itself still waits
    // for a local deliberate gesture, so reading "on" never autoplays a feed card.
    musicEnabled = localStorage.getItem(MUSIC_KEY) !== 'off';
  } catch {
    musicEnabled = true;
  }
  // A same-origin entrypoint/tab may have changed the preference. Reconcile an
  // external mute immediately, but never auto-start an external enable.
  if (!musicEnabled) stopMusicPlayback(false);
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

/** True when any audio channel (SFX or music) is currently on. Drives the
 *  single play-screen mute toggle, which silences and restores both together. */
export const isAnyAudioOn = (): boolean => enabled || musicEnabled;

/** Master mute for the play screen: flip SFX and music together. (setMusicOn
 *  starts/stops the ambient bed; setSoundOn just gates the effects.) */
export const setAllAudioOn = (on: boolean): void => {
  setSoundOn(on);
  setMusicOn(on);
};

const audioMayPlay = (): boolean => !document.hidden && viewportVisible;

/** Exposed for entrypoint transition recovery; it never grants autoplay by
 *  itself, it only reports whether this document is currently foregrounded. */
export const isAudioViewActive = (): boolean => audioMayPlay();

const ignoreAudioPromise = (promise: Promise<void>): void => {
  void promise.catch(() => undefined);
};

// Lazily create (and resume) the shared AudioContext + the soft master bus.
// Split out from audio() so music can use the context independently of the SFX
// mute (the two have separate toggles). Async cues never wake a lifecycle-
// suspended context while the post is hidden or outside the feed viewport.
const ensureCtx = (): AudioContext | null => {
  if (!audioMayPlay()) return null;
  const AC = window.AudioContext;
  if (!AC) return null;
  try {
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.85;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 6500;
      master.connect(lp).connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ignoreAudioPromise(ctx.resume());
    return ctx;
  } catch {
    // Audio is enhancement-only. Resource limits or browser implementation
    // failures must never interrupt a move, scene transition, or win screen.
    ctx = null;
    master = null;
    noiseBuf = null;
    return null;
  }
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

const runAudioEffect = (effect: () => void): void => {
  try {
    effect();
  } catch {
    // Sound is best-effort; gameplay and UI state always continue without it.
  }
};

/** A light, cute penguin hop ("plip"). */
export const playHop = (): void => {
  runAudioEffect(() => {
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime;
    tone(ac, { freq: 360, slideTo: 560, dur: 0.1, type: 'sine', gain: 0.05, at: t });
    tone(ac, { freq: 720, slideTo: 1120, dur: 0.08, type: 'triangle', gain: 0.016, at: t });
  });
};

/** A soft "shhh" of a seal sliding across ice (filtered noise sweep). */
export const playSlide = (): void => {
  runAudioEffect(() => {
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
  });
};

/** A watery "bloop" with a little droplet tick as a penguin dives in. */
export const playSplash = (): void => {
  runAudioEffect(() => {
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
  });
};

/** A twinkly music-box arpeggio for a win, with a final high shimmer. */
export const playWin = (): void => {
  runAudioEffect(() => {
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    notes.forEach((f, i) => bell(ac, f, t + i * 0.1, 0.06, 0.6));
    bell(ac, 1318.51, t + notes.length * 0.1 + 0.04, 0.04, 0.85); // E6 shimmer
  });
};

// --- Background music: a real, looping ambient track ------------------------
// Synthesis could not sound like real instruments, so the soundtrack is now a
// recorded loop (src/client/public/ice-hop-music.ogg, copied to the client root
// at build time). It is fetched and decoded once into a Web Audio buffer, then
// looped gaplessly through its own quiet gain - independent of the SFX mute, and
// paused with the shared context when its document/card is not visible. Both
// entrypoints honor the preference: expanded starts on its first gesture, while
// inline starts with the first legal move. Missing/undecodable files stay silent.

// Two encodes of the same loop: OGG (smaller, gapless on Chrome/Android) and MP3
// (Safari/iOS, whose WebKit cannot decode Vorbis via decodeAudioData). We always
// try both, so a wrong guess self-heals - but orderedMusicUrls() puts the format
// this browser can actually play first. That stops Safari from downloading the
// OGG, failing to decode it, and only then fetching the MP3 (a wasted ~1.8 MB and
// a console error every session, now that music is on by default).
const MUSIC_OGG = 'ice-hop-music.ogg';
const MUSIC_MP3 = 'ice-hop-music.mp3';
const MUSIC_VOL = 0.3; // sits under the SFX but present; tune to taste

// Prefer the playable format up front. Safari/iOS reports '' (can't play) for
// OGG Vorbis, so it fetches the MP3 directly; Chrome/Android keep the gapless OGG.
const orderedMusicUrls = (): string[] => {
  try {
    const canOgg = document.createElement('audio').canPlayType('audio/ogg; codecs="vorbis"');
    if (canOgg === '') return [MUSIC_MP3, MUSIC_OGG];
  } catch {
    /* canPlayType unavailable - fall back to the default order */
  }
  return [MUSIC_OGG, MUSIC_MP3];
};

let musicGain: GainNode | null = null;
let musicSource: AudioBufferSourceNode | null = null;
let musicBuffer: AudioBuffer | null = null; // decoded once, then cached
let musicBufferPromise: Promise<AudioBuffer | null> | null = null;
let musicLoading = false;
let musicAuthorized = false;
let musicGeneration = 0;
let gestureLifecycleArmed = false;
let visibilityLifecycleArmed = false;

type FadingMusic = {
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
  timer: number;
};

const fadingMusic = new Set<FadingMusic>();

const releaseMusicNodes = (
  source: AudioBufferSourceNode,
  gain: GainNode
): void => {
  runAudioEffect(() => source.stop());
  runAudioEffect(() => gain.disconnect());
};

const stopFadingMusic = (): void => {
  for (const fading of fadingMusic) {
    window.clearTimeout(fading.timer);
    releaseMusicNodes(fading.source, fading.gain);
  }
  fadingMusic.clear();
};

const fetchMusicBuffer = async (ac: AudioContext): Promise<AudioBuffer | null> => {
  for (const url of orderedMusicUrls()) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      return await ac.decodeAudioData(await res.arrayBuffer());
    } catch {
      // Unsupported codec (e.g. OGG on Safari) or a fetch error - try the next.
    }
  }
  return null; // nothing decodable - just stay silent
};

const loadMusicBuffer = (ac: AudioContext): Promise<AudioBuffer | null> => {
  if (musicBuffer) return Promise.resolve(musicBuffer);
  if (!musicBufferPromise) {
    // Muting authorizes no source, but it does not launch a duplicate multi-MB
    // request when the same in-flight decode can satisfy a later local gesture.
    musicBufferPromise = fetchMusicBuffer(ac)
      .then((buffer) => {
        musicBuffer = buffer;
        return buffer;
      })
      .finally(() => {
        musicBufferPromise = null;
      });
  }
  return musicBufferPromise;
};

/** Start the looping track. No-op when music is off or already playing. Must be
 *  called from a user gesture the first time (browser autoplay policy). */
export const startMusic = (): void => {
  if (!musicEnabled) return;
  // Authorization survives a lifecycle suspension/load race, but is cleared by
  // an explicit mute or entrypoint transition.
  musicAuthorized = true;
  if (musicSource || musicLoading) return;
  const ac = ensureCtx();
  if (!ac) return;
  const generation = ++musicGeneration;
  musicLoading = true;
  void loadMusicBuffer(ac)
    .then((buf) => {
      // A mute or view transition can cancel an in-flight source authorization
      // without discarding the shared fetch/decode work.
      if (generation !== musicGeneration) return;
      musicLoading = false;
      if (!buf) {
        musicAuthorized = false;
        return;
      }
      if (!musicEnabled || !musicAuthorized || musicSource || !audioMayPlay()) return;
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
    })
    .catch(() => {
      if (generation === musicGeneration) musicLoading = false;
    });
};

function stopMusicPlayback(immediate: boolean): void {
  // Invalidating the generation also prevents a pending decode from starting a
  // source after the player muted or left this webview.
  musicGeneration += 1;
  musicLoading = false;
  musicAuthorized = false;
  if (immediate) stopFadingMusic();
  const src = musicSource;
  const gain = musicGain;
  musicSource = null;
  musicGain = null;
  if (!src || !gain || !ctx) {
    if (src) runAudioEffect(() => src.stop());
    if (gain) runAudioEffect(() => gain.disconnect());
    return;
  }
  if (immediate) {
    releaseMusicNodes(src, gain);
    return;
  }
  let fadeScheduled = false;
  runAudioEffect(() => {
    const t = ctx?.currentTime;
    if (t === undefined) return;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    fadeScheduled = true;
  });
  if (!fadeScheduled) {
    releaseMusicNodes(src, gain);
    return;
  }
  const fading: FadingMusic = { source: src, gain, timer: 0 };
  fading.timer = window.setTimeout(() => {
    fadingMusic.delete(fading);
    releaseMusicNodes(src, gain);
  }, 700);
  fadingMusic.add(fading);
}

/** Fade the track out and free it. No-op when nothing is playing. */
export const stopMusic = (): void => stopMusicPlayback(false);

/** Stop this document's track before Reddit opens another entrypoint. Unlike a
 *  user mute, this preserves the preference for the expanded document. Returns
 *  whether playback was active so a synchronous launch failure can restore it. */
export const stopMusicForTransition = (): boolean => {
  const wasActive = musicSource !== null || musicLoading;
  stopMusicPlayback(true);
  return wasActive;
};

const syncAudioContextVisibility = (): void => {
  runAudioEffect(() => {
    if (!audioMayPlay()) {
      if (ctx) ignoreAudioPromise(ctx.suspend());
      return;
    }
    if (ctx?.state === 'suspended') ignoreAudioPromise(ctx.resume());
    // A gesture-authorized decode may have completed while this card was hidden.
    // Reuse that authorization and cached buffer when it becomes active again.
    if (musicAuthorized && musicEnabled && !musicSource && !musicLoading) {
      startMusic();
    }
  });
};

/** Suspend all audio whenever Reddit backgrounds or scrolls this webview away.
 *  Inline callers install this without arming music on an arbitrary feed tap. */
export const installAudioVisibilityLifecycle = (): void => {
  if (visibilityLifecycleArmed) return;
  visibilityLifecycleArmed = true;
  document.addEventListener('visibilitychange', syncAudioContextVisibility);
  window.addEventListener('pagehide', () => {
    viewportVisible = false;
    syncAudioContextVisibility();
  });
  window.addEventListener('pageshow', () => {
    viewportVisible = true;
    syncAudioContextVisibility();
  });
  // Page Visibility covers tabs and host mode changes. IntersectionObserver also
  // accounts for the iframe's clipping through ancestor browsing contexts, so a
  // feed card that leaves the viewport cannot keep its ambient loop audible.
  if (typeof IntersectionObserver === 'function') {
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        viewportVisible = entry.isIntersecting && entry.intersectionRatio > 0;
        syncAudioContextVisibility();
      },
      { threshold: 0.01 }
    );
    observer.observe(document.documentElement);
  }
};

/** Expanded-view lifecycle: start enabled music on its first user gesture and
 *  share the same visibility suspension used by the inline post. */
export const installAudioLifecycle = (): void => {
  installAudioVisibilityLifecycle();
  if (gestureLifecycleArmed) return;
  gestureLifecycleArmed = true;
  const onFirstGesture = (): void => {
    startMusic(); // no-op when music is off
    window.removeEventListener('pointerdown', onFirstGesture);
    window.removeEventListener('keydown', onFirstGesture);
  };
  window.addEventListener('pointerdown', onFirstGesture);
  window.addEventListener('keydown', onFirstGesture);
};
