import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import type { Board, Piece } from '../../shared/game/types';
import { validateBoardStructure } from '../../shared/game/validation';
import type { CreatorSolveProof } from '../../shared/game/proof';
import { verifyCreatorSolveProof } from '../../shared/game/proof';
import type { SubmitPuzzleResponse } from '../../shared/api';
import { validateSubmission } from '../../shared/solver/validate';
import { generate } from '../../shared/solver/generator';
import { difficultyFromPar, difficultyLabel } from '../../shared/solver/difficulty';
import {
  PALETTE,
  FONT,
  SPACE,
  paintBackdrop,
  paintIceSheet,
  makeWaterHole,
  drawPenguinInto,
  drawSealInto,
  drawRockInto,
  fadeInScene,
  fadeToScene,
  makePill,
  PillButton,
  type PillVariant,
  type PillSize,
  useCrispRendering,
  viewHeight,
  viewWidth,
  armTap,
} from '../art/theme';
import { context, showLoginPrompt } from '@devvit/web/client';
import { trackClientEvent } from '../telemetry';

/** Where a not-yet-submitted board is parked so it survives the page reload
 *  that showLoginPrompt() triggers (the Phaser registry does not survive a
 *  reload; localStorage does). Restored next time the editor opens. */
const PENDING_DRAFT_KEY = 'icehop:editorPending';

type EditorDraft = {
  pieces: Piece[];
  holes: number[];
  proof?: CreatorSolveProof;
};

const savePendingDraft = (draft: EditorDraft): void => {
  try {
    localStorage.setItem(PENDING_DRAFT_KEY, JSON.stringify(draft));
  } catch (error) {
    console.error(error);
  }
};

const draftProperty = (value: object, key: string): unknown => Reflect.get(value, key);
const isDraftObject = (value: unknown): value is object =>
  typeof value === 'object' && value !== null;

const loadPendingDraft = (): EditorDraft | undefined => {
  try {
    const raw = localStorage.getItem(PENDING_DRAFT_KEY);
    if (!raw) return undefined;
    const value: unknown = JSON.parse(raw);
    if (!isDraftObject(value)) throw new Error('Editor draft is malformed.');
    const structure = validateBoardStructure({
      width: 5,
      height: 5,
      holes: draftProperty(value, 'holes'),
      pieces: draftProperty(value, 'pieces'),
    });
    if (!structure.ok) throw new Error(structure.reason);

    const proofResult = verifyCreatorSolveProof(
      structure.board,
      draftProperty(value, 'proof')
    );
    return {
      pieces: structure.board.pieces.map((piece) => ({
        ...piece,
        cells: [...piece.cells],
      })),
      holes: [...structure.board.holes],
      ...(proofResult.ok ? { proof: proofResult.proof } : {}),
    };
  } catch (error) {
    console.error(error);
    try {
      localStorage.removeItem(PENDING_DRAFT_KEY);
    } catch {
      // localStorage is unavailable; there is nothing else to recover.
    }
    return undefined;
  }
};

const clearPendingDraft = (): void => {
  try {
    localStorage.removeItem(PENDING_DRAFT_KEY);
  } catch (error) {
    console.error(error);
  }
};

// CSS-string colours for status text; numbers for the tool-chip shape fills.
const UI = {
  text: '#eaf6fb',
  good: '#8fe0c0',
  warn: '#ffd27e',
  toolLabelIdle: '#dbeaf3',
  toolLabelActive: '#062033',
  chipIdle: 0x1f3f59,
  chipActive: 0xffd166,
  stepDone: 0x8fe0c0,
  stepIdle: 0x35608a,
};

type Tool = 'PENGUIN' | 'SEAL' | 'ROCK' | 'HOLE' | 'ERASE';

const TOOLS: ReadonlyArray<{ tool: Tool; label: string }> = [
  { tool: 'PENGUIN', label: 'Penguin' },
  { tool: 'SEAL', label: 'Seal' },
  { tool: 'ROCK', label: 'Rock' },
  { tool: 'HOLE', label: 'Water' },
  { tool: 'ERASE', label: 'Erase' },
];

type ToolChip = {
  tool: Tool;
  cont: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
  icon: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
  /** The tap target. A Zone resizes its hit area with setSize; a container's
   *  first setInteractive hit area would never follow a resize. */
  zone: Phaser.GameObjects.Zone;
  w: number;
  h: number;
  iconSize: number;
  active: boolean;
};

/** Where the creator is in Build -> Test -> Submit ('done' once submitted). */
type Step = 'build' | 'test' | 'submit' | 'done';

const STEPS: ReadonlyArray<{ readonly step: Step; readonly label: string }> = [
  { step: 'build', label: 'Build' },
  { step: 'test', label: 'Test' },
  { step: 'submit', label: 'Submit' },
];

/** Tool and action rows never stretch wider than this on big screens. */
const PANEL_MAX_W = 440;
/** Room for the status under the board: up to two lines plus a detail line. */
const STATUS_H = 50;
const STEPPER_H = 24;

const countLabel = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

const bandLabel = (par: number): string => difficultyLabel(difficultyFromPar(par));

/**
 * The puzzle editor. Build on the ice with the tool palette, Test-play the
 * board, and Submit once you have solved that exact board yourself. A
 * Build -> Test -> Submit stepper and the status under the board say what the
 * next step is, so the Submit lock never reads as a broken button.
 */
export class EditorScene extends Scene {
  private readonly width = 5;
  private readonly height = 5;
  private holes = new Set<number>();
  private pieces: Piece[] = [];
  private currentTool: Tool = 'PENGUIN';
  private sealOrient: 'H' | 'V' = 'H';
  private history: string[] = [];
  private canTest = false;
  private canSubmit = false;
  private proof?: CreatorSolveProof;
  private submitting = false;
  private touched = false;
  /** Par of the board the server just accepted; cleared by the next edit. */
  private submittedPar: number | null = null;

  private bgLayer!: Phaser.GameObjects.Container;
  private boardLayer!: Phaser.GameObjects.Container;
  private pieceLayer!: Phaser.GameObjects.Container;
  private titleText!: Phaser.GameObjects.Text;
  private stepper!: Phaser.GameObjects.Container;
  private stepperWidth = 0;
  private statusText!: Phaser.GameObjects.Text;
  private detailText!: Phaser.GameObjects.Text;
  private backButton!: PillButton;
  private toolChips: ToolChip[] = [];
  private undoButton!: PillButton;
  private randomButton!: PillButton;
  private clearButton!: PillButton;
  private testButton!: PillButton;
  private submitButton!: PillButton;

  private cell = 0;
  private originX = 0;
  private originY = 0;

  constructor() {
    super('EditorScene');
  }

  create(): void {
    useCrispRendering(this);
    this.holes = new Set<number>();
    this.pieces = [];
    this.history = [];
    this.sealOrient = 'H';
    this.canTest = false;
    this.canSubmit = false;
    this.proof = undefined;
    this.submitting = false;
    this.touched = false;
    this.submittedPar = null;

    // Restore an in-progress board: from the registry when returning from
    // "Test", or from localStorage when we've come back from a sign-in reload
    // (the registry doesn't survive a page reload; localStorage does).
    const pendingDraft = loadPendingDraft();
    const draft: EditorDraft | undefined = this.registry.get('editor.draft') ?? pendingDraft;
    const registryProof: CreatorSolveProof | undefined = this.registry.get('editor.proof');
    if (draft) {
      this.pieces = draft.pieces.map((piece) => ({ ...piece, cells: [...piece.cells] }));
      this.holes = new Set(draft.holes);
      this.proof = registryProof ?? draft.proof;
      this.touched = true;
    }
    this.registry.remove('editor.draft');
    this.registry.remove('editor.proof');
    if (pendingDraft) clearPendingDraft();

    this.cameras.main.setBackgroundColor(PALETTE.bg);
    fadeInScene(this);
    this.bgLayer = this.add.container(0, 0);
    paintBackdrop(this, this.bgLayer, viewWidth(this), viewHeight(this));
    this.boardLayer = this.add.container(0, 0);
    this.pieceLayer = this.add.container(0, 0);

    this.titleText = this.add
      .text(0, 0, 'Build a puzzle', { fontFamily: FONT.display, fontSize: '22px', fontStyle: '700', color: UI.text })
      .setOrigin(0.5);
    this.stepper = this.add.container(0, 0);
    this.statusText = this.add
      .text(0, 0, '', { fontFamily: FONT.ui, fontSize: '14px', fontStyle: '700', color: UI.text, align: 'center' })
      .setOrigin(0.5, 0);
    this.detailText = this.add
      .text(0, 0, '', { fontFamily: FONT.ui, fontSize: '12px', fontStyle: '600', color: UI.text, align: 'center' })
      .setOrigin(0.5, 0)
      .setAlpha(0.75);
    this.backButton = this.makeButton('\u2039 Menu', 'chip', () => fadeToScene(this, 'HomeScene'));

    this.toolChips = TOOLS.map(({ tool, label }) => this.makeToolChip(tool, label));

    // Edits are quiet chips; Test and Submit are the steps forward.
    this.undoButton = this.makeButton('\u21B6 Undo', 'chip', () => this.undo());
    this.randomButton = this.makeButton('Random', 'chip', () => this.randomFill());
    this.clearButton = this.makeButton('Clear', 'chip', () => this.clearAll());
    this.testButton = this.makeButton('\u25B6 Test', 'secondary', () => this.testPuzzle(), 'md');
    this.submitButton = this.makeButton('Submit', 'primary', () => this.onSubmitTap(), 'md');

    const onResize = (): void => {
      paintBackdrop(this, this.bgLayer, viewWidth(this), viewHeight(this));
      this.layoutAll();
      this.render();
    };
    this.scale.on('resize', onResize);
    // The ScaleManager is global; drop our listener on shutdown so it doesn't
    // accumulate across scene visits and fire on destroyed objects.
    this.events.once('shutdown', () => this.scale.off('resize', onResize));

    this.setTool('PENGUIN');
    this.updateSealLabel();
    // The stepper's width is fixed by its labels; build it before layout.
    this.renderStepper('build');
    this.layoutAll();
    this.render();
    this.revalidate();
  }

  private makeButton(
    label: string,
    variant: PillVariant,
    onClick: () => void,
    size: PillSize = 'sm'
  ): PillButton {
    return makePill(this, { label, variant, size, onClick });
  }

  private makeToolChip(tool: Tool, label: string): ToolChip {
    const cont = this.add.container(0, 0);
    const bg = this.add.graphics();
    const icon = this.add.container(0, 0);
    const text = this.add
      .text(0, 0, label, { fontFamily: FONT.ui, fontSize: '12px', fontStyle: '600', color: UI.toolLabelIdle })
      .setOrigin(0.5);
    const zone = this.add.zone(0, 0, 64, 52).setInteractive({ useHandCursor: true });
    cont.add([bg, icon, text, zone]);
    // Release-to-activate, like every other button (sliding off cancels).
    armTap(zone, {
      onPress: () => cont.setScale(0.96),
      onCancel: () => cont.setScale(1),
      onTap: () => {
        cont.setScale(1);
        if (tool === 'SEAL') this.onSealToolTap();
        else this.setTool(tool);
      },
    });
    const chip: ToolChip = { tool, cont, bg, icon, label: text, zone, w: 64, h: 52, iconSize: 0, active: false };
    this.drawChip(chip);
    return chip;
  }

  /** (Re)draw a tool chip's rounded background for its current size/active state. */
  private drawChip(chip: ToolChip): void {
    const { bg, w, h, active } = chip;
    bg.clear();
    bg.fillStyle(active ? UI.chipActive : UI.chipIdle, 1);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 12);
    bg.lineStyle(1.5, active ? 0xffe09a : PALETTE.iceEdge, active ? 1 : 0.5);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 12);
  }

  private drawToolIcon(cont: Phaser.GameObjects.Container, tool: Tool, s: number): void {
    if (tool === 'PENGUIN') drawPenguinInto(this, cont, s);
    else if (tool === 'SEAL') drawSealInto(this, cont, s * 0.7, 'H');
    else if (tool === 'ROCK') drawRockInto(this, cont, s);
    else if (tool === 'HOLE') {
      cont.add(this.add.circle(0, 0, s * 0.36, PALETTE.holeRim));
      cont.add(this.add.circle(0, 0, s * 0.3, PALETTE.water));
      cont.add(this.add.ellipse(-s * 0.08, -s * 0.09, s * 0.16, s * 0.09, PALETTE.waterShimmer, 0.85));
    } else {
      cont.add(this.add.circle(0, 0, s * 0.36, 0xffffff, 0.9).setStrokeStyle(Math.max(1, s * 0.05), PALETTE.sealOutline));
      cont.add(this.add.rectangle(0, 0, s * 0.44, Math.max(2, s * 0.09), PALETTE.sealOutline).setRotation(0.785));
      cont.add(this.add.rectangle(0, 0, s * 0.44, Math.max(2, s * 0.09), PALETTE.sealOutline).setRotation(-0.785));
    }
  }

  /** Rebuild the Build -> Test -> Submit indicator, centred on (0,0). */
  private renderStepper(step: Step): void {
    this.stepper.removeAll(true);
    const current = STEPS.findIndex((entry) => entry.step === step);
    const doneCount = step === 'done' ? STEPS.length : Math.max(0, current);
    const radius = 9;
    const connector = 14;
    const nodes: Array<Phaser.GameObjects.Graphics | Phaser.GameObjects.Text> = [];
    let x = 0;
    STEPS.forEach((entry, index) => {
      const done = index < doneCount;
      const active = index === current;
      if (index > 0) {
        const line = this.add.graphics();
        line.lineStyle(2, done || active ? UI.stepDone : UI.stepIdle, done || active ? 0.85 : 0.7);
        line.lineBetween(x + 6, 0, x + 6 + connector, 0);
        nodes.push(line);
        x += connector + 12;
      }
      const dot = this.add.graphics();
      if (done || active) {
        dot.fillStyle(done ? UI.stepDone : PALETTE.waterShimmer, 1);
        dot.fillCircle(x + radius, 0, radius);
      } else {
        dot.fillStyle(UI.chipIdle, 1);
        dot.fillCircle(x + radius, 0, radius);
        dot.lineStyle(1.5, PALETTE.iceEdge, 0.6);
        dot.strokeCircle(x + radius, 0, radius);
      }
      const mark = this.add
        .text(x + radius, 0, done ? '\u2713' : String(index + 1), {
          fontFamily: FONT.ui,
          fontSize: '11px',
          fontStyle: '800',
          color: done || active ? UI.toolLabelActive : UI.text,
        })
        .setOrigin(0.5)
        .setAlpha(done || active ? 1 : 0.6);
      const label = this.add
        .text(x + radius * 2 + 6, 0, entry.label, {
          fontFamily: FONT.ui,
          fontSize: '13px',
          fontStyle: '800',
          color: UI.text,
        })
        .setOrigin(0, 0.5)
        .setAlpha(active ? 1 : done ? 0.85 : 0.5);
      nodes.push(dot, mark, label);
      x += radius * 2 + 6 + label.width;
    });
    for (const node of nodes) node.x -= x / 2;
    this.stepper.add(nodes);
    this.stepperWidth = x;
  }

  private layoutAll(): void {
    const w = viewWidth(this);
    const h = viewHeight(this);
    const cx = w / 2;
    const short = h < 600;
    const tall = h >= 760;
    const panelW = Math.min(PANEL_MAX_W, w - SPACE.md * 2);
    const gap = SPACE.sm;

    // Header: the Menu chip and the Build -> Test -> Submit stepper. A tall
    // screen has room for the title too, with the stepper on its own row.
    const back = this.backButton;
    back.setPosition(SPACE.md + back.width / 2, SPACE.md + back.height / 2);
    const headerMid = back.y;
    const backRight = back.x + back.width / 2;
    let top = headerMid + back.height / 2 + SPACE.sm;
    this.titleText.setVisible(tall);
    if (tall) {
      this.titleText.setPosition(Math.max(cx, backRight + SPACE.md + this.titleText.width / 2), headerMid);
      this.stepper.setScale(1).setPosition(cx, top + STEPPER_H / 2);
      top += STEPPER_H + SPACE.md;
    } else {
      const room = w - backRight - SPACE.md * 2;
      const scale = Math.min(1, room / this.stepperWidth);
      const half = (this.stepperWidth * scale) / 2;
      this.stepper.setScale(scale).setPosition(Math.max(cx, backRight + SPACE.md + half), headerMid);
    }

    // Bottom-up: Test/Submit, the edit chips, then the tool palette. A short,
    // wide screen fits every button on one row.
    let bottom = h - SPACE.lg;
    const edits = [this.undoButton, this.randomButton, this.clearButton];
    const actions = [this.testButton, this.submitButton];
    const all = [...edits, ...actions];
    for (const button of all) button.setMinWidth(0);
    const oneRowW = all.reduce((sum, button) => sum + button.width, 0) + gap * (all.length - 1);
    if (short && oneRowW <= Math.min(w - SPACE.md * 2, 640)) {
      const rowH = Math.max(...all.map((button) => button.height));
      this.placeRow(all, cx, bottom - rowH / 2, gap);
      bottom -= rowH + SPACE.sm;
    } else {
      const actionW = (panelW - gap) / 2;
      for (const button of actions) button.setMinWidth(actionW);
      this.placeRow(actions, cx, bottom - this.testButton.height / 2, gap);
      bottom -= this.testButton.height + gap;
      const editW = (panelW - gap * 2) / 3;
      for (const button of edits) button.setMinWidth(editW);
      this.placeRow(edits, cx, bottom - this.undoButton.height / 2, gap);
      bottom -= this.undoButton.height + SPACE.md;
    }

    const chipH = tall ? 64 : short ? 50 : 56;
    const iconSize = tall ? 28 : short ? 20 : 24;
    const toolGap = 6;
    const count = this.toolChips.length;
    const chipW = Math.min(80, (panelW - toolGap * (count - 1)) / count);
    const toolsW = chipW * count + toolGap * (count - 1);
    const toolsY = bottom - chipH / 2;
    this.toolChips.forEach((chip, index) => {
      chip.cont.setPosition(cx - toolsW / 2 + chipW / 2 + index * (chipW + toolGap), toolsY);
      chip.w = chipW;
      chip.h = chipH;
      if (chip.iconSize !== iconSize) {
        chip.icon.removeAll(true);
        this.drawToolIcon(chip.icon, chip.tool, iconSize);
        chip.iconSize = iconSize;
      }
      chip.icon.setY(-chipH / 2 + 8 + iconSize / 2);
      chip.label.setY(chipH / 2 - 11);
      chip.zone.setSize(chipW, chipH);
      this.drawChip(chip);
    });
    bottom = toolsY - chipH / 2 - SPACE.md;

    // The board and its status read as one group, centred in what is left.
    // The ice sheet's rim (0.16 cell a side) and drop shadow count too, so
    // neither the stepper nor the status ever touches the sheet.
    const shadow = 9;
    const availW = w - SPACE.md * 2;
    const availH = bottom - top - SPACE.xs - STATUS_H;
    this.cell = Math.max(
      24,
      Math.floor(Math.min(availW / (this.width + 0.32), (availH - shadow) / (this.height + 0.32)))
    );
    const rim = this.cell * 0.16;
    const gridW = this.cell * this.width;
    const gridH = this.cell * this.height;
    const sheetH = gridH + rim * 2 + shadow;
    this.originX = (w - gridW) / 2;
    this.originY = top + Math.max(0, availH - sheetH) / 2 + rim;
    this.statusText.setPosition(cx, this.originY + gridH + rim + shadow + SPACE.xs);
    this.statusText.setWordWrapWidth(panelW);
    this.detailText.setWordWrapWidth(panelW);
    this.detailText.setPosition(cx, this.statusText.y + this.statusText.height + 2);
  }

  /** Centre a row of buttons on (cx, y) with `gap` between them. */
  private placeRow(buttons: readonly PillButton[], cx: number, y: number, gap: number): void {
    const total = buttons.reduce((sum, button) => sum + button.width, 0) + gap * (buttons.length - 1);
    let x = cx - total / 2;
    for (const button of buttons) {
      button.setPosition(x + button.width / 2, y);
      x += button.width + gap;
    }
  }

  /** The status under the board, plus an optional quieter detail line. */
  private setStatus(main: string, color: string, detail = ''): void {
    this.statusText.setText(main).setColor(color);
    this.detailText.setText(detail);
    this.detailText.setY(this.statusText.y + this.statusText.height + 2);
  }

  private cellCenter(index: number): { x: number; y: number } {
    const row = Math.floor(index / this.width);
    const col = index % this.width;
    return {
      x: this.originX + col * this.cell + this.cell / 2,
      y: this.originY + row * this.cell + this.cell / 2,
    };
  }

  private pieceCenterPx(cells: readonly number[]): { x: number; y: number } {
    let sx = 0;
    let sy = 0;
    for (const c of cells) {
      const p = this.cellCenter(c);
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / cells.length, y: sy / cells.length };
  }

  private pieceIndexAt(cell: number): number {
    return this.pieces.findIndex((p) => p.cells.includes(cell));
  }

  private serialize(): string {
    return JSON.stringify({ pieces: this.pieces, holes: [...this.holes].sort((a, b) => a - b) });
  }

  private invalidateProof(): void {
    this.proof = undefined;
    this.registry.remove('editor.proof');
  }

  /** Any edit drops the old proof and a stale "Submitted" state. */
  private markEdited(): void {
    this.invalidateProof();
    this.submittedPar = null;
    this.touched = true;
  }

  private render(): void {
    this.boardLayer.removeAll(true);
    this.pieceLayer.removeAll(true);
    const s = this.cell;

    // One connected ice sheet (matches the game board).
    paintIceSheet(this, this.boardLayer, this.originX, this.originY, this.width, this.height, s);

    for (let i = 0; i < this.width * this.height; i++) {
      const { x, y } = this.cellCenter(i);
      if (this.holes.has(i)) this.boardLayer.add(makeWaterHole(this, x, y, s));
      // Transparent tap zone per cell (kept above holes; pieces are non-interactive).
      const zone = this.add.rectangle(x, y, s * 0.96, s * 0.96, 0xffffff, 0.001).setInteractive({ useHandCursor: true });
      zone.on('pointerdown', () => this.applyTool(i));
      this.boardLayer.add(zone);
    }

    for (const piece of this.pieces) {
      const { x, y } = this.pieceCenterPx(piece.cells);
      const c = this.add.container(x, y);
      if (piece.kind === 'HOPPER') drawPenguinInto(this, c, s);
      else if (piece.kind === 'SLIDER') drawSealInto(this, c, s, piece.orient ?? 'H');
      else drawRockInto(this, c, s);
      this.pieceLayer.add(c);
    }
  }

  private applyTool(index: number): void {
    const before = this.serialize();
    const occupied = this.pieceIndexAt(index);
    const isHole = this.holes.has(index);

    if (this.currentTool === 'PENGUIN') {
      if (occupied < 0 && !isHole) this.pieces.push({ kind: 'HOPPER', cells: [index] });
    } else if (this.currentTool === 'ROCK') {
      if (occupied < 0 && !isHole) this.pieces.push({ kind: 'BLOCKER', cells: [index] });
    } else if (this.currentTool === 'SEAL') {
      if (this.sealOrient === 'H') {
        const col = index % this.width;
        const right = index + 1;
        if (
          col <= this.width - 2 &&
          occupied < 0 &&
          this.pieceIndexAt(right) < 0 &&
          !isHole &&
          !this.holes.has(right)
        ) {
          this.pieces.push({ kind: 'SLIDER', cells: [index, right], orient: 'H' });
        }
      } else {
        const down = index + this.width;
        if (
          down < this.width * this.height &&
          occupied < 0 &&
          this.pieceIndexAt(down) < 0 &&
          !isHole &&
          !this.holes.has(down)
        ) {
          this.pieces.push({ kind: 'SLIDER', cells: [index, down], orient: 'V' });
        }
      }
    } else if (this.currentTool === 'HOLE') {
      if (occupied < 0) {
        if (isHole) this.holes.delete(index);
        else this.holes.add(index);
      }
    } else if (this.currentTool === 'ERASE') {
      if (occupied >= 0) this.pieces.splice(occupied, 1);
      else if (isHole) this.holes.delete(index);
    }

    if (this.serialize() !== before) {
      this.history.push(before);
      if (this.history.length > 60) this.history.shift();
      this.markEdited();
    }
    this.render();
    this.revalidate();
  }

  private undo(): void {
    const prev = this.history.pop();
    if (prev === undefined) return;
    const state: { pieces: Piece[]; holes: number[] } = JSON.parse(prev);
    this.pieces = state.pieces;
    this.holes = new Set(state.holes);
    this.markEdited();
    this.render();
    this.revalidate();
  }

  private currentBoard(): Board {
    return {
      width: this.width,
      height: this.height,
      holes: [...this.holes].sort((a, b) => a - b),
      pieces: this.pieces,
    };
  }

  private revalidate(): void {
    const board = this.currentBoard();
    const result = validateSubmission(board);
    this.canTest = result.ok;
    const proofResult = this.proof
      ? verifyCreatorSolveProof(board, this.proof)
      : { ok: false, reason: 'not tested' };
    this.canSubmit = result.ok && proofResult.ok && this.submittedPar === null;

    let step: Step = 'build';
    if (this.submittedPar !== null) {
      step = 'done';
      this.setStatus(
        `Submitted! Par ${this.submittedPar}. The community can play it now.`,
        UI.good,
        'Track its solves and upvotes in My puzzles.'
      );
    } else if (result.ok && proofResult.ok) {
      step = 'submit';
      this.setStatus(
        `Solved by you \u00B7 par ${result.par} \u00B7 ${bandLabel(result.par)}`,
        UI.good,
        'Ready to submit to the community!'
      );
    } else if (result.ok) {
      step = 'test';
      this.setStatus(
        `Solvable \u00B7 par ${result.par} \u00B7 ${bandLabel(result.par)}`,
        UI.good,
        'Now Test it: solve it yourself to unlock Submit.'
      );
    } else if (this.touched) {
      const penguins = this.pieces.filter((piece) => piece.kind === 'HOPPER').length;
      this.setStatus(
        result.reason,
        UI.warn,
        `${countLabel(penguins, 'penguin', 'penguins')} \u00B7 ${countLabel(this.holes.size, 'water hole', 'water holes')}`
      );
    } else {
      this.setStatus('Pick a tool, then tap the ice to build.', UI.text, 'Or tap Random for a starter board.');
    }
    this.renderStepper(step);
    this.testButton.setEnabled(this.canTest);
    this.undoButton.setEnabled(this.history.length > 0);
    this.clearButton.setEnabled(this.pieces.length > 0 || this.holes.size > 0);
    this.refreshSubmitButton();
  }

  /** Submit, or "My puzzles" right after a successful submission. */
  private refreshSubmitButton(): void {
    if (this.submittedPar !== null) {
      this.submitButton.setLabelText('My puzzles \u203A').setVariant('mint').setEnabled(true);
    } else {
      this.submitButton
        .setLabelText('Submit')
        .setVariant('primary')
        .setEnabled(this.canSubmit && !this.submitting);
    }
  }

  private onSubmitTap(): void {
    if (this.submittedPar !== null) {
      fadeToScene(this, 'MyPuzzlesScene');
      return;
    }
    void this.submit();
  }

  /** Save the current board and jump into GameScene to play-test it. */
  private testPuzzle(): void {
    if (!this.canTest) return;
    const board = this.currentBoard();
    const validation = validateSubmission(board);
    const draft: EditorDraft = {
      pieces: this.pieces,
      holes: [...this.holes].sort((a, b) => a - b),
      ...(this.proof ? { proof: this.proof } : {}),
    };
    this.registry.set('editor.draft', draft);
    trackClientEvent('creator_test_started');
    fadeToScene(this, 'GameScene', { test: { board, par: validation.ok ? validation.par : 0 } });
  }

  private setTool(tool: Tool): void {
    this.currentTool = tool;
    for (const chip of this.toolChips) {
      chip.active = chip.tool === tool;
      this.drawChip(chip);
      chip.label.setColor(chip.active ? UI.toolLabelActive : UI.toolLabelIdle);
    }
    if (tool === 'SEAL') this.showSealHint();
  }

  private onSealToolTap(): void {
    if (this.currentTool === 'SEAL') {
      this.sealOrient = this.sealOrient === 'H' ? 'V' : 'H';
      this.showSealHint();
    } else {
      this.setTool('SEAL');
    }
    this.updateSealLabel();
  }

  /** Seal orientation help, in the detail line so the board status stays. */
  private showSealHint(): void {
    this.detailText.setText(
      `Seal: ${this.sealOrient === 'H' ? 'horizontal \u2194' : 'vertical \u2195'} \u00B7 tap Seal again to rotate`
    );
  }

  private updateSealLabel(): void {
    const sealChip = this.toolChips.find((c) => c.tool === 'SEAL');
    if (sealChip) sealChip.label.setText(this.sealOrient === 'H' ? 'Seal \u2194' : 'Seal \u2195');
  }

  private randomFill(): void {
    const g = generate({
      width: this.width,
      height: this.height,
      hoppers: 2,
      sliders: 1,
      blockers: 1,
      minPar: 3,
      maxPar: 7,
      attempts: 1500,
    });
    if (g) {
      this.history.push(this.serialize());
      if (this.history.length > 60) this.history.shift();
      this.markEdited();
      this.pieces = g.board.pieces.map((p) => ({ ...p, cells: [...p.cells] }));
      this.holes = new Set(g.board.holes);
      this.render();
      this.revalidate();
    } else {
      this.setStatus('Could not make a starter \u2014 tap Random again.', UI.warn);
    }
  }

  private clearAll(): void {
    if (this.pieces.length === 0 && this.holes.size === 0) return;
    this.history.push(this.serialize());
    if (this.history.length > 60) this.history.shift();
    this.markEdited();
    this.pieces = [];
    this.holes = new Set<number>();
    this.render();
    this.revalidate();
  }

  private async submit(): Promise<void> {
    if (!this.canSubmit || this.submitting) return;
    const board = this.currentBoard();
    const proof = this.proof;
    const proofResult = proof ? verifyCreatorSolveProof(board, proof) : null;
    if (!proof || !proofResult?.ok) {
      this.canSubmit = false;
      this.refreshSubmitButton();
      this.setStatus('Test and solve this exact puzzle before submitting.', UI.warn);
      return;
    }

    // Building and testing are open to everyone; publishing needs an account.
    // Persist both the board and its exact proof through the sign-in reload.
    if (!context.username) {
      savePendingDraft({
        pieces: this.pieces,
        holes: [...this.holes].sort((a, b) => a - b),
        proof,
      });
      try {
        const launchStorageKey =
          typeof context.postId === 'string' && context.postId.length > 0
            ? `icehop.launch:${context.postId}`
            : 'icehop.launch:no-post';
        sessionStorage.setItem(launchStorageKey, 'build');
      } catch {
        /* The pending draft still survives when storage is partly unavailable. */
      }
      this.setStatus('Sign in to publish your puzzle\u2026', UI.text, 'Your board will be waiting here.');
      showLoginPrompt();
      return;
    }

    this.submitting = true;
    this.refreshSubmitButton();
    this.setStatus('Submitting\u2026', UI.text);
    try {
      const response = await fetch('/api/ugc/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board, proof }),
      });
      const data: SubmitPuzzleResponse = await response.json();
      if (!this.sys.isActive()) return;
      if (data.ok) {
        this.submittedPar = data.par;
        this.invalidateProof();
        clearPendingDraft();
        this.submitting = false;
        this.revalidate();
        // The Submit button became "My puzzles", which may change its width.
        this.layoutAll();
      } else {
        this.setStatus(data.reason, UI.warn);
      }
    } catch (error) {
      console.error(error);
      if (this.sys.isActive()) this.setStatus('Could not submit \u2014 try again.', UI.warn);
    } finally {
      this.submitting = false;
      if (this.sys.isActive()) this.refreshSubmitButton();
    }
  }
}
