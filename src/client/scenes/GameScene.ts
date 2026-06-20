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
  drawSealInto,
  drawRockInto,
  splashBurst,
} from '../art/theme';

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
  private buildButton!: Phaser.GameObjects.Text;
  private communityButton!: Phaser.GameObjects.Text;
  private communityPuzzle?: { id: string; board: Board; par: number; creator: string };
  private isCommunity = false;
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

  init(data?: { community?: { id: string; board: Board; par: number; creator: string } }): void {
    this.communityPuzzle = data?.community;
    this.isCommunity = Boolean(data?.community);
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
      })
      .setOrigin(0.5)
      .setAlpha(0.7);
    this.uiLayer.add([this.hudText, this.hintText]);

    this.buildButton = this.add
      .text(0, 0, '+ Build a puzzle', {
        fontFamily: 'Arial',
        fontSize: '14px',
        color: '#062033',
        backgroundColor: '#aef0d2',
        padding: { left: 10, right: 10, top: 5, bottom: 5 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.buildButton.on('pointerdown', () => this.scene.start('EditorScene'));
    this.uiLayer.add(this.buildButton);

    this.communityButton = this.add
      .text(0, 0, 'Community', {
        fontFamily: 'Arial',
        fontSize: '14px',
        color: '#062033',
        backgroundColor: '#aef0d2',
        padding: { left: 10, right: 10, top: 5, bottom: 5 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.communityButton.on('pointerdown', () => this.scene.start('CommunityScene'));
    this.uiLayer.add(this.communityButton);

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
      // Inner art node: idle/hop animation lives here so the outer container is
      // free to own position, hit-area, and dragging.
      const art = this.add.container(0, 0);
      container.add(art);
      container.setData('art', art);

      if (piece.kind === 'HOPPER') {
        drawPenguinInto(this, art, s);
        this.makeSelectable(container, s * 0.82, s * 0.82, idx);
        this.tweens.add({
          targets: art,
          y: -s * 0.05,
          duration: 1300 + (idx % 3) * 180,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      } else if (piece.kind === 'SLIDER') {
        const orient = piece.orient ?? 'H';
        drawSealInto(this, art, s, orient);
        const w = orient === 'H' ? s * 1.8 : s * 0.82;
        const hgt = orient === 'H' ? s * 0.82 : s * 1.8;
        this.makeSelectable(container, w, hgt, idx);
        container.setData('pieceIndex', idx);
        container.setData('slider', true);
        this.input.setDraggable(container);
      } else {
        drawRockInto(this, art, s);
      }
      this.pieceLayer.add(container);
      this.pieceViews[idx] = container;
    });

    this.renderHighlights();
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
      if (landsInWater) splashBurst(this, this.fxLayer, target.x, target.y, this.cell);
      this.pieces = applyMove(this.pieces, move);
      this.moves += 1;
      this.selected = null;
      this.busy = false;
      this.renderBoard();
      this.updateHud();
      if (isSolved(this.board, this.pieces)) this.onWin();
    };

    if (!view) {
      commit();
      return;
    }

    const art: Phaser.GameObjects.Container | undefined = view.getData('art');
    if (art) this.tweens.killTweensOf(art);

    const duration = move.kind === 'HOPPER' ? 240 : 200;
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
    this.hintText.setPosition(this.scale.width / 2, this.scale.height - 44);
    this.hintText.setVisible(this.moves === 0 && !this.won && !this.isCommunity);
    const showNav = !this.won && !this.isCommunity;
    const navY = this.scale.height - 18;
    this.buildButton.setPosition(this.scale.width - 70, navY);
    this.buildButton.setVisible(showNav);
    this.communityButton.setPosition(70, navY);
    this.communityButton.setVisible(showNav);
    this.skipButton.setPosition(this.scale.width - 52, this.hudHeight / 2);
    this.skipButton.setVisible(this.isCommunity && !this.won);
  }

  private onWin(): void {
    this.won = true;
    this.buildButton.setVisible(false);
    this.communityButton.setVisible(false);
    this.skipButton.setVisible(false);
    if (this.isCommunity) {
      this.onWinCommunity();
      return;
    }
    const stars = computeStars(this.moves, this.par);
    const starStr = '\u2605'.repeat(stars) + '\u2606'.repeat(3 - stars);
    const blurb = stars === 3 ? 'A clean run!' : stars === 2 ? 'Nicely done.' : 'You got them home - can you do it in fewer?';
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
    const panel = this.add
      .text(
        w / 2,
        h * 0.32,
        `The colony made it in!\n${blurb}\n\n${this.moves} moves   (par ${this.par})\n${starStr}`,
        { fontFamily: 'Arial', fontSize: '24px', color: COLORS.text, align: 'center', lineSpacing: 8 }
      )
      .setOrigin(0.5);
    const status = this.add
      .text(w / 2, h * 0.6, 'Saving your score...', {
        fontFamily: 'Arial',
        fontSize: '16px',
        color: COLORS.text,
        align: 'center',
        lineSpacing: 6,
      })
      .setOrigin(0.5)
      .setAlpha(0.9);
    const copyButton = this.add
      .text(w / 2, h * 0.85, 'Copy result to share', {
        fontFamily: 'Arial',
        fontSize: '18px',
        color: '#062033',
        backgroundColor: '#aef0d2',
        padding: { left: 18, right: 18, top: 10, bottom: 10 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    copyButton.on('pointerdown', () => {
      void this.copyResult(copyButton);
    });

    this.fxLayer.add([overlay, panel, status, copyButton]);
    void this.submitSolve(status);
  }

  private onWinCommunity(): void {
    const playedId = this.communityPuzzle?.id;
    if (playedId) void this.markPlayed(playedId);
    const w = this.scale.width;
    const h = this.scale.height;
    this.fxLayer.removeAll(true);
    const creator = this.communityPuzzle?.creator ?? 'a redditor';
    const overlay = this.add.rectangle(w / 2, h / 2, w, h, 0x05131f, 0.78).setInteractive();
    const panel = this.add
      .text(w / 2, h * 0.32, `Solved ${creator}'s puzzle!\n${this.moves} moves`, {
        fontFamily: 'Arial',
        fontSize: '22px',
        color: COLORS.text,
        align: 'center',
        lineSpacing: 8,
      })
      .setOrigin(0.5);
    const voteButton = this.add
      .text(w / 2, h * 0.54, 'Upvote this puzzle', {
        fontFamily: 'Arial',
        fontSize: '18px',
        color: '#062033',
        backgroundColor: '#aef0d2',
        padding: { left: 16, right: 16, top: 10, bottom: 10 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    voteButton.on('pointerdown', () => void this.upvoteCurrent(voteButton));
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
    dailyButton.on('pointerdown', () => this.scene.start('GameScene'));
    this.fxLayer.add([overlay, panel, voteButton, moreButton, dailyButton]);
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
      button.setText(data.ok ? `Upvoted! (${data.votes})` : 'Already upvoted');
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
      this.scene.start('GameScene', {
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
    buildBtn.on('pointerdown', () => this.scene.start('EditorScene'));
    const dailyBtn = this.add
      .text(w / 2, h * 0.68, 'Back to daily', { fontFamily: 'Arial', fontSize: '16px', color: COLORS.text })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    dailyBtn.on('pointerdown', () => this.scene.start('GameScene'));
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
