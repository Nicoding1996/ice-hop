import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import type { Board, Piece } from '../../shared/game/types';
import type { SubmitPuzzleResponse } from '../../shared/api';
import { validateSubmission } from '../../shared/solver/validate';
import { generate } from '../../shared/solver/generator';
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
} from '../art/theme';

// CSS-string colours for status text; numbers for the tool-chip shape fills.
const UI = {
  text: '#eaf6fb',
  good: '#8fe0c0',
  warn: '#ffd27e',
  toolLabelIdle: '#dbeaf3',
  toolLabelActive: '#062033',
  chipIdle: 0x1f3f59,
  chipActive: 0xffd166,
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
  label: Phaser.GameObjects.Text;
  w: number;
  h: number;
  active: boolean;
};

export class EditorScene extends Scene {
  private readonly width = 5;
  private readonly height = 5;
  private holes = new Set<number>();
  private pieces: Piece[] = [];
  private currentTool: Tool = 'PENGUIN';
  private sealOrient: 'H' | 'V' = 'H';
  private history: string[] = [];
  private canSubmit = false;
  private submitting = false;
  private touched = false;

  private bgLayer!: Phaser.GameObjects.Container;
  private boardLayer!: Phaser.GameObjects.Container;
  private pieceLayer!: Phaser.GameObjects.Container;
  private titleText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private backButton!: PillButton;
  private toolChips: ToolChip[] = [];
  private testButton!: PillButton;
  private submitButton!: PillButton;
  private actionButtons: PillButton[] = [];

  private cell = 0;
  private originX = 0;
  private originY = 0;

  constructor() {
    super('EditorScene');
  }

  create(): void {
    this.holes = new Set<number>();
    this.pieces = [];
    this.history = [];
    this.sealOrient = 'H';
    this.canSubmit = false;
    this.submitting = false;
    this.touched = false;

    // Restore an in-progress board if we are returning from "Test".
    const draft: { pieces: Piece[]; holes: number[] } | undefined = this.registry.get('editor.draft');
    if (draft) {
      this.pieces = draft.pieces.map((p) => ({ ...p, cells: [...p.cells] }));
      this.holes = new Set(draft.holes);
      this.registry.remove('editor.draft');
      this.touched = true;
    }

    this.cameras.main.setBackgroundColor(PALETTE.bg);
    fadeInScene(this);
    this.bgLayer = this.add.container(0, 0);
    paintBackdrop(this, this.bgLayer, this.scale.width, this.scale.height);
    this.boardLayer = this.add.container(0, 0);
    this.pieceLayer = this.add.container(0, 0);

    this.titleText = this.add
      .text(0, 0, 'Build a puzzle', { fontFamily: FONT.display, fontSize: '22px', fontStyle: '700', color: UI.text })
      .setOrigin(0.5);
    this.statusText = this.add
      .text(0, 0, '', { fontFamily: FONT.ui, fontSize: '14px', fontStyle: '600', color: UI.warn, align: 'center' })
      .setOrigin(0.5);
    this.backButton = this.makeButton('\u2039 Back', 'chip', () => fadeToScene(this, 'HomeScene'));

    this.toolChips = TOOLS.map(({ tool, label }) => this.makeToolChip(tool, label));

    this.testButton = this.makeButton('Test', 'secondary', () => this.testPuzzle());
    this.submitButton = this.makeButton('Submit', 'primary', () => void this.submit());
    this.actionButtons = [
      this.makeButton('Random', 'secondary', () => this.randomFill()),
      this.makeButton('Undo', 'secondary', () => this.undo()),
      this.makeButton('Clear', 'secondary', () => this.clearAll()),
      this.testButton,
      this.submitButton,
    ];

    this.scale.on('resize', () => {
      paintBackdrop(this, this.bgLayer, this.scale.width, this.scale.height);
      this.layoutAll();
      this.render();
    });

    this.setTool('PENGUIN');
    this.updateSealLabel();
    this.layoutAll();
    this.render();
    this.revalidate();
    // Friendly first nudge (unless we restored a draft, which shows its status).
    if (!this.touched) {
      this.statusText.setText('Pick a tool, then tap the ice to build.');
      this.statusText.setColor(UI.text);
    }
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
    const icon = this.add.container(0, -8);
    this.drawToolIcon(icon, tool, 22);
    const text = this.add
      .text(0, 17, label, { fontFamily: FONT.ui, fontSize: '12px', fontStyle: '600', color: UI.toolLabelIdle })
      .setOrigin(0.5);
    cont.add([bg, icon, text]);
    cont.on('pointerdown', () => (tool === 'SEAL' ? this.onSealToolTap() : this.setTool(tool)));
    const chip: ToolChip = { tool, cont, bg, label: text, w: 64, h: 52, active: false };
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

  private layoutAll(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    const topBar = 74;
    const bottomBar = 120;

    this.titleText.setPosition(w / 2, 22);
    this.statusText.setPosition(w / 2, 50);
    this.statusText.setWordWrapWidth(w - 40);
    this.backButton.setPosition(SPACE.md + this.backButton.width / 2, 24);

    const pad = 16;
    const availW = w - pad * 2;
    const availH = h - topBar - bottomBar;
    this.cell = Math.max(24, Math.floor(Math.min(availW / this.width, availH / this.height)));
    const gridW = this.cell * this.width;
    const gridH = this.cell * this.height;
    this.originX = (w - gridW) / 2;
    this.originY = topBar + (availH - gridH) / 2;

    const margin = 8;
    const toolsY = h - bottomBar + 40;
    const chipH = 54;
    const tslot = (w - margin * 2) / this.toolChips.length;
    const cw = Math.min(tslot - 6, 80);
    this.toolChips.forEach((chip, i) => {
      const x = margin + tslot * (i + 0.5);
      chip.cont.setPosition(x, toolsY);
      chip.w = cw;
      chip.h = chipH;
      this.drawChip(chip);
      chip.cont.setInteractive(
        new Phaser.Geom.Rectangle(-cw / 2, -chipH / 2, cw, chipH),
        Phaser.Geom.Rectangle.Contains
      );
    });

    this.spread(this.actionButtons, h - 26);
  }

  private spread(buttons: PillButton[], y: number): void {
    const w = this.scale.width;
    const margin = 10;
    const slot = (w - margin * 2) / buttons.length;
    buttons.forEach((b, i) => b.setPosition(margin + slot * (i + 0.5), y));
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
      this.touched = true;
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
    const result = validateSubmission(this.currentBoard());
    if (result.ok) {
      this.canSubmit = true;
      this.statusText.setText(`Solvable in ${result.par} moves \u2014 tap Submit!`);
      this.statusText.setColor(UI.good);
    } else {
      this.canSubmit = false;
      this.statusText.setText(this.touched ? result.reason : 'Pick a tool, then tap the ice to build.');
      this.statusText.setColor(this.touched ? UI.warn : UI.text);
    }
    this.submitButton.setEnabled(this.canSubmit);
    this.testButton.setEnabled(this.canSubmit);
  }

  /** Save the current board and jump into GameScene to play-test it. */
  private testPuzzle(): void {
    if (!this.canSubmit) return;
    const board = this.currentBoard();
    const validation = validateSubmission(board);
    this.registry.set('editor.draft', { pieces: this.pieces, holes: [...this.holes].sort((a, b) => a - b) });
    fadeToScene(this, 'GameScene', { test: { board, par: validation.ok ? validation.par : 0 } });
  }

  private setTool(tool: Tool): void {
    this.currentTool = tool;
    for (const chip of this.toolChips) {
      chip.active = chip.tool === tool;
      this.drawChip(chip);
      chip.label.setColor(chip.active ? UI.toolLabelActive : UI.toolLabelIdle);
    }
    if (tool === 'SEAL') {
      this.statusText.setText(`Seal is ${this.sealOrient === 'H' ? 'horizontal \u2194' : 'vertical \u2195'} - tap Seal again to rotate`);
      this.statusText.setColor(UI.text);
    }
  }

  private onSealToolTap(): void {
    if (this.currentTool === 'SEAL') {
      this.sealOrient = this.sealOrient === 'H' ? 'V' : 'H';
      this.statusText.setText(`Seal is now ${this.sealOrient === 'H' ? 'horizontal \u2194' : 'vertical \u2195'} - tap to rotate`);
      this.statusText.setColor(UI.text);
    } else {
      this.setTool('SEAL');
    }
    this.updateSealLabel();
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
      this.touched = true;
      this.pieces = g.board.pieces.map((p) => ({ ...p, cells: [...p.cells] }));
      this.holes = new Set(g.board.holes);
      this.render();
      this.revalidate();
    } else {
      this.statusText.setText('Could not make a starter \u2014 tap Random again.');
      this.statusText.setColor(UI.warn);
    }
  }

  private clearAll(): void {
    if (this.pieces.length === 0 && this.holes.size === 0) return;
    this.history.push(this.serialize());
    if (this.history.length > 60) this.history.shift();
    this.pieces = [];
    this.holes = new Set<number>();
    this.render();
    this.revalidate();
  }

  private async submit(): Promise<void> {
    if (!this.canSubmit || this.submitting) return;
    this.submitting = true;
    this.statusText.setText('Submitting...');
    this.statusText.setColor(UI.text);
    try {
      const response = await fetch('/api/ugc/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board: this.currentBoard() }),
      });
      const data: SubmitPuzzleResponse = await response.json();
      if (data.ok) {
        this.statusText.setText(`Submitted! Par ${data.par}. The community can play it now.`);
        this.statusText.setColor(UI.good);
        this.canSubmit = false;
        this.submitButton.setEnabled(false);
      } else {
        this.statusText.setText(data.reason);
        this.statusText.setColor(UI.warn);
      }
    } catch (error) {
      console.error(error);
      this.statusText.setText('Could not submit \u2014 try again.');
      this.statusText.setColor(UI.warn);
    }
    this.submitting = false;
  }
}
