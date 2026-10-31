// Pure play-screen geometry (no Phaser or Devvit imports), shared by GameScene
// and the phone UI smoke test so the test always taps the cells and buttons the
// scene draws. All values are CSS pixels.

export type PlayLayoutInput = {
  readonly width: number;
  readonly height: number;
  readonly cols: number;
  readonly rows: number;
};

export type PlayLayout = {
  /** Centre y of the top chrome row (Menu, mute, help / banner / Skip). */
  readonly chromeY: number;
  /** Centre y of the Moves / Par / star-goal readout. */
  readonly statsY: number;
  /** Centre y of the mode line ("Daily · Fri, Oct 30 · Medium"). */
  readonly contextY: number;
  /** Bottom of the HUD block; the board group never starts above it. */
  readonly hudBottom: number;
  readonly cell: number;
  /** Top-left corner of the grid (the ice sheet's rim sits just outside). */
  readonly originX: number;
  readonly originY: number;
  /** Centre y of the Undo / Restart (/ Hint) bar docked under the board. */
  readonly actionsY: number;
  /** Centre y of the first-move tip (and hint captions) under the bar. */
  readonly tipY: number;
  /** Widest the action bar may be before its buttons scale down. */
  readonly maxBarWidth: number;
};

/** Visual height of the action bar's buttons ("md" pills). */
export const ACTION_BAR_HEIGHT = 42;
export const ACTION_BAR_GAP = 10;

const SIDE_PAD = 16;
const MIN_CELL = 24;
const TIP_HEIGHT = 34;
const GAP_ABOVE_GRID = 12;
const GAP_TO_ACTIONS = 12;
const GAP_TO_TIP = 8;
const BOTTOM_PAD = 12;
/** The ice sheet's rounded rim (16% of a cell) plus its drop shadow. */
const SHEET_RIM = 0.16;
const SHEET_SHADOW = 10;

/**
 * Lay out the play screen: a three-row HUD at the top, then the board with its
 * action bar and tip docked beneath it. The board takes the largest whole-pixel
 * cell that leaves room for the bar and tip, and the group is centred in the
 * space under the HUD so the controls stay next to the pieces they act on.
 */
export const playLayout = (input: PlayLayoutInput): PlayLayout => {
  const { width, height } = input;
  const cols = Math.max(1, input.cols);
  const rows = Math.max(1, input.rows);
  const compact = height < 600;
  const chromeY = 22;
  const statsY = compact ? 56 : 62;
  const contextY = statsY + (compact ? 24 : 27);
  const hudBottom = contextY + (compact ? 14 : 18);

  const below = GAP_TO_ACTIONS + ACTION_BAR_HEIGHT + GAP_TO_TIP + TIP_HEIGHT;
  const availW = width - SIDE_PAD * 2;
  const availH = height - hudBottom - GAP_ABOVE_GRID - below - BOTTOM_PAD - SHEET_SHADOW;
  const cell = Math.max(
    MIN_CELL,
    Math.floor(Math.min(availW / cols, availH / (rows + SHEET_RIM * 2)))
  );

  const gridW = cell * cols;
  const gridH = cell * rows;
  const rimTop = cell * SHEET_RIM;
  const rimBottom = cell * SHEET_RIM + SHEET_SHADOW;
  const groupH = rimTop + gridH + rimBottom + below;
  const regionTop = hudBottom + GAP_ABOVE_GRID;
  const regionH = height - BOTTOM_PAD - regionTop;
  const groupTop = regionTop + Math.max(0, (regionH - groupH) / 2);
  const originY = groupTop + rimTop;
  const originX = (width - gridW) / 2;
  const actionsY = originY + gridH + rimBottom + GAP_TO_ACTIONS + ACTION_BAR_HEIGHT / 2;
  const tipY = actionsY + ACTION_BAR_HEIGHT / 2 + GAP_TO_TIP + TIP_HEIGHT / 2;

  return {
    chromeY,
    statsY,
    contextY,
    hudBottom,
    cell,
    originX,
    originY,
    actionsY,
    tipY,
    maxBarWidth: availW,
  };
};

/** Equal-width slots for the action bar, centred, capped at 112px each. */
export const actionBarSlots = (
  width: number,
  count: number,
  maxBarWidth: number
): { readonly slotWidth: number; readonly centers: readonly number[] } => {
  const slots = Math.max(1, count);
  const slotWidth = Math.min(112, (maxBarWidth - ACTION_BAR_GAP * (slots - 1)) / slots);
  const total = slotWidth * slots + ACTION_BAR_GAP * (slots - 1);
  const left = width / 2 - total / 2;
  return {
    slotWidth,
    centers: Array.from(
      { length: slots },
      (_, index) => left + slotWidth / 2 + index * (slotWidth + ACTION_BAR_GAP)
    ),
  };
};
