import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import type { Board, Piece } from '../../shared/game/types';
import type { SubmitPuzzleResponse } from '../../shared/api';
import { validateSubmission } from '../../shared/solver/validate';
import { generate } from '../../shared/solver/generator';

const COLORS = {
  bg: 0x0a2a43,
  ice: 0xa7d8ec,
  iceEdge: 0xd6f0fa,
  water: 0x0c3f59,
  waterRing: 0x14628a,
  rock: 0x8b97a4,
  rockTop: 0xbcc6d0,
  seal: 0x556471,
  sealBelly: 0x8b9aa7,
  penguin: 0x232b33,
  penguinBelly: 0xf3f7fa,
  beak: 0xf2a33c,
  eye: 0x10151a,
  text: '#eaf6fb',
  good: '#7ee0b8',
  warn: '#ffd27e',
  toolIdle: '#244a63',
  toolActive: '#ffe08a',
  action: '#aef0d2',
  actionMuted: '#5b6b78',
};

type Tool = 'PENGUIN' | 'SEAL' | 'ROCK' | 'HOLE' | 'ERASE';

const TOOLS: ReadonlyArray<{ tool: Tool; label: string }> = [
  { tool: 'PENGUIN', label: 'Penguin' },
  { tool: 'SEAL', label: 'Seal' },
  { tool: 'ROCK', label: 'Rock' },
  { tool: 'HOLE', label: 'Hole' },
  { tool: 'ERASE', label: 'Erase' },
];

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

  private boardLayer!: Phaser.GameObjects.Container;
  private pieceLayer!: Phaser.GameObjects.Container;
  private titleText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private toolButtons: { tool: Tool; text: Phaser.GameObjects.Text }[] = [];
  private submitButton!: Phaser.GameObjects.Text;
  private actionButtons: Phaser.GameObjects.Text[] = [];

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

    this.cameras.main.setBackgroundColor(COLORS.bg);
    this.boardLayer = this.add.container(0, 0);
    this.pieceLayer = this.add.container(0, 0);

    this.titleText = this.add
      .text(0, 0, 'Build a puzzle', { fontFamily: 'Arial', fontSize: '20px', color: COLORS.text })
      .setOrigin(0.5);
    this.statusText = this.add
      .text(0, 0, '', { fontFamily: 'Arial', fontSize: '15px', color: COLORS.warn, align: 'center' })
      .setOrigin(0.5);

    this.toolButtons = TOOLS.map(({ tool, label }) => ({
      tool,
      text: this.makeButton(
        label,
        COLORS.toolIdle,
        '#ffffff',
        tool === 'SEAL' ? () => this.onSealToolTap() : () => this.setTool(tool)
      ),
    }));

    this.submitButton = this.makeButton('Submit', COLORS.actionMuted, '#062033', () => void this.submit());
    this.actionButtons = [
      this.makeButton('Random', COLORS.action, '#062033', () => this.randomFill()),
      this.makeButton('Undo', COLORS.action, '#062033', () => this.undo()),
      this.makeButton('Clear', COLORS.action, '#062033', () => this.clearAll()),
      this.submitButton,
      this.makeButton('Back', COLORS.action, '#062033', () => this.scene.start('GameScene')),
    ];

    this.scale.on('resize', () => {
      this.layoutAll();
      this.render();
    });

    this.setTool('PENGUIN');
    this.updateSealLabel();
    this.layoutAll();
    this.render();
    this.revalidate();
  }

  private makeButton(
    label: string,
    bg: string,
    fg: string,
    onClick: () => void
  ): Phaser.GameObjects.Text {
    const btn = this.add
      .text(0, 0, label, {
        fontFamily: 'Arial',
        fontSize: '15px',
        color: fg,
        backgroundColor: bg,
        padding: { left: 9, right: 9, top: 6, bottom: 6 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    btn.on('pointerdown', onClick);
    return btn;
  }

  private layoutAll(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    const topBar = 80;
    const bottomBar = 104;

    this.titleText.setPosition(w / 2, 22);
    this.statusText.setPosition(w / 2, 54);
    this.statusText.setWordWrapWidth(w - 24);

    const pad = 16;
    const availW = w - pad * 2;
    const availH = h - topBar - bottomBar;
    this.cell = Math.max(24, Math.floor(Math.min(availW / this.width, availH / this.height)));
    const gridW = this.cell * this.width;
    const gridH = this.cell * this.height;
    this.originX = (w - gridW) / 2;
    this.originY = topBar + (availH - gridH) / 2;

    this.spread(this.toolButtons.map((b) => b.text), h - bottomBar + 34);
    this.spread(this.actionButtons, h - 30);
  }

  private spread(buttons: Phaser.GameObjects.Text[], y: number): void {
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

  private recordHistory(): void {
    this.history.push(this.serialize());
    if (this.history.length > 60) this.history.shift();
  }

  private render(): void {
    this.boardLayer.removeAll(true);
    this.pieceLayer.removeAll(true);
    const s = this.cell;

    for (let i = 0; i < this.width * this.height; i++) {
      const { x, y } = this.cellCenter(i);
      const tile = this.add
        .rectangle(x, y, s * 0.94, s * 0.94, COLORS.ice)
        .setStrokeStyle(2, COLORS.iceEdge)
        .setInteractive({ useHandCursor: true });
      tile.on('pointerdown', () => this.applyTool(i));
      this.boardLayer.add(tile);
      if (this.holes.has(i)) {
        this.boardLayer.add(this.add.circle(x, y, s * 0.37, COLORS.waterRing));
        this.boardLayer.add(this.add.circle(x, y, s * 0.3, COLORS.water));
      }
    }

    for (const piece of this.pieces) {
      const { x, y } = this.pieceCenterPx(piece.cells);
      const c = this.add.container(x, y);
      if (piece.kind === 'HOPPER') this.drawPenguin(c);
      else if (piece.kind === 'SLIDER') this.drawSeal(c, piece.orient ?? 'H');
      else this.drawRock(c);
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
      this.statusText.setText(`Solvable in ${result.par} moves - tap Submit!`);
      this.statusText.setColor(COLORS.good);
    } else {
      this.canSubmit = false;
      this.statusText.setText(result.reason);
      this.statusText.setColor(COLORS.warn);
    }
    this.submitButton.setBackgroundColor(this.canSubmit ? COLORS.action : COLORS.actionMuted);
  }

  private setTool(tool: Tool): void {
    this.currentTool = tool;
    for (const b of this.toolButtons) {
      const active = b.tool === tool;
      b.text.setBackgroundColor(active ? COLORS.toolActive : COLORS.toolIdle);
      b.text.setColor(active ? '#062033' : '#ffffff');
    }
  }

  private onSealToolTap(): void {
    if (this.currentTool === 'SEAL') {
      this.sealOrient = this.sealOrient === 'H' ? 'V' : 'H';
    } else {
      this.setTool('SEAL');
    }
    this.updateSealLabel();
  }

  private updateSealLabel(): void {
    const sealBtn = this.toolButtons.find((b) => b.tool === 'SEAL');
    if (sealBtn) sealBtn.text.setText(this.sealOrient === 'H' ? 'Seal \u2194' : 'Seal \u2195');
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
      this.recordHistory();
      this.pieces = g.board.pieces.map((p) => ({ ...p, cells: [...p.cells] }));
      this.holes = new Set(g.board.holes);
      this.render();
      this.revalidate();
    } else {
      this.statusText.setText('Could not make a starter - tap Random again.');
      this.statusText.setColor(COLORS.warn);
    }
  }

  private clearAll(): void {
    if (this.pieces.length === 0 && this.holes.size === 0) return;
    this.recordHistory();
    this.pieces = [];
    this.holes = new Set<number>();
    this.render();
    this.revalidate();
  }

  private async submit(): Promise<void> {
    if (!this.canSubmit || this.submitting) return;
    this.submitting = true;
    this.statusText.setText('Submitting...');
    this.statusText.setColor(COLORS.text);
    try {
      const response = await fetch('/api/ugc/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board: this.currentBoard() }),
      });
      const data: SubmitPuzzleResponse = await response.json();
      if (data.ok) {
        this.statusText.setText(`Submitted! Par ${data.par}. The community can play it now.`);
        this.statusText.setColor(COLORS.good);
        this.canSubmit = false;
        this.submitButton.setBackgroundColor(COLORS.actionMuted);
      } else {
        this.statusText.setText(data.reason);
        this.statusText.setColor(COLORS.warn);
      }
    } catch (error) {
      console.error(error);
      this.statusText.setText('Could not submit - try again.');
      this.statusText.setColor(COLORS.warn);
    }
    this.submitting = false;
  }

  private drawPenguin(c: Phaser.GameObjects.Container): void {
    const s = this.cell;
    c.add(this.add.ellipse(0, 0, s * 0.62, s * 0.74, COLORS.penguin));
    c.add(this.add.ellipse(0, s * 0.06, s * 0.4, s * 0.54, COLORS.penguinBelly));
    c.add(this.add.triangle(0, s * 0.04, -s * 0.07, 0, s * 0.07, 0, 0, s * 0.12, COLORS.beak));
    c.add(this.add.circle(-s * 0.1, -s * 0.18, s * 0.045, COLORS.eye));
    c.add(this.add.circle(s * 0.1, -s * 0.18, s * 0.045, COLORS.eye));
  }

  private drawSeal(c: Phaser.GameObjects.Container, orient: 'H' | 'V'): void {
    const s = this.cell;
    const long = s * 1.66;
    const short = s * 0.5;
    const w = orient === 'H' ? long : short;
    const h = orient === 'H' ? short : long;
    c.add(this.add.ellipse(0, 0, w, h, COLORS.seal));
    c.add(this.add.ellipse(0, 0, w * 0.7, h * 0.6, COLORS.sealBelly));
    const headX = orient === 'H' ? w * 0.42 : 0;
    const headY = orient === 'H' ? 0 : -h * 0.42;
    c.add(this.add.circle(headX, headY, s * 0.2, COLORS.seal));
  }

  private drawRock(c: Phaser.GameObjects.Container): void {
    const s = this.cell;
    c.add(this.add.rectangle(0, s * 0.08, s * 0.7, s * 0.46, COLORS.rock));
    c.add(this.add.ellipse(0, -s * 0.12, s * 0.62, s * 0.3, COLORS.rockTop));
  }
}
