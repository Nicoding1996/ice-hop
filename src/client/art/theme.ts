// "Arctic at Dawn" art direction. Single source of truth for the palette and
// the vector draw helpers, so every scene shares one cohesive style.
// Characters are chunky and outlined (a dark silhouette stroke) to read as
// deliberate, polished vector art. See .kiro/steering/art-direction.md.
import * as Phaser from 'phaser';

export const PALETTE = {
  // Backdrop
  bg: 0x0b1f3a,
  skyTop: 0x0b1f3a,
  skyBottom: 0x1c4a6e,
  // Ice (connected sheet)
  ice: 0xbfe3f2,
  iceHi: 0xe8f7ff,
  iceEdge: 0x7fb4d4,
  iceSheet: 0xd4ecf7,
  iceSheen: 0xeaf7fd,
  gridLine: 0xa6cee0,
  // Water holes
  water: 0x0e3a55,
  waterRing: 0x1d6f9c,
  waterShimmer: 0x7fe0ff,
  holeRim: 0x08293c,
  holeDepth: 0x0a2f44,
  // Penguin
  penguin: 0x2b3440,
  penguinOutline: 0x141a22,
  penguinBelly: 0xf4f9fc,
  beak: 0xf6a623,
  beakOutline: 0xc77f15,
  // Seal
  seal: 0x7d8c9b,
  sealOutline: 0x3a4654,
  sealBelly: 0xb9c6d2,
  sealNose: 0x2a333d,
  // Ice rock
  rock: 0xa7c0d0,
  rockBody: 0xa7c0d0,
  rockOutline: 0x5c7488,
  rockTop: 0xd2e6f1,
  rockFacet: 0xd2e6f1,
  rockSnow: 0xffffff,
  // Eyes
  eye: 0x15202b,
  eyeWhite: 0xffffff,
  // Accents (use sparingly)
  accent: 0xff8a5b,
  gold: 0xffd166,
  select: 0xffd166,
  hint: 0xffd166,
  // Text (CSS strings)
  text: '#eaf6fb',
  textDark: '#062033',
  arrow: '#ffd166',
};

/** Calm dawn backdrop: vertical gradient + faint stars + soft snow drifts. */
export const paintBackdrop = (
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  width: number,
  height: number
): void => {
  container.removeAll(true);
  const g = scene.add.graphics();
  g.fillGradientStyle(PALETTE.skyTop, PALETTE.skyTop, PALETTE.skyBottom, PALETTE.skyBottom, 1);
  g.fillRect(0, 0, width, height);
  container.add(g);

  const starSpots = [0.08, 0.19, 0.31, 0.44, 0.57, 0.68, 0.79, 0.9];
  starSpots.forEach((fx, i) => {
    const star = scene.add.circle(width * fx, height * (0.05 + (i % 3) * 0.045), i % 2 ? 1.5 : 1, 0xeaf6fb, 0.5);
    container.add(star);
  });

  const drift1 = scene.add.ellipse(width * 0.28, height * 1.0, width * 1.0, height * 0.2, PALETTE.iceHi, 0.1);
  const drift2 = scene.add.ellipse(width * 0.82, height * 1.04, width * 0.8, height * 0.18, PALETTE.iceHi, 0.08);
  container.add([drift1, drift2]);
};

/**
 * Draw ONE connected frozen sheet under the whole grid, with faint scored grid
 * lines and a rounded snowy border. Reads as a single floe, not loose tiles.
 */
export const paintIceSheet = (
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.Container,
  originX: number,
  originY: number,
  cols: number,
  rows: number,
  cell: number
): void => {
  const pad = cell * 0.16;
  const x = originX - pad;
  const y = originY - pad;
  const w = cols * cell + pad * 2;
  const h = rows * cell + pad * 2;
  const r = cell * 0.34;
  const g = scene.add.graphics();
  // Soft drop shadow.
  g.fillStyle(0x06121f, 0.45);
  g.fillRoundedRect(x + 4, y + 9, w, h, r);
  // Ice base.
  g.fillStyle(PALETTE.iceSheet, 1);
  g.fillRoundedRect(x, y, w, h, r);
  // Faint scored grid so cells are still readable.
  g.lineStyle(Math.max(1, cell * 0.02), PALETTE.gridLine, 0.55);
  for (let c = 1; c < cols; c++) {
    const gx = originX + c * cell;
    g.lineBetween(gx, originY + cell * 0.12, gx, originY + rows * cell - cell * 0.12);
  }
  for (let rI = 1; rI < rows; rI++) {
    const gy = originY + rI * cell;
    g.lineBetween(originX + cell * 0.12, gy, originX + cols * cell - cell * 0.12, gy);
  }
  // Snowy rounded edge.
  g.lineStyle(Math.max(2, cell * 0.05), PALETTE.iceEdge, 1);
  g.strokeRoundedRect(x, y, w, h, r);
  layer.add(g);
};

/** A water hole carved into the ice: a wet ice rim bevels it into the sheet, a
 *  matte deep pool with a recessed top shadow, and a gentle reflection. */
export const makeWaterHole = (
  scene: Phaser.Scene,
  x: number,
  y: number,
  s: number
): Phaser.GameObjects.Container => {
  const c = scene.add.container(x, y);
  // Wet ice rim attaches the hole to the sheet (bevel from ice to water).
  const rim = scene.add.circle(0, 0, s * 0.36, 0x9ccfe2);
  // Matte deep water.
  const water = scene.add.circle(0, 0, s * 0.3, PALETTE.water);
  // Recessed shadow under the near lip (reads as looking down into a hole).
  const shadow = scene.add.ellipse(0, -s * 0.07, s * 0.5, s * 0.34, PALETTE.holeRim, 0.5);
  // Gentle reflection toward the bottom.
  const shimmer = scene.add.ellipse(s * 0.04, s * 0.1, s * 0.14, s * 0.07, PALETTE.waterShimmer, 0.5);
  c.add([rim, water, shadow, shimmer]);
  scene.tweens.add({
    targets: shimmer,
    alpha: 0.18,
    scaleX: 1.3,
    scaleY: 1.3,
    duration: 1800,
    yoyo: true,
    repeat: -1,
    ease: 'Sine.easeInOut',
  });
  return c;
};

/** A chubby, outlined, sitting penguin with big webbed feet. */
export const drawPenguinInto = (
  scene: Phaser.Scene,
  c: Phaser.GameObjects.Container,
  s: number
): void => {
  const OUT = PALETTE.penguinOutline;
  const BODY = PALETTE.penguin;
  const sw = Math.max(1.5, s * 0.04);
  // Webbed feet (splayed, in front).
  c.add(scene.add.ellipse(-s * 0.17, s * 0.39, s * 0.3, s * 0.17, PALETTE.beak).setStrokeStyle(Math.max(1, s * 0.025), PALETTE.beakOutline).setRotation(-0.22));
  c.add(scene.add.ellipse(s * 0.17, s * 0.39, s * 0.3, s * 0.17, PALETTE.beak).setStrokeStyle(Math.max(1, s * 0.025), PALETTE.beakOutline).setRotation(0.22));
  // Flippers (behind body, only outer edge shows).
  c.add(scene.add.ellipse(-s * 0.38, s * 0.04, s * 0.2, s * 0.52, BODY).setStrokeStyle(sw, OUT).setRotation(0.16));
  c.add(scene.add.ellipse(s * 0.38, s * 0.04, s * 0.2, s * 0.52, BODY).setStrokeStyle(sw, OUT).setRotation(-0.16));
  // Chubby body.
  c.add(scene.add.ellipse(0, -s * 0.02, s * 0.84, s * 0.9, BODY).setStrokeStyle(sw, OUT));
  // White belly/face front.
  c.add(scene.add.ellipse(0, s * 0.2, s * 0.54, s * 0.58, PALETTE.penguinBelly));
  // Big eyes.
  const eyeY = -s * 0.17;
  c.add(scene.add.ellipse(-s * 0.15, eyeY, s * 0.22, s * 0.26, PALETTE.eyeWhite));
  c.add(scene.add.ellipse(s * 0.15, eyeY, s * 0.22, s * 0.26, PALETTE.eyeWhite));
  c.add(scene.add.circle(-s * 0.13, eyeY + s * 0.02, s * 0.07, PALETTE.eye));
  c.add(scene.add.circle(s * 0.13, eyeY + s * 0.02, s * 0.07, PALETTE.eye));
  c.add(scene.add.circle(-s * 0.1, eyeY - s * 0.02, s * 0.025, PALETTE.eyeWhite));
  c.add(scene.add.circle(s * 0.16, eyeY - s * 0.02, s * 0.025, PALETTE.eyeWhite));
  // Small beak.
  c.add(scene.add.triangle(0, -s * 0.04, -s * 0.06, -s * 0.03, s * 0.06, -s * 0.03, 0, s * 0.06, PALETTE.beak).setStrokeStyle(Math.max(1, s * 0.02), PALETTE.beakOutline));
};

/** A penguin bobbing in a hole: a compact head and shoulders sitting in the
 *  water with a little ripple ring (no full body, so it reads as "dived in"). */
export const drawPenguinSwimmingInto = (
  scene: Phaser.Scene,
  c: Phaser.GameObjects.Container,
  s: number
): void => {
  const OUT = PALETTE.penguinOutline;
  const BODY = PALETTE.penguin;
  const sw = Math.max(1.5, s * 0.04);
  // Ripple ring at the waterline (behind the head, around the hole).
  c.add(scene.add.ellipse(0, s * 0.2, s * 0.56, s * 0.18, 0x000000, 0).setStrokeStyle(Math.max(1, s * 0.03), PALETTE.waterShimmer, 0.55));
  // Head + shoulders sitting in the hole.
  c.add(scene.add.ellipse(0, -s * 0.02, s * 0.56, s * 0.56, BODY).setStrokeStyle(sw, OUT));
  c.add(scene.add.ellipse(0, s * 0.06, s * 0.36, s * 0.34, PALETTE.penguinBelly));
  const eyeY = -s * 0.1;
  c.add(scene.add.ellipse(-s * 0.12, eyeY, s * 0.19, s * 0.23, PALETTE.eyeWhite));
  c.add(scene.add.ellipse(s * 0.12, eyeY, s * 0.19, s * 0.23, PALETTE.eyeWhite));
  c.add(scene.add.circle(-s * 0.1, eyeY + s * 0.01, s * 0.06, PALETTE.eye));
  c.add(scene.add.circle(s * 0.1, eyeY + s * 0.01, s * 0.06, PALETTE.eye));
  c.add(scene.add.circle(-s * 0.07, eyeY - s * 0.02, s * 0.02, PALETTE.eyeWhite));
  c.add(scene.add.circle(s * 0.13, eyeY - s * 0.02, s * 0.02, PALETTE.eyeWhite));
  c.add(scene.add.triangle(0, s * 0.02, -s * 0.055, -s * 0.02, s * 0.055, -s * 0.02, 0, s * 0.06, PALETTE.beak));
};

/** A recognizable seal lying on the ice: body, raised head, flipper, tail. */
export const drawSealInto = (
  scene: Phaser.Scene,
  c: Phaser.GameObjects.Container,
  s: number,
  orient: 'H' | 'V'
): void => {
  const OUT = PALETTE.sealOutline;
  const BODY = PALETTE.seal;
  const sw = Math.max(1.5, s * 0.04);
  // Tail fluke: two rounded paddles fanning out (drawn before the body so the
  // body overlaps the inner edge and it reads as attached).
  c.add(scene.add.ellipse(-s * 0.64, -s * 0.13, s * 0.34, s * 0.2, BODY).setStrokeStyle(Math.max(1, s * 0.03), OUT).setRotation(0.55));
  c.add(scene.add.ellipse(-s * 0.64, s * 0.13, s * 0.34, s * 0.2, BODY).setStrokeStyle(Math.max(1, s * 0.03), OUT).setRotation(-0.55));
  // Body.
  c.add(scene.add.ellipse(0, 0, s * 1.4, s * 0.62, BODY).setStrokeStyle(sw, OUT));
  // Lighter belly.
  c.add(scene.add.ellipse(0, s * 0.12, s * 1.0, s * 0.32, PALETTE.sealBelly));
  // Front flipper.
  c.add(scene.add.ellipse(s * 0.14, s * 0.24, s * 0.34, s * 0.16, BODY).setStrokeStyle(Math.max(1, s * 0.03), OUT).setRotation(0.3));
  // Raised head.
  c.add(scene.add.ellipse(s * 0.62, -s * 0.16, s * 0.62, s * 0.56, BODY).setStrokeStyle(sw, OUT));
  // Muzzle + nose.
  c.add(scene.add.ellipse(s * 0.8, -s * 0.06, s * 0.26, s * 0.2, PALETTE.sealBelly));
  c.add(scene.add.circle(s * 0.9, -s * 0.08, s * 0.05, PALETTE.sealNose));
  // Eyes.
  c.add(scene.add.circle(s * 0.56, -s * 0.26, s * 0.055, PALETTE.eye));
  c.add(scene.add.circle(s * 0.74, -s * 0.26, s * 0.055, PALETTE.eye));
  c.add(scene.add.circle(s * 0.58, -s * 0.28, s * 0.02, PALETTE.eyeWhite));
  c.add(scene.add.circle(s * 0.76, -s * 0.28, s * 0.02, PALETTE.eyeWhite));
  // Whiskers.
  c.add(scene.add.rectangle(s * 0.95, -s * 0.06, s * 0.22, Math.max(1, s * 0.012), OUT).setOrigin(0, 0.5).setRotation(-0.12));
  c.add(scene.add.rectangle(s * 0.95, -s * 0.03, s * 0.22, Math.max(1, s * 0.012), OUT).setOrigin(0, 0.5));
  // Vertical seals are the horizontal drawing rotated a quarter turn.
  if (orient === 'V') c.setRotation(Math.PI / 2);
};

/** A solid, outlined ice block with a top facet and snow cap. */
export const drawRockInto = (
  scene: Phaser.Scene,
  c: Phaser.GameObjects.Container,
  s: number
): void => {
  c.add(scene.add.ellipse(0, s * 0.33, s * 0.62, s * 0.16, 0x0a2233, 0.3));
  const g = scene.add.graphics();
  g.fillStyle(PALETTE.rockBody, 1);
  g.fillRoundedRect(-s * 0.33, -s * 0.2, s * 0.66, s * 0.52, s * 0.12);
  g.lineStyle(Math.max(2, s * 0.04), PALETTE.rockOutline, 1);
  g.strokeRoundedRect(-s * 0.33, -s * 0.2, s * 0.66, s * 0.52, s * 0.12);
  c.add(g);
  c.add(scene.add.ellipse(0, -s * 0.16, s * 0.58, s * 0.22, PALETTE.rockFacet).setStrokeStyle(Math.max(1, s * 0.025), PALETTE.rockOutline));
  c.add(scene.add.ellipse(0, -s * 0.2, s * 0.4, s * 0.13, PALETTE.rockSnow));
};

/** A short water splash burst (a few tweened droplets that self-destroy). */
export const splashBurst = (
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.Container,
  x: number,
  y: number,
  s: number
): void => {
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI * 2 * i) / 6 - Math.PI / 2;
    const drop = scene.add.circle(x, y, s * 0.06, PALETTE.waterShimmer, 0.95);
    layer.add(drop);
    scene.tweens.add({
      targets: drop,
      x: x + Math.cos(a) * s * 0.5,
      y: y + Math.sin(a) * s * 0.45 - s * 0.12,
      alpha: 0,
      scale: 0.3,
      duration: 380,
      ease: 'Quad.easeOut',
      onComplete: () => drop.destroy(),
    });
  }
};

/** Fade the camera out, then start another scene (pair with fadeIn on create).
 *
 *  Hardened so a transition can NEVER strand the player on a dimmed screen:
 *  - a guard so we start the next scene exactly once;
 *  - the fade's own progress callback (fires when progress hits 1) AND the
 *    `camerafadeoutcomplete` event, so a missed event still advances;
 *  - a time-based fail-safe in case neither fires.
 *  This matters most for endless, which restarts the SAME GameScene over and
 *  over via "Next puzzle"; if the fade-out completion were ever missed the old
 *  scene would sit faded-to-black and look frozen. */
export const fadeToScene = (scene: Phaser.Scene, key: string, data?: object): void => {
  const cam = scene.cameras.main;
  let advanced = false;
  const go = (): void => {
    if (advanced) return;
    advanced = true;
    // Always pass a fresh object: Phaser keeps the scene's PREVIOUS data when
    // started with undefined, which would otherwise reload a stale puzzle.
    scene.scene.start(key, data ?? {});
  };
  cam.once('camerafadeoutcomplete', go);
  cam.fadeOut(160, 11, 31, 58, (_camera: Phaser.Cameras.Scene2D.Camera, progress: number) => {
    if (progress >= 1) go();
  });
  // Fail-safe: advance even if the completion signals are missed, so the screen
  // never gets stuck dimmed. (Cleared automatically once the scene shuts down.)
  scene.time.delayedCall(400, go);
};

/** Standard fade-in for a scene's create(), matching the dawn backdrop.
 *
 *  resetFX() first: restarting a scene does NOT reset its camera fade effect
 *  (a long-standing Phaser behaviour), so a prior fade-out can linger and leave
 *  the restarted scene stuck dark/dimmed. Clearing it before fading in
 *  guarantees the scene actually becomes visible. */
export const fadeInScene = (scene: Phaser.Scene): void => {
  scene.cameras.main.resetFX();
  scene.cameras.main.fadeIn(200, 11, 31, 58);
};

/** A celebratory burst of little stars that fan out and fade (for wins). */
export const sparkleBurst = (
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.Container,
  x: number,
  y: number,
  s: number
): void => {
  const colors = [PALETTE.gold, 0xffffff, PALETTE.waterShimmer];
  for (let i = 0; i < 14; i++) {
    const ang = Math.random() * Math.PI * 2;
    const dist = s * (0.6 + Math.random() * 0.9);
    const color = colors[i % colors.length];
    const sp = scene.add.star(x, y, 4, s * 0.05, s * 0.12, color, 0.95).setAngle(Math.random() * 90);
    layer.add(sp);
    scene.tweens.add({
      targets: sp,
      x: x + Math.cos(ang) * dist,
      y: y + Math.sin(ang) * dist,
      alpha: 0,
      scale: 0.2,
      angle: sp.angle + 140,
      duration: 600 + Math.random() * 350,
      ease: 'Quad.easeOut',
      onComplete: () => sp.destroy(),
    });
  }
};

/** Subtle northern-lights curtains near the top, for a standout (3-star) win.
 *  Thin vertical glows with ADD blending so colours stay luminous over the dark
 *  win overlay (a low-alpha fill would just muddy into a grey oval). */
export const auroraFlourish = (
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.Container,
  width: number,
  y: number
): void => {
  const cols = [0x5ef0c0, 0x6fd0ff, 0x9a7bff];
  for (let i = 0; i < 7; i++) {
    const x = width * (0.12 + i * 0.12);
    const curtain = scene.add.ellipse(x, y, width * 0.08, 150, cols[i % cols.length], 0);
    curtain.setBlendMode(Phaser.BlendModes.ADD);
    layer.add(curtain);
    scene.tweens.add({
      targets: curtain,
      alpha: 0.22,
      scaleY: 1.3 + Math.random() * 0.5,
      y: y + (Math.random() * 28 - 14),
      duration: 1200 + Math.random() * 900,
      delay: i * 120,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }
};

// ---------------------------------------------------------------------------
// Design system: typography, spacing, and reusable UI components.
//
// The art is rounded and shadowed; the UI chrome should match. These helpers
// give every scene one button shape, one spacing rhythm, and one card surface
// so nothing reads as a default Phaser text-box. Font families carry rounded
// system fallbacks, so if the web fonts are blocked the UI still looks
// deliberate rather than dropping to plain Arial.
// ---------------------------------------------------------------------------

/** Font families (with fallbacks). Fredoka = display/wordmark, Nunito = UI/body. */
export const FONT = {
  display: "Fredoka, 'Trebuchet MS', Verdana, sans-serif",
  ui: "Nunito, 'Segoe UI', system-ui, -apple-system, sans-serif",
} as const;

/** Spacing scale (px). Use these for gaps/padding instead of ad-hoc numbers. */
export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** Corner radii (px) for the shared rounded shapes. */
export const RADIUS = { chip: 999, button: 16, card: 22 } as const;

export type PillVariant = 'primary' | 'secondary' | 'mint' | 'gold' | 'chip' | 'ghost' | 'muted';
export type PillSize = 'sm' | 'md' | 'lg';

type VariantStyle = {
  fill: number;
  fillAlpha?: number;
  text: string;
  border?: number;
  borderAlpha?: number;
};

const VARIANTS: Record<PillVariant, VariantStyle> = {
  primary: { fill: 0xff8a5b, text: '#062033' },
  secondary: { fill: 0xcfe6f2, text: '#062033' },
  mint: { fill: 0xaef0d2, text: '#062033' },
  gold: { fill: 0xffd166, text: '#062033' },
  chip: { fill: 0x1f3f59, text: '#eaf6fb', border: 0x35608a, borderAlpha: 0.9 },
  ghost: { fill: 0x0e2740, fillAlpha: 0, text: '#eaf6fb', border: 0x3a6386, borderAlpha: 0.95 },
  muted: { fill: 0x3a5066, text: '#cfe0ec' },
};

const SIZES: Record<PillSize, { fontSize: number; padX: number; height: number; weight: string }> = {
  sm: { fontSize: 13, padX: 14, height: 34, weight: '700' },
  md: { fontSize: 15, padX: 19, height: 42, weight: '700' },
  lg: { fontSize: 18, padX: 26, height: 52, weight: '700' },
};

export type PillOptions = {
  label: string;
  variant?: PillVariant;
  size?: PillSize;
  x?: number;
  y?: number;
  minWidth?: number;
  /** Set false for a non-interactive badge (no input, no hover/press). */
  interactive?: boolean;
  onClick?: () => void;
};

/**
 * A rounded, shadowed button/chip that matches the vector art. Behaves like a
 * Container for layout (setPosition / x / y / width / height / setVisible) and
 * adds setLabelText / setVariant / setEnabled for the dynamic buttons (share,
 * vote, subscribe, the editor's Submit/Test). Use the `interactive: false`
 * option for a static badge (e.g. the endless "Solved" counter).
 */
export class PillButton extends Phaser.GameObjects.Container {
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly labelText: Phaser.GameObjects.Text;
  /** Background + label, scaled for hover/press juice (the hit zone is separate
   *  so the clickable area never moves and a tap always lands). */
  private readonly visual: Phaser.GameObjects.Container;
  /** Invisible input target. A Zone centres its hit area on its origin and
   *  resizes it with setSize, so the clickable region always matches the pill. */
  private readonly hit: Phaser.GameObjects.Zone;
  private intendedVariant: PillVariant;
  private readonly sizeKey: PillSize;
  private readonly minWidth: number;
  private readonly clickable: boolean;
  private enabled = true;
  private readonly onClick?: () => void;

  constructor(scene: Phaser.Scene, opts: PillOptions) {
    super(scene, opts.x ?? 0, opts.y ?? 0);
    this.intendedVariant = opts.variant ?? 'secondary';
    this.sizeKey = opts.size ?? 'md';
    this.minWidth = opts.minWidth ?? 0;
    this.clickable = opts.interactive ?? true;
    this.onClick = opts.onClick;

    const sz = SIZES[this.sizeKey];
    this.visual = scene.add.container(0, 0);
    this.bg = scene.add.graphics();
    this.labelText = scene.add
      .text(0, 0, opts.label, {
        fontFamily: FONT.ui,
        fontSize: `${sz.fontSize}px`,
        fontStyle: sz.weight,
        color: VARIANTS[this.intendedVariant].text,
      })
      .setOrigin(0.5);
    this.visual.add([this.bg, this.labelText]);

    this.hit = scene.add.zone(0, 0, sz.height, sz.height);
    this.add([this.visual, this.hit]);
    this.redraw();

    if (this.clickable) {
      // Input lives on the Zone (sized in redraw), never on the scaled visual,
      // so hover/press can't shift the hit area out from under the pointer.
      this.hit.setInteractive({ useHandCursor: true });
      this.hit.on('pointerover', () => {
        if (this.enabled) this.visual.setScale(1.03);
      });
      this.hit.on('pointerout', () => this.visual.setScale(1));
      this.hit.on('pointerdown', () => {
        if (!this.enabled) return;
        this.scene.tweens.add({
          targets: this.visual,
          scaleX: 0.95,
          scaleY: 0.95,
          duration: 80,
          yoyo: true,
          ease: 'Quad.easeOut',
        });
        this.onClick?.();
      });
    }

    scene.add.existing(this);
  }

  private effectiveVariant(): PillVariant {
    return this.enabled ? this.intendedVariant : 'muted';
  }

  private redraw(): void {
    const sz = SIZES[this.sizeKey];
    const style = VARIANTS[this.effectiveVariant()];
    this.labelText.setColor(style.text);
    const w = Math.max(this.minWidth, Math.ceil(this.labelText.width) + sz.padX * 2);
    const h = sz.height;
    const r = Math.min(RADIUS.button, h / 2);
    const fillAlpha = style.fillAlpha ?? 1;
    const g = this.bg;
    g.clear();
    if (fillAlpha > 0) {
      // Soft drop shadow for depth (skipped for the transparent ghost variant).
      g.fillStyle(0x06121f, 0.26);
      g.fillRoundedRect(-w / 2, -h / 2 + 3, w, h, r);
      g.fillStyle(style.fill, fillAlpha);
      g.fillRoundedRect(-w / 2, -h / 2, w, h, r);
    }
    if (style.border !== undefined) {
      g.lineStyle(1.5, style.border, style.borderAlpha ?? 1);
      g.strokeRoundedRect(-w / 2, -h / 2, w, h, r);
    }
    this.setSize(w, h);
    // Hit zone is at least 44px each way (comfortable touch target). setSize on a
    // Zone updates its input hit area too (resizeInput defaults to true).
    this.hit.setSize(Math.max(w, 44), Math.max(h, 44));
  }

  setLabelText(text: string): this {
    this.labelText.setText(text);
    this.redraw();
    return this;
  }

  setVariant(variant: PillVariant): this {
    this.intendedVariant = variant;
    this.redraw();
    return this;
  }

  /** Enable/disable: a disabled button shows the muted style and ignores taps. */
  setEnabled(enabled: boolean): this {
    this.enabled = enabled;
    this.redraw();
    if (this.hit.input) this.hit.input.enabled = enabled && this.clickable;
    if (!enabled) this.visual.setScale(1);
    return this;
  }
}

/** Factory for a PillButton (mirrors scene.add.* style). */
export const makePill = (scene: Phaser.Scene, opts: PillOptions): PillButton =>
  new PillButton(scene, opts);

/** A non-interactive rounded badge (e.g. the endless "Solved" counter). */
export const makeBadge = (
  scene: Phaser.Scene,
  label: string,
  variant: PillVariant = 'gold',
  size: PillSize = 'sm'
): PillButton => new PillButton(scene, { label, variant, size, interactive: false });

export type PanelOptions = {
  radius?: number;
  fill?: number;
  fillAlpha?: number;
  border?: number;
};

/**
 * A solid rounded card surface with a soft shadow, drawn centred on (0,0).
 * Position it with setPosition(cx, cy). Used behind win/recap content so text
 * sits on its own surface instead of on top of the busy board.
 */
export const makePanel = (
  scene: Phaser.Scene,
  width: number,
  height: number,
  opts: PanelOptions = {}
): Phaser.GameObjects.Graphics => {
  const r = opts.radius ?? RADIUS.card;
  const fill = opts.fill ?? 0x123047;
  const fillAlpha = opts.fillAlpha ?? 1;
  const border = opts.border ?? 0x2f5c7a;
  const g = scene.add.graphics();
  g.fillStyle(0x05101c, 0.45);
  g.fillRoundedRect(-width / 2 + 2, -height / 2 + 9, width, height, r);
  g.fillStyle(fill, fillAlpha);
  g.fillRoundedRect(-width / 2, -height / 2, width, height, r);
  g.lineStyle(2, border, 1);
  g.strokeRoundedRect(-width / 2, -height / 2, width, height, r);
  return g;
};

/** Anything the column layout can place: has a height and can be positioned. */
export type Stackable = Phaser.GameObjects.GameObject & {
  height: number;
  setPosition(x: number, y: number): unknown;
};

/** Total height of a vertical stack of items separated by `gap`. */
export const measureColumn = (items: Stackable[], gap: number): number =>
  items.reduce((sum, it) => sum + it.height, 0) + gap * Math.max(0, items.length - 1);

/**
 * Lay items out in a centred vertical column with an even gap, starting at
 * `top`. Each item is centred on `x`. Returns the y of the bottom edge.
 */
export const stackColumn = (items: Stackable[], x: number, top: number, gap: number): number => {
  let cy = top;
  for (const it of items) {
    it.setPosition(x, cy + it.height / 2);
    cy += it.height + gap;
  }
  return cy - gap;
};

// --- Icon button: a compact square chip with a code-drawn vector icon --------
// Same chip styling + hover/press juice as PillButton, but it renders a drawn
// icon (via a callback) instead of a text label - for tight spots like the
// play-HUD mute toggle, where a text pill crowds the corner on mobile. Kept
// separate so the widely-used text PillButton stays untouched.
export type IconDraw = (g: Phaser.GameObjects.Graphics, size: number) => void;

export type IconButtonOptions = {
  draw: IconDraw;
  variant?: PillVariant;
  size?: PillSize;
  x?: number;
  y?: number;
  onClick?: () => void;
};

export class IconButton extends Phaser.GameObjects.Container {
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly iconGfx: Phaser.GameObjects.Graphics;
  private readonly visual: Phaser.GameObjects.Container;
  private readonly hit: Phaser.GameObjects.Zone;
  private readonly variant: PillVariant;
  private readonly sizeKey: PillSize;
  private draw: IconDraw;
  private readonly onClick?: () => void;

  constructor(scene: Phaser.Scene, opts: IconButtonOptions) {
    super(scene, opts.x ?? 0, opts.y ?? 0);
    this.variant = opts.variant ?? 'chip';
    this.sizeKey = opts.size ?? 'sm';
    this.draw = opts.draw;
    this.onClick = opts.onClick;

    this.visual = scene.add.container(0, 0);
    this.bg = scene.add.graphics();
    this.iconGfx = scene.add.graphics();
    this.visual.add([this.bg, this.iconGfx]);

    const side = SIZES[this.sizeKey].height;
    this.hit = scene.add.zone(0, 0, Math.max(side, 44), Math.max(side, 44));
    this.add([this.visual, this.hit]);
    this.redraw();

    // Input on the Zone, never the scaled visual, so the hit area never shifts.
    this.hit.setInteractive({ useHandCursor: true });
    this.hit.on('pointerover', () => this.visual.setScale(1.06));
    this.hit.on('pointerout', () => this.visual.setScale(1));
    this.hit.on('pointerdown', () => {
      this.scene.tweens.add({
        targets: this.visual,
        scaleX: 0.9,
        scaleY: 0.9,
        duration: 80,
        yoyo: true,
        ease: 'Quad.easeOut',
      });
      this.onClick?.();
    });

    scene.add.existing(this);
  }

  private redraw(): void {
    const side = SIZES[this.sizeKey].height;
    const style = VARIANTS[this.variant];
    const r = Math.min(RADIUS.button, side / 2);
    const g = this.bg;
    g.clear();
    const fillAlpha = style.fillAlpha ?? 1;
    if (fillAlpha > 0) {
      g.fillStyle(0x06121f, 0.26);
      g.fillRoundedRect(-side / 2, -side / 2 + 3, side, side, r);
      g.fillStyle(style.fill, fillAlpha);
      g.fillRoundedRect(-side / 2, -side / 2, side, side, r);
    }
    if (style.border !== undefined) {
      g.lineStyle(1.5, style.border, style.borderAlpha ?? 1);
      g.strokeRoundedRect(-side / 2, -side / 2, side, side, r);
    }
    this.setSize(side, side);
    this.iconGfx.clear();
    this.draw(this.iconGfx, side * 0.62);
    this.hit.setSize(Math.max(side, 44), Math.max(side, 44));
  }

  /** Re-run the draw callback (e.g. after a toggle changes what it renders). */
  refresh(): this {
    this.redraw();
    return this;
  }
}

export const makeIconButton = (scene: Phaser.Scene, opts: IconButtonOptions): IconButton =>
  new IconButton(scene, opts);

/** Speaker icon for a mute toggle: sound waves when on, a small X when muted.
 *  Drawn in the cool chip-text colour so it matches the rest of the vector art.
 *  `size` is the icon's bounding extent; coordinates are centred on (0,0). */
export const drawSpeakerIcon = (g: Phaser.GameObjects.Graphics, size: number, on: boolean): void => {
  const s = size / 2; // half-extent
  const color = 0xeaf6fb; // PALETTE.text as a number
  g.fillStyle(color, 1);
  // Magnet block + cone, speaker pointing right. The cone is two triangles so we
  // pass plain numbers (this Phaser build's fillPoints wants Vector2 instances).
  g.fillRoundedRect(-0.95 * s, -0.28 * s, 0.42 * s, 0.56 * s, 0.06 * s);
  g.fillTriangle(-0.6 * s, -0.28 * s, -0.05 * s, -0.85 * s, -0.05 * s, 0.85 * s);
  g.fillTriangle(-0.6 * s, -0.28 * s, -0.05 * s, 0.85 * s, -0.6 * s, 0.28 * s);
  const lw = Math.max(2, 0.12 * s);
  g.lineStyle(lw, color, 1);
  if (on) {
    // Two sound waves curving off to the right.
    g.beginPath();
    g.arc(0.02 * s, 0, 0.42 * s, -Math.PI / 3, Math.PI / 3);
    g.strokePath();
    g.beginPath();
    g.arc(0.02 * s, 0, 0.72 * s, -Math.PI / 3, Math.PI / 3);
    g.strokePath();
  } else {
    // Muted: a small X where the waves would be.
    g.beginPath();
    g.moveTo(0.3 * s, -0.32 * s);
    g.lineTo(0.85 * s, 0.32 * s);
    g.strokePath();
    g.beginPath();
    g.moveTo(0.3 * s, 0.32 * s);
    g.lineTo(0.85 * s, -0.32 * s);
    g.strokePath();
  }
};
