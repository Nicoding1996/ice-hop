import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import type { Board, Move, Piece } from '../../shared/game/types';
import type { InitResponse, LeaderboardResponse, SolveResultDTO, UgcSubmission, VoteResponse } from '../../shared/api';
import { legalMoves } from '../../shared/game/moves';
import { applyMove, isSolved } from '../../shared/game/rules';
import { computeStars } from '../../shared/scoring';
import { buildShareText } from '../../shared/share';
import {
  PALETTE as COLORS,
  paintBackdrop,
  paintIceSheet,
  makeWaterHole,
  drawPenguinInto,
  drawPenguinSwimmingInto,
  drawSealInto,
  drawRockInto,
  splashBurst,
  sparkleBurst,
  auroraFlourish,
  fadeInScene,
  fadeToScene,
} from '../art/theme';
import { context } from '@devvit/web/client';
import { playHop, playSlide, playSplash, playWin } from '../audio';

type DragState = {
  pieceIndex: number;
  orient: 'H' | 'V';
  originX: number;
  originY: number;
  min: number;
  max: number;
  targets: { coord: number; move: Move }[];
};

export class GameScene extends Scene {
  private board?: Board;
  private pieces: Piece[] = [];
  private par = 0;
  private moves = 0;
  private date = '';
  private selected: number | null = null;
  private busy = false;
  private won = false;
  private startTime = 0;
  private shareText = '';
  private menuButton!: Phaser.GameObjects.Text;
  private communityPuzzle?: { id: string; board: Board; par: number; creator: string };
  private isCommunity = false;
  private testBoard?: Board;
  private testPar = 0;
  private isTest = false;
  private skipButton!: Phaser.GameObjects.Text;
  private dragState: DragState | null = null;

  private bgLayer!: Phaser.GameObjects.Container;
  private boardLayer!: Phaser.GameObjects.Container;
  private pieceLayer!: Phaser.GameObjects.Container;
  private fxLayer!: Phaser.GameObjects.Container;
  private uiLayer!: Phaser.GameObjects.Container;
  private hudText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private pieceViews: Phaser.GameObjects.Container[] = [];

  private cell = 0;
  private originX = 0;
  private originY = 0;
  private hudHeight = 0;

  constructor() {
    super('GameScene');
  }

  init(data?: {
    community?: { id: string; board: Board; par: number; creator: string };
    test?: { board: Board; par: number };
  }): void {
    this.communityPuzzle = data?.community;
    this.isCommunity = Boolean(data?.community);
    this.testBoard = data?.test?.board;
    this.testPar = data?.test?.par ?? 0;
    this.isTest = Boolean(data?.test);
    // Scene instances are reused across restarts, so reset transient state here.
    this.pieces = [];
    this.moves = 0;
    this.selected = null;
    this.busy = false;
    this.won = false;
    this.dragState = null;
    this.shareText = '';
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.bg);
    fadeInScene(this);
    this.bgLayer = this.add.container(0, 0);
    paintBackdrop(this, this.bgLayer, this.scale.width, this.scale.height);
    this.boardLayer = this.add.container(0, 0);
    this.pieceLayer = this.add.container(0, 0);
    this.fxLayer = this.add.container(0, 0);
    this.uiLayer = this.add.container(0, 0);

    this.hudText = this.add
      .text(0, 0, '', { fontFamily: 'Arial', fontSize: '22px', color: COLORS.text })
      .setOrigin(0.5);
    this.hintText = this.add
      .text(0, 0, 'Tap a penguin to hop  -  drag a seal to slide', {
        fontFamily: 'Arial',
        fontSize: '14px',
        color: COLORS.text,
        align: 'center',
        wordWrap: { width: this.scale.width - 24 },
      })
      .setOrigin(0.5)
      .setAlpha(0.7);
    this.uiLayer.add([this.hudText, this.hintText]);

    this.menuButton = this.add
      .text(0, 0, this.isTest ? '\u2039 Edit' : '\u2039 Menu', {
        fontFamily: 'Arial',
        fontSize: '14px',
        color: COLORS.text,
        backgroundColor: '#1f3f59',
        padding: { left: 11, right: 11, top: 6, bottom: 6 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.menuButton.on('pointerdown', () => fadeToScene(this, this.isTest ? 'EditorScene' : 'HomeScene'));
    this.uiLayer.add(this.menuButton);

    this.skipButton = this.add
      .text(0, 0, 'Skip \u25B6', {
        fontFamily: 'Arial',
        fontSize: '14px',
        color: '#062033',
        backgroundColor: '#ffe08a',
        padding: { left: 10, right: 10, top: 5, bottom: 5 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.skipButton.on('pointerdown', () => this.nextCommunity());
    this.uiLayer.add(this.skipButton);

    // Tapping empty ice clears the current selection.
    this.input.on(
      'pointerdown',
      (_pointer: Phaser.Input.Pointer, currentlyOver: Phaser.GameObjects.GameObject[]) => {
        if (!this.busy && !this.won && currentlyOver.length === 0 && this.selected !== null) {
          this.selected = null;
          this.renderHighlights();
        }
      }
    );

    // Seal dragging.
    this.input.on('dragstart', (_p: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject) =>
      this.onSealDragStart(obj)
    );
    this.input.on(
      'drag',
      (_p: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject, dragX: number, dragY: number) =>
        this.onSealDrag(obj, dragX, dragY)
    );
    this.input.on('dragend', (_p: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject) =>
      this.onSealDragEnd(obj)
    );

    this.scale.on('resize', () => {
      paintBackdrop(this, this.bgLayer, this.scale.width, this.scale.height);
      if (!this.board) return;
      this.layout();
      this.renderBoard();
      this.updateHud();
    });

    void this.loadPuzzle();
  }

  private async loadPuzzle(): Promise<void> {
    if (this.isTest && this.testBoard) {
      this.board = this.testBoard;
      this.pieces = this.testBoard.pieces.map((p) => ({ ...p, cells: [...p.cells] }));
      this.par = this.testPar;
      this.date = '';
      this.moves = 0;
      this.startTime = Date.now();
      this.layout();
      this.renderBoard();
      this.updateHud();
      return;
    }
    if (this.communityPuzzle) {
      this.board = this.communityPuzzle.board;
      this.pieces = this.communityPuzzle.board.pieces.map((p) => ({ ...p, cells: [...p.cells] }));
      this.par = this.communityPuzzle.par;
      this.date = '';
      this.moves = 0;
      this.startTime = Date.now();
      this.layout();
      this.renderBoard();
      this.updateHud();
      return;
    }
    try {
      const response = await fetch('/api/init');
      if (!response.ok) throw new Error(`init failed: ${response.status}`);
      const data: InitResponse = await response.json();
      this.board = data.board;
      this.pieces = data.board.pieces.map((p) => ({ ...p, cells: [...p.cells] }));
      this.par = data.par;
      this.date = data.date;
      this.moves = 0;
      this.startTime = Date.now();
      this.layout();
      this.renderBoard();
      this.updateHud();
    } catch (error) {
      console.error(error);
      this.hudText.setText('Could not load today\u2019s puzzle');
      this.hudText.setPosition(this.scale.width / 2, this.scale.height / 2);
    }
  }

  private layout(): void {
    if (!this.board) return;
    const w = this.scale.width;
    const h = this.scale.height;
    this.hudHeight = Math.min(72, h * 0.13);
    const pad = 16;
    const availW = w - pad * 2;
    const availH = h - this.hudHeight - pad * 2;
    this.cell = Math.max(24, Math.floor(Math.min(availW / this.board.width, availH / this.board.height)));
    const gridW = this.cell * this.board.width;
    const gridH = this.cell * this.board.height;
    this.originX = (w - gridW) / 2;
    this.originY = this.hudHeight + (h - this.hudHeight - gridH) / 2;
  }

  private cellCenter(index: number): { x: number; y: number } {
    if (!this.board) return { x: 0, y: 0 };
    const row = Math.floor(index / this.board.width);
    const col = index % this.board.width;
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

  private renderBoard(): void {
    if (!this.board) return;
    this.boardLayer.removeAll(true);
    this.pieceLayer.removeAll(true);
    this.pieceViews = [];
    const s = this.cell;
    const holes = new Set(this.board.holes);

    // One connected ice sheet under the whole grid (not loose tiles).
    paintIceSheet(this, this.boardLayer, this.originX, this.originY, this.board.width, this.board.height, s);
    // Carve the water holes into the sheet.
    for (const hole of holes) {
      const { x, y } = this.cellCenter(hole);
      this.boardLayer.add(makeWaterHole(this, x, y, s));
    }

    this.pieces.forEach((piece, idx) => {
      const { x, y } = this.pieceCenterPx(piece.cells);
      const container = this.add.container(x, y);
      // Inner art node: idle/move animation lives here so the outer container is
      // free to own position, hit-area, and dragging.
      const art = this.add.container(0, 0);
      container.add(art);
      container.setData('art', art);

      if (piece.kind === 'HOPPER') {
        this.makeSelectable(container, s * 0.82, s * 0.82, idx);
      } else if (piece.kind === 'SLIDER') {
        const orient = piece.orient ?? 'H';
        const w = orient === 'H' ? s * 1.8 : s * 0.82;
        const hgt = orient === 'H' ? s * 0.82 : s * 1.8;
        this.makeSelectable(container, w, hgt, idx);
        container.setData('pieceIndex', idx);
        container.setData('slider', true);
        this.input.setDraggable(container);
      }
      this.pieceLayer.add(container);
      this.pieceViews[idx] = container;
      this.buildPieceArt(container, piece, idx);
    });

    this.renderHighlights();
  }

  /** Start the gentle idle breathing bob on a piece's art node. */
  private startBob(art: Phaser.GameObjects.Container, idx: number, amp: number): void {
    this.tweens.add({
      targets: art,
      y: -this.cell * amp,
      duration: 1300 + (idx % 3) * 180,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  /** (Re)draw one piece's art in place: penguin (standing, or swimming when on a
   *  hole), seal, or rock. Only this piece is touched, so other pieces' idle
   *  animations and the water shimmer keep running across moves. */
  private buildPieceArt(view: Phaser.GameObjects.Container, piece: Piece, idx: number): void {
    const art: Phaser.GameObjects.Container | undefined = view.getData('art');
    if (!art) return;
    this.tweens.killTweensOf(art);
    art.removeAll(true);
    art.setScale(1);
    art.setRotation(0);
    art.y = 0;
    const s = this.cell;
    if (piece.kind === 'HOPPER') {
      if (this.board?.holes.includes(piece.cells[0])) {
        drawPenguinSwimmingInto(this, art, s);
        this.startBob(art, idx, 0.03);
      } else {
        drawPenguinInto(this, art, s);
        this.startBob(art, idx, 0.05);
      }
    } else if (piece.kind === 'SLIDER') {
      drawSealInto(this, art, s, piece.orient ?? 'H');
    } else {
      drawRockInto(this, art, s);
    }
  }

  private makeSelectable(
    container: Phaser.GameObjects.Container,
    w: number,
    h: number,
    idx: number
  ): void {
    container.setInteractive(
      new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h),
      Phaser.Geom.Rectangle.Contains
    );
    container.on('pointerdown', () => {
      if (this.busy || this.won || this.dragState) return;
      this.selected = this.selected === idx ? null : idx;
      this.renderHighlights();
    });
  }

  private renderHighlights(): void {
    if (!this.board) return;
    this.fxLayer.removeAll(true);
    // Reset selection emphasis on every piece.
    this.pieceViews.forEach((v) => {
      const a: Phaser.GameObjects.Container | undefined = v?.getData('art');
      if (a) a.setScale(1);
    });
    if (this.selected === null) return;

    const selArt: Phaser.GameObjects.Container | undefined = this.pieceViews[this.selected]?.getData('art');
    if (selArt) selArt.setScale(1.1);

    const sel = this.pieces[this.selected];
    const selCenter = this.pieceCenterPx(sel.cells);
    const ring = this.add.circle(selCenter.x, selCenter.y, this.cell * 0.46);
    ring.setFillStyle(0, 0);
    ring.setStrokeStyle(3, COLORS.select);
    this.fxLayer.add(ring);

    const moves = legalMoves(this.board, this.pieces).filter((m) => m.pieceIndex === this.selected);

    if (sel.kind === 'HOPPER') {
      for (const move of moves) {
        const center = this.pieceCenterPx(move.to);
        const dot = this.add.circle(center.x, center.y, this.cell * 0.18, COLORS.hint, 0.9);
        dot.setStrokeStyle(2, 0xffffff);
        dot.setInteractive();
        dot.on(
          'pointerdown',
          (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
            event.stopPropagation();
            this.doMove(move);
          }
        );
        this.fxLayer.add(dot);
      }
    } else if (sel.kind === 'SLIDER') {
      // Seals are dragged; show arrow hints on the directions it can slide.
      this.drawSealDragHint(sel, selCenter, moves);
    }
  }

  private drawSealDragHint(
    piece: Piece,
    center: { x: number; y: number },
    moves: readonly Move[]
  ): void {
    const orient = piece.orient ?? 'H';
    const s = this.cell;
    const mk = (x: number, y: number, ch: string): Phaser.GameObjects.Text =>
      this.add
        .text(x, y, ch, { fontFamily: 'Arial', fontSize: `${Math.round(s * 0.4)}px`, color: COLORS.arrow })
        .setOrigin(0.5);

    if (orient === 'H') {
      const canLeft = moves.some((m) => this.pieceCenterPx(m.to).x < center.x - 1);
      const canRight = moves.some((m) => this.pieceCenterPx(m.to).x > center.x + 1);
      if (canLeft) this.fxLayer.add(mk(center.x - s, center.y, '\u25C0'));
      if (canRight) this.fxLayer.add(mk(center.x + s, center.y, '\u25B6'));
    } else {
      const canUp = moves.some((m) => this.pieceCenterPx(m.to).y < center.y - 1);
      const canDown = moves.some((m) => this.pieceCenterPx(m.to).y > center.y + 1);
      if (canUp) this.fxLayer.add(mk(center.x, center.y - s, '\u25B2'));
      if (canDown) this.fxLayer.add(mk(center.x, center.y + s, '\u25BC'));
    }
  }

  private onSealDragStart(obj: Phaser.GameObjects.GameObject): void {
    if (!this.board || this.busy || this.won) return;
    if (obj.getData('slider') !== true) return;
    const pieceIndex: number = obj.getData('pieceIndex');
    const piece = this.pieces[pieceIndex];
    if (!piece) return;

    const orient = piece.orient ?? 'H';
    const origin = this.pieceCenterPx(piece.cells);
    const targets = legalMoves(this.board, this.pieces)
      .filter((m) => m.pieceIndex === pieceIndex)
      .map((m) => {
        const c = this.pieceCenterPx(m.to);
        return { coord: orient === 'H' ? c.x : c.y, move: m };
      });
    const originCoord = orient === 'H' ? origin.x : origin.y;
    const coords = [originCoord, ...targets.map((t) => t.coord)];

    this.dragState = {
      pieceIndex,
      orient,
      originX: origin.x,
      originY: origin.y,
      min: Math.min(...coords),
      max: Math.max(...coords),
      targets,
    };
    this.selected = null;
    this.fxLayer.removeAll(true);
  }

  private onSealDrag(_obj: Phaser.GameObjects.GameObject, dragX: number, dragY: number): void {
    const ds = this.dragState;
    if (!ds) return;
    const view = this.pieceViews[ds.pieceIndex];
    if (!view) return;
    if (ds.orient === 'H') {
      view.x = Phaser.Math.Clamp(dragX, ds.min, ds.max);
      view.y = ds.originY;
    } else {
      view.y = Phaser.Math.Clamp(dragY, ds.min, ds.max);
      view.x = ds.originX;
    }
  }

  private onSealDragEnd(_obj: Phaser.GameObjects.GameObject): void {
    const ds = this.dragState;
    this.dragState = null;
    if (!ds || !this.board) return;
    const view = this.pieceViews[ds.pieceIndex];
    const current = ds.orient === 'H'
      ? view
        ? view.x
        : ds.originX
      : view
        ? view.y
        : ds.originY;

    const originCoord = ds.orient === 'H' ? ds.originX : ds.originY;
    let bestMove: Move | null = null;
    let bestDist = Math.abs(current - originCoord);
    for (const t of ds.targets) {
      const d = Math.abs(current - t.coord);
      if (d < bestDist) {
        bestDist = d;
        bestMove = t.move;
      }
    }

    if (bestMove) {
      this.doMove(bestMove);
    } else if (view) {
      // Snap back to the start position.
      view.x = ds.originX;
      view.y = ds.originY;
    }
  }

  private doMove(move: Move): void {
    if (!this.board || this.busy || this.won) return;
    this.busy = true;
    this.fxLayer.removeAll(true);
    const view = this.pieceViews[move.pieceIndex];
    const target = this.pieceCenterPx(move.to);
    const landsInWater = move.to.every((cell) => this.board?.holes.includes(cell));

    const commit = (): void => {
      if (!this.board) return;
      if (landsInWater) {
        splashBurst(this, this.fxLayer, target.x, target.y, this.cell);
        playSplash();
      }
      this.pieces = applyMove(this.pieces, move);
      this.moves += 1;
      this.selected = null;
      this.busy = false;
      // Rebuild only the moved piece's art (its outer view is already tweened to
      // the destination); every other piece keeps its idle animation running.
      const movedView = this.pieceViews[move.pieceIndex];
      if (movedView) this.buildPieceArt(movedView, this.pieces[move.pieceIndex], move.pieceIndex);
      this.updateHud();
      this.renderHighlights();
      // Dive-pop after highlights (which resets scales), so a penguin that just
      // entered the water bobs up from below.
      if (landsInWater && move.kind === 'HOPPER' && movedView) {
        const movedArt: Phaser.GameObjects.Container | undefined = movedView.getData('art');
        if (movedArt) {
          movedArt.setScale(1.12, 0.6);
          this.tweens.add({ targets: movedArt, scaleX: 1, scaleY: 1, duration: 300, ease: 'Back.easeOut' });
        }
      }
      if (isSolved(this.board, this.pieces)) this.onWin();
    };

    if (!view) {
      commit();
      return;
    }

    const art: Phaser.GameObjects.Container | undefined = view.getData('art');
    if (art) this.tweens.killTweensOf(art);

    const duration = move.kind === 'HOPPER' ? 240 : 200;
    if (move.kind === 'HOPPER') playHop();
    else playSlide();
    this.tweens.add({ targets: view, x: target.x, y: target.y, duration, ease: 'Quad.easeOut', onComplete: commit });

    if (art && move.kind === 'HOPPER') {
      // Lift through an arc with a squash on take-off and landing.
      this.tweens.add({ targets: art, y: -this.cell * 0.45, duration: duration / 2, yoyo: true, ease: 'Sine.easeOut' });
      this.tweens.add({ targets: art, scaleX: 0.86, scaleY: 1.2, duration: duration / 2, yoyo: true, ease: 'Sine.easeOut' });
    } else if (art) {
      // Seal slide: a brief squash in the direction of travel.
      this.tweens.add({ targets: art, scaleX: 1.12, scaleY: 0.9, duration: duration / 2, yoyo: true, ease: 'Sine.easeOut' });
    }
  }

  private updateHud(): void {
    this.hudText.setText(`Moves ${this.moves}    Par ${this.par}`);
    this.hudText.setPosition(this.scale.width / 2, this.hudHeight / 2);
    this.hintText.setPosition(this.scale.width / 2, this.scale.height - 22);
    this.hintText.setVisible(this.moves === 0 && !this.won && !this.isCommunity);
    this.menuButton.setPosition(52, this.hudHeight / 2);
    this.menuButton.setVisible(!this.won);
    this.skipButton.setPosition(this.scale.width - 52, this.hudHeight / 2);
    this.skipButton.setVisible(this.isCommunity && !this.won);
  }

  private onWin(): void {
    this.won = true;
    this.menuButton.setVisible(false);
    this.skipButton.setVisible(false);
    if (this.isTest) {
      this.onWinTest();
      return;
    }
    if (this.isCommunity) {
      this.onWinCommunity();
      return;
    }
    playWin();
    const stars = computeStars(this.moves, this.par);
    const blurb = stars === 3 ? 'A clean run!' : stars === 2 ? 'Nicely done!' : 'Can you do it in fewer?';
    const w = this.scale.width;
    const h = this.scale.height;
    this.fxLayer.removeAll(true);

    this.shareText = buildShareText({
      date: this.date,
      moves: this.moves,
      par: this.par,
      stars,
      streak: 1,
      rank: 0,
      totalPlayers: 0,
    });

    const overlay = this.add.rectangle(w / 2, h / 2, w, h, 0x05131f, 0.78).setInteractive();
    this.fxLayer.add(overlay);

    // Aurora curtains near the top only for a standout (3-star) win.
    if (stars === 3) auroraFlourish(this, this.fxLayer, w, h * 0.12);

    const headline = this.add
      .text(w / 2, h * 0.24, `The colony made it in!\n${blurb}`, {
        fontFamily: 'Arial',
        fontSize: '22px',
        color: COLORS.text,
        align: 'center',
        lineSpacing: 6,
        wordWrap: { width: w - 48 },
      })
      .setOrigin(0.5)
      .setAlpha(0);
    this.fxLayer.add(headline);
    this.tweens.add({ targets: headline, alpha: 1, y: h * 0.22, duration: 300, ease: 'Quad.easeOut' });

    // Stars pop in one by one (earned spin); empty ones stay dim.
    const starY = h * 0.37;
    const gap = Math.min(54, w * 0.16);
    const outer = Math.min(24, w * 0.07);
    for (let i = 0; i < 3; i++) {
      const earned = i < stars;
      const star = this.add
        .star(w / 2 + (i - 1) * gap, starY, 5, outer * 0.45, outer, earned ? COLORS.gold : 0x32485c)
        .setStrokeStyle(2, earned ? 0xffe9a8 : 0x4a6377)
        .setScale(0);
      this.fxLayer.add(star);
      this.tweens.add({ targets: star, scale: 1, duration: 300, delay: 300 + i * 180, ease: 'Back.easeOut' });
      if (earned) {
        this.tweens.add({ targets: star, angle: 360, duration: 500, delay: 300 + i * 180, ease: 'Cubic.easeOut' });
      }
    }

    // Moves count up to the final tally.
    const movesText = this.add
      .text(w / 2, h * 0.5, `0 moves   (par ${this.par})`, { fontFamily: 'Arial', fontSize: '20px', color: COLORS.text })
      .setOrigin(0.5);
    this.fxLayer.add(movesText);
    const counter = { v: 0 };
    this.tweens.add({
      targets: counter,
      v: this.moves,
      duration: 600,
      delay: 250,
      ease: 'Cubic.easeOut',
      onUpdate: () => movesText.setText(`${Math.round(counter.v)} moves   (par ${this.par})`),
    });

    // Celebration sparkles once the stars are landing.
    this.time.delayedCall(520, () => sparkleBurst(this, this.fxLayer, w / 2, starY, Math.min(60, w * 0.16)));

    const status = this.add
      .text(w / 2, h * 0.63, 'Saving your score...', {
        fontFamily: 'Arial',
        fontSize: '15px',
        color: COLORS.text,
        align: 'center',
        lineSpacing: 6,
        wordWrap: { width: w - 40 },
      })
      .setOrigin(0.5)
      .setAlpha(0.9);
    const copyButton = this.add
      .text(w / 2, h * 0.88, 'Copy result to share', {
        fontFamily: 'Arial',
        fontSize: '17px',
        color: '#062033',
        backgroundColor: '#ffd166',
        padding: { left: 18, right: 18, top: 10, bottom: 10 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    copyButton.on('pointerdown', () => {
      void this.copyResult(copyButton);
    });

    this.fxLayer.add([status, copyButton]);
    void this.submitSolve(status);
  }

  private onWinCommunity(): void {
    const playedId = this.communityPuzzle?.id;
    if (playedId) void this.markPlayed(playedId);
    playWin();
    const w = this.scale.width;
    const h = this.scale.height;
    this.fxLayer.removeAll(true);
    const creator = this.communityPuzzle?.creator ?? 'a redditor';
    const isMine = Boolean(context.username) && this.communityPuzzle?.creator === context.username;
    const overlay = this.add.rectangle(w / 2, h / 2, w, h, 0x05131f, 0.78).setInteractive();
    const panel = this.add
      .text(w / 2, h * 0.32, `${isMine ? 'Solved your own puzzle!' : `Solved ${creator}'s puzzle!`}\n${this.moves} moves`, {
        fontFamily: 'Arial',
        fontSize: '22px',
        color: COLORS.text,
        align: 'center',
        lineSpacing: 8,
        wordWrap: { width: w - 48 },
      })
      .setOrigin(0.5);
    const voteButton = isMine
      ? this.add
          .text(w / 2, h * 0.54, 'Your puzzle - nice build!', {
            fontFamily: 'Arial',
            fontSize: '16px',
            color: COLORS.text,
          })
          .setOrigin(0.5)
      : this.add
          .text(w / 2, h * 0.54, 'Upvote this puzzle', {
            fontFamily: 'Arial',
            fontSize: '18px',
            color: '#062033',
            backgroundColor: '#aef0d2',
            padding: { left: 16, right: 16, top: 10, bottom: 10 },
          })
          .setOrigin(0.5)
          .setInteractive({ useHandCursor: true });
    if (!isMine) voteButton.on('pointerdown', () => void this.upvoteCurrent(voteButton));
    const moreButton = this.add
      .text(w / 2, h * 0.68, 'Next puzzle \u25B6', {
        fontFamily: 'Arial',
        fontSize: '16px',
        color: '#062033',
        backgroundColor: '#aef0d2',
        padding: { left: 14, right: 14, top: 8, bottom: 8 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    moreButton.on('pointerdown', () => this.nextCommunity());
    const dailyButton = this.add
      .text(w / 2, h * 0.8, 'Back to daily', { fontFamily: 'Arial', fontSize: '16px', color: COLORS.text })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    dailyButton.on('pointerdown', () => fadeToScene(this, 'GameScene'));
    this.fxLayer.add([overlay, panel, voteButton, moreButton, dailyButton]);
    panel.setScale(0.92).setAlpha(0);
    this.tweens.add({ targets: panel, scale: 1, alpha: 1, duration: 280, ease: 'Back.easeOut' });
    this.time.delayedCall(180, () => sparkleBurst(this, this.fxLayer, w / 2, h * 0.32, Math.min(48, w * 0.13)));
  }

  private onWinTest(): void {
    playWin();
    const w = this.scale.width;
    const h = this.scale.height;
    this.fxLayer.removeAll(true);
    const overlay = this.add.rectangle(w / 2, h / 2, w, h, 0x05131f, 0.78).setInteractive();
    const panel = this.add
      .text(w / 2, h * 0.36, `Your puzzle works!\nSolvable in ${this.moves} moves`, {
        fontFamily: 'Arial',
        fontSize: '22px',
        color: COLORS.text,
        align: 'center',
        lineSpacing: 8,
        wordWrap: { width: w - 48 },
      })
      .setOrigin(0.5);
    const back = this.add
      .text(w / 2, h * 0.56, 'Back to editing', {
        fontFamily: 'Arial',
        fontSize: '18px',
        color: '#062033',
        backgroundColor: '#ff8a5b',
        padding: { left: 18, right: 18, top: 10, bottom: 10 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    back.on('pointerdown', () => fadeToScene(this, 'EditorScene'));
    this.fxLayer.add([overlay, panel, back]);
    panel.setScale(0.92).setAlpha(0);
    this.tweens.add({ targets: panel, scale: 1, alpha: 1, duration: 280, ease: 'Back.easeOut' });
    this.time.delayedCall(150, () => sparkleBurst(this, this.fxLayer, w / 2, h * 0.36, Math.min(48, w * 0.13)));
  }

  private async markPlayed(id: string): Promise<void> {
    try {
      await fetch('/api/ugc/played', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
    } catch (error) {
      console.error(error);
    }
  }

  private async upvoteCurrent(button: Phaser.GameObjects.Text): Promise<void> {
    const id = this.communityPuzzle?.id;
    if (!id) return;
    try {
      const response = await fetch('/api/ugc/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data: VoteResponse = await response.json();
      button.setText(data.ok ? `Upvoted! (${data.votes})` : data.reason ?? 'Already upvoted');
      button.disableInteractive();
    } catch (error) {
      console.error(error);
      button.setText('Could not upvote');
    }
  }

  private nextCommunity(): void {
    const queue: UgcSubmission[] = this.registry.get('ugc.queue') ?? [];
    const idx = (this.registry.get('ugc.index') ?? 0) + 1;
    this.registry.set('ugc.index', idx);
    if (idx < queue.length) {
      const next = queue[idx];
      fadeToScene(this, 'GameScene', {
        community: { id: next.id, board: next.board, par: next.par, creator: next.creator },
      });
    } else {
      this.showStreamDone();
    }
  }

  private showStreamDone(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    this.won = true;
    this.skipButton.setVisible(false);
    this.fxLayer.removeAll(true);
    const overlay = this.add.rectangle(w / 2, h / 2, w, h, 0x05131f, 0.78).setInteractive();
    const panel = this.add
      .text(w / 2, h * 0.36, "That's all the community puzzles for now!", {
        fontFamily: 'Arial',
        fontSize: '20px',
        color: COLORS.text,
        align: 'center',
        lineSpacing: 8,
        wordWrap: { width: w - 48 },
      })
      .setOrigin(0.5);
    const buildBtn = this.add
      .text(w / 2, h * 0.56, 'Build a puzzle', {
        fontFamily: 'Arial',
        fontSize: '17px',
        color: '#062033',
        backgroundColor: '#aef0d2',
        padding: { left: 14, right: 14, top: 9, bottom: 9 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    buildBtn.on('pointerdown', () => fadeToScene(this, 'EditorScene'));
    const dailyBtn = this.add
      .text(w / 2, h * 0.68, 'Back to daily', { fontFamily: 'Arial', fontSize: '16px', color: COLORS.text })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    dailyBtn.on('pointerdown', () => fadeToScene(this, 'GameScene'));
    this.fxLayer.add([overlay, panel, buildBtn, dailyBtn]);
  }

  private async submitSolve(status: Phaser.GameObjects.Text): Promise<void> {
    try {
      const timeMs = Date.now() - this.startTime;
      const response = await fetch('/api/solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: this.date, moves: this.moves, timeMs }),
      });
      if (!response.ok) throw new Error(`solve failed: ${response.status}`);
      const result: SolveResultDTO = await response.json();

      this.shareText = buildShareText({
        date: this.date,
        moves: this.moves,
        par: this.par,
        stars: computeStars(this.moves, this.par),
        streak: result.streak,
        rank: result.rank,
        totalPlayers: result.totalPlayers,
      });

      const lines: string[] = [];
      if (result.totalPlayers >= 2 && result.rank > 0) {
        lines.push(`You're #${result.rank} of ${result.totalPlayers} today`);
      } else if (result.rank > 0) {
        lines.push('You set today\u2019s pace - first one in!');
      } else {
        lines.push('Sign in to save your score and rank');
      }
      if (result.streak > 1) lines.push(`Streak: ${result.streak} days`);
      if (result.bestMoves < this.moves) lines.push(`Your best today: ${result.bestMoves} moves`);

      if (result.totalPlayers >= 2) {
        const top = await this.fetchLeaderboard();
        if (top.length > 0) {
          lines.push('');
          lines.push('Top solvers today');
          top.forEach((entry, i) => lines.push(`${i + 1}. ${entry.username} - ${entry.moves} moves`));
        }
      }
      status.setText(lines.join('\n'));
    } catch (error) {
      console.error(error);
      status.setText('Score saved. (Leaderboard unavailable.)');
    }
  }

  private async copyResult(button: Phaser.GameObjects.Text): Promise<void> {
    if (!this.shareText) return;
    try {
      await navigator.clipboard.writeText(this.shareText);
      button.setText('Copied! Paste it in the comments');
    } catch (error) {
      console.error(error);
      button.setText('Copy failed - select the text manually');
    }
  }

  private async fetchLeaderboard(): Promise<{ username: string; moves: number }[]> {
    try {
      const response = await fetch(`/api/leaderboard?date=${encodeURIComponent(this.date)}`);
      if (!response.ok) return [];
      const data: LeaderboardResponse = await response.json();
      return data.entries.slice(0, 3).map((e) => ({ username: e.username, moves: e.moves }));
    } catch {
      return [];
    }
  }
}
