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

/** Fade the camera out, then start another scene (pair with fadeIn on create). */
export const fadeToScene = (scene: Phaser.Scene, key: string, data?: object): void => {
  scene.cameras.main.fadeOut(160, 11, 31, 58);
  // Always pass a fresh object: Phaser keeps the scene's PREVIOUS data when started
  // with undefined, which would otherwise reload a stale community puzzle.
  scene.cameras.main.once('camerafadeoutcomplete', () => scene.scene.start(key, data ?? {}));
};

/** Standard fade-in for a scene's create(), matching the dawn backdrop. */
export const fadeInScene = (scene: Phaser.Scene): void => {
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
