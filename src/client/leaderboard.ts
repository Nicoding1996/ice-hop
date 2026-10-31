import * as Phaser from 'phaser';
import { context, showLoginPrompt, showToast } from '@devvit/web/client';
import type {
  LeaderboardEntry,
  LeaderboardResponse,
  RankedBoardKind,
  RankedBoardResponse,
} from '../shared/api';
import { dailyPuzzleDate, formatPuzzleDate } from '../shared/date';
import {
  formatDuration,
  parseDailyLeaderboard,
  parseRankedBoard,
} from '../shared/leaderboard';
import { FONT, PALETTE, SPACE, armTap, makePanel, makePill, type PillButton } from './art/theme';

/**
 * Shared leaderboard overlay: the Daily board (today or yesterday, with the
 * move distribution and streak flames), this week's stars, current streaks,
 * and all-time days solved. Opened from the hub, the Daily win screen, and a
 * feed win card. A signed-in player can hide their name on comment boards.
 *
 * Returns the overlay container so the caller can guard against opening twice
 * and tear it down on resize. `onClose` fires after the dismiss animation.
 */
export type LeaderboardTab = 'daily' | RankedBoardKind;

export type LeaderboardOverlayOptions = {
  readonly tab?: LeaderboardTab;
  /** The Daily shown first. Omit for today's puzzle. */
  readonly puzzleId?: string;
  /** Without a puzzleId, show the host post's Daily instead of today's. */
  readonly hostPost?: boolean;
  /** Data the caller already fetched for `puzzleId`, to skip a round trip. */
  readonly preloaded?: LeaderboardResponse;
  /** Draw inside this container (e.g. a scaled win overlay) instead of the root. */
  readonly parent?: Phaser.GameObjects.Container;
  /** Layout size when drawing inside a scaled parent. */
  readonly width?: number;
  readonly height?: number;
  readonly onClose?: () => void;
};

type DailyView = 'primary' | 'yesterday';
type Loaded<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly empty: boolean };
type RankedRow = { readonly rank: number; readonly username: string };

const REQUEST_TIMEOUT_MS = 10_000;
const MEDAL_COLORS = [0xffd166, 0xd5e3ee, 0xd99a6c];
const ROW_FILL = 0x0e2740;
const BAR_FILL = 0x7fe0ff;

const TABS: readonly { readonly id: LeaderboardTab; readonly label: string }[] = [
  { id: 'daily', label: 'Daily' },
  { id: 'week', label: 'Week' },
  { id: 'streak', label: 'Streaks' },
  { id: 'alltime', label: 'All-time' },
];

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

const fetchJson = async (url: string): Promise<{ status: number; value: unknown }> => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const value: unknown = response.ok ? await response.json() : null;
    return { status: response.status, value };
  } finally {
    window.clearTimeout(timer);
  }
};

const loadDaily = async (
  view: DailyView,
  puzzleId: string | undefined,
  hostPost: boolean
): Promise<Loaded<LeaderboardResponse>> => {
  const url =
    view === 'yesterday'
      ? '/api/leaderboard?day=yesterday'
      : puzzleId
        ? `/api/leaderboard?puzzleId=${encodeURIComponent(puzzleId)}`
        : hostPost
          ? '/api/leaderboard?post=1'
          : '/api/leaderboard';
  try {
    const { status, value } = await fetchJson(url);
    if (status === 404) return { ok: false, empty: true };
    const data = parseDailyLeaderboard(value, {
      ...(view === 'primary' && puzzleId ? { puzzleId } : {}),
      ...(context.username ? { viewer: context.username } : {}),
    });
    return data ? { ok: true, data } : { ok: false, empty: false };
  } catch {
    return { ok: false, empty: false };
  }
};

const loadRanked = async (kind: RankedBoardKind): Promise<Loaded<RankedBoardResponse>> => {
  try {
    const { status, value } = await fetchJson(`/api/leaderboard/board?kind=${kind}`);
    if (status !== 200) return { ok: false, empty: false };
    const data = parseRankedBoard(value, kind);
    return data ? { ok: true, data } : { ok: false, empty: false };
  } catch {
    return { ok: false, empty: false };
  }
};

/** Reuse one in-flight or finished load per key; failures are retried. */
const cachedLoad = <K, T>(
  cache: Map<K, Promise<Loaded<T>>>,
  key: K,
  load: () => Promise<Loaded<T>>
): Promise<Loaded<T>> => {
  const existing = cache.get(key);
  if (existing) return existing;
  const pending = load().then((result) => {
    if (!result.ok && !result.empty) cache.delete(key);
    return result;
  });
  cache.set(key, pending);
  return pending;
};

/** A small two-tone vector flame (streaks), matching the code-drawn art. */
const drawFlame = (g: Phaser.GameObjects.Graphics, x: number, y: number, size: number): void => {
  const flame = (scale: number, color: number): void => {
    const s = size * scale;
    g.fillStyle(color, 1);
    g.fillCircle(x, y + s * 0.22, s * 0.42);
    g.fillTriangle(x - s * 0.4, y + s * 0.12, x + s * 0.4, y + s * 0.12, x + s * 0.05, y - s * 0.62);
  };
  flame(1, PALETTE.accent);
  flame(0.55, PALETTE.gold);
};

/** Shorten a label with an ellipsis until it fits `maxWidth`. */
const fitText = (label: Phaser.GameObjects.Text, maxWidth: number): void => {
  const full = label.text;
  if (maxWidth <= 0) {
    label.setText('');
    return;
  }
  let length = full.length;
  while (length > 1 && label.width > maxWidth) {
    length -= 1;
    label.setText(`${full.slice(0, length)}\u2026`);
  }
};

export const showLeaderboard = (
  scene: Phaser.Scene,
  options: LeaderboardOverlayOptions = {}
): Phaser.GameObjects.Container => {
  const w = options.width ?? scene.scale.width;
  const h = options.height ?? scene.scale.height;
  const compact = h < 600;
  const rowH = compact ? 28 : 32;
  const signedIn = Boolean(context.username);

  const layer = scene.add.container(0, 0);
  if (options.parent) options.parent.add(layer);
  else layer.setDepth(1000);

  const text = (
    x: number,
    y: number,
    value: string,
    size: number,
    style: { readonly weight?: string; readonly color?: string; readonly display?: boolean } = {}
  ): Phaser.GameObjects.Text =>
    scene.add.text(x, y, value, {
      fontFamily: style.display ? FONT.display : FONT.ui,
      fontSize: `${size}px`,
      fontStyle: style.weight ?? '700',
      color: style.color ?? PALETTE.text,
    });

  // The dimmed backdrop dismisses on a completed tap; the card swallows taps
  // so tab and row taps never fall through to the screen underneath.
  const dim = scene.add.rectangle(w / 2, h / 2, w, h, 0x05131f, 0.86).setInteractive();
  const cardW = Math.min(420, w - SPACE.xl);
  const cardH = Math.min(680, h - SPACE.xl);
  const left = w / 2 - cardW / 2;
  const top = h / 2 - cardH / 2;
  const panel = makePanel(scene, cardW, cardH).setPosition(w / 2, h / 2);
  const cardShield = scene.add.zone(w / 2, h / 2, cardW, cardH).setInteractive();
  const title = text(w / 2, top + SPACE.lg, 'Leaderboards', compact ? 20 : 23, {
    display: true,
  }).setOrigin(0.5, 0);
  layer.add([dim, panel, cardShield, title]);

  let closed = false;
  layer.once('destroy', () => {
    closed = true;
  });
  const dismiss = (): void => {
    if (closed) return;
    closed = true;
    scene.tweens.add({
      targets: layer,
      alpha: 0,
      duration: 140,
      ease: 'Quad.easeIn',
      onComplete: () => {
        layer.destroy();
        options.onClose?.();
      },
    });
  };
  armTap(dim, { onTap: dismiss });

  // --- Tabs (scaled down as a row if a narrow card cannot fit them) ---
  let currentTab: LeaderboardTab = options.tab ?? 'daily';
  const tabRow = scene.add.container(w / 2, title.y + title.height + SPACE.md + 17);
  const tabButtons = new Map<LeaderboardTab, PillButton>();
  const tabGap = SPACE.xs + 2;
  let rowWidth = tabGap * (TABS.length - 1);
  for (const tab of TABS) {
    const button = makePill(scene, {
      label: tab.label,
      variant: 'chip',
      size: 'sm',
      onClick: () => selectTab(tab.id),
    });
    tabButtons.set(tab.id, button);
    tabRow.add(button);
    rowWidth += button.width;
  }
  let tabX = -rowWidth / 2;
  for (const button of tabButtons.values()) {
    button.setX(tabX + button.width / 2);
    tabX += button.width + tabGap;
  }
  const tabScale = Math.min(1, (cardW - SPACE.lg * 2) / rowWidth);
  tabRow.setScale(tabScale);
  layer.add(tabRow);
  const bodyTop = tabRow.y + 17 * tabScale + SPACE.sm;

  // --- Footer: Close, plus the name setting (signed in) or a sign-in offer ---
  const close = makePill(scene, {
    label: 'Close',
    variant: 'chip',
    size: 'sm',
    x: w / 2,
    onClick: () => dismiss(),
  });
  close.setY(top + cardH - SPACE.lg - close.height / 2);
  layer.add(close);
  let footerTop = close.y - close.height / 2 - SPACE.sm;

  let viewerHidden: boolean | undefined;
  let visibilityPending = false;
  let visibilityButton: PillButton | undefined;
  const refreshVisibility = (): void => {
    if (!visibilityButton) return;
    visibilityButton.setLabelText(
      viewerHidden === undefined
        ? 'Comment boards: \u2026'
        : viewerHidden
          ? 'Comment boards: name hidden'
          : 'Comment boards: name shown'
    );
    visibilityButton.setEnabled(viewerHidden !== undefined && !visibilityPending);
  };
  const toggleVisibility = async (): Promise<void> => {
    if (viewerHidden === undefined || visibilityPending) return;
    const hidden = !viewerHidden;
    visibilityPending = true;
    refreshVisibility();
    try {
      const response = await fetch('/api/leaderboard/visibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hidden }),
      });
      if (!response.ok) throw new Error(`visibility failed: ${response.status}`);
      viewerHidden = hidden;
      showToast(
        hidden
          ? 'Your name is hidden on live comment leaderboards.'
          : 'Your name shows on live comment leaderboards.'
      );
    } catch (error) {
      console.error(error);
      showToast('Could not update that setting. Try again.');
    } finally {
      visibilityPending = false;
      if (!closed) refreshVisibility();
    }
  };
  const noteVisibility = (hidden: boolean): void => {
    if (visibilityPending || viewerHidden === hidden) return;
    viewerHidden = hidden;
    refreshVisibility();
  };

  const footerAction = signedIn
    ? makePill(scene, {
        label: 'Comment boards: name shown',
        variant: 'ghost',
        size: 'sm',
        x: w / 2,
        onClick: () => void toggleVisibility(),
      })
    : makePill(scene, {
        // Guests can browse; joining the boards needs an account.
        label: 'Sign in to join',
        variant: 'ghost',
        size: 'sm',
        x: w / 2,
        onClick: () => showLoginPrompt(),
      });
  footerAction.setY(footerTop - footerAction.height / 2);
  footerTop = footerAction.y - footerAction.height / 2 - SPACE.sm;
  layer.add(footerAction);
  if (signedIn) {
    visibilityButton = footerAction;
    refreshVisibility();
  }

  // --- Body ---
  const bodyBottom = footerTop;
  const rowLeft = left + SPACE.lg;
  const rowW = cardW - SPACE.lg * 2;
  let body = scene.add.container(0, 0);
  layer.add(body);
  const resetBody = (): void => {
    body.destroy(true);
    body = scene.add.container(0, 0);
    layer.add(body);
  };

  const centeredNote = (y: number, value: string, alpha = 0.85): void => {
    body.add(
      text(w / 2, y, value, compact ? 13 : 14, { weight: '600' })
        .setOrigin(0.5, 0)
        .setAlign('center')
        .setWordWrapWidth(rowW)
        .setAlpha(alpha)
    );
  };

  /**
   * One ranked row. `streak` adds a flame and count beside a Daily score; the
   * Streaks board passes `flameOnly`, since its value already is the streak.
   */
  const addRow = (
    y: number,
    rank: number,
    name: string,
    value: string,
    isViewer: boolean,
    streak = 0,
    flameOnly = false
  ): void => {
    const cy = y + rowH / 2;
    const background = scene.add.graphics();
    background.fillStyle(isViewer ? PALETTE.gold : ROW_FILL, isViewer ? 0.16 : 0.72);
    background.fillRoundedRect(rowLeft, y + 2, rowW, rowH - 4, 10);
    if (isViewer) {
      background.lineStyle(1.5, PALETTE.gold, 0.9);
      background.strokeRoundedRect(rowLeft, y + 2, rowW, rowH - 4, 10);
    }
    body.add(background);

    const badgeX = rowLeft + 18;
    const medal = MEDAL_COLORS[rank - 1];
    if (medal !== undefined) {
      const disc = scene.add.graphics();
      disc.fillStyle(medal, 1);
      disc.fillCircle(badgeX, cy, compact ? 9 : 10);
      body.add(disc);
    }
    body.add(
      text(badgeX, cy, String(rank), compact ? 11 : 12, {
        weight: '800',
        color: medal !== undefined ? PALETTE.textDark : PALETTE.text,
      }).setOrigin(0.5)
    );

    const valueText = text(rowLeft + rowW - SPACE.md, cy, value, compact ? 12 : 13, {
      weight: '800',
      color: isViewer ? PALETTE.arrow : PALETTE.text,
    }).setOrigin(1, 0.5);
    body.add(valueText);
    let nameRight = valueText.x - valueText.width - SPACE.sm;

    if (flameOnly) {
      const flame = scene.add.graphics();
      drawFlame(flame, nameRight - 5, cy, compact ? 11 : 12);
      body.add(flame);
      nameRight -= 16;
    } else if (streak >= 2) {
      const streakText = text(nameRight, cy, String(streak), compact ? 11 : 12, {
        weight: '800',
        color: PALETTE.arrow,
      }).setOrigin(1, 0.5);
      const flame = scene.add.graphics();
      drawFlame(flame, streakText.x - streakText.width - 7, cy, compact ? 11 : 12);
      body.add([flame, streakText]);
      nameRight = streakText.x - streakText.width - 16;
    }

    const nameText = text(rowLeft + 36, cy, isViewer ? 'You' : name, compact ? 13 : 14, {
      weight: isViewer ? '800' : '700',
    }).setOrigin(0, 0.5);
    fitText(nameText, nameRight - nameText.x);
    body.add(nameText);
  };

  /**
   * Rows from the top of a board. When the viewer ranks below what fits, the
   * last slots show an ellipsis and the viewer's own row instead.
   */
  const addRankedRows = <T extends RankedRow>(
    startY: number,
    rows: readonly T[],
    viewerRow: T | undefined,
    draw: (y: number, row: T) => void
  ): void => {
    const capacity = Math.max(0, Math.floor((bodyBottom - startY) / rowH));
    const viewerIndex = viewerRow
      ? rows.findIndex((row) => row.username === viewerRow.username)
      : -1;
    const pinViewer =
      viewerRow !== undefined && (viewerIndex < 0 || viewerIndex >= capacity) && capacity >= 3;
    const topCount = Math.min(rows.length, pinViewer ? capacity - 2 : capacity);
    let y = startY;
    for (const row of rows.slice(0, topCount)) {
      draw(y, row);
      y += rowH;
    }
    if (!pinViewer || !viewerRow) return;
    const lastShown = rows[topCount - 1];
    if (!lastShown || viewerRow.rank > lastShown.rank + 1) {
      body.add(
        text(w / 2, y + rowH / 2, '\u22EF', 16, { weight: '800' }).setOrigin(0.5).setAlpha(0.6)
      );
      y += rowH;
    }
    draw(y, viewerRow);
  };

  const renderError = (y: number): void => {
    centeredNote(y, 'Couldn\u2019t load the leaderboard.');
    body.add(
      makePill(scene, {
        label: 'Try again',
        variant: 'chip',
        size: 'sm',
        x: w / 2,
        y: y + 54,
        onClick: () => show(),
      })
    );
  };

  // --- Data ---
  const dailyCache = new Map<DailyView, Promise<Loaded<LeaderboardResponse>>>();
  const rankedCache = new Map<RankedBoardKind, Promise<Loaded<RankedBoardResponse>>>();
  const preloaded = options.preloaded;
  if (preloaded && options.puzzleId === preloaded.puzzleId) {
    dailyCache.set('primary', Promise.resolve({ ok: true, data: preloaded }));
  }
  const hostPost = options.hostPost ?? false;
  let dailyView: DailyView = 'primary';
  let primaryDate: string | undefined;
  let token = 0;

  const dayChips = (y: number): void => {
    const primaryLabel =
      primaryDate && primaryDate !== dailyPuzzleDate() ? formatPuzzleDate(primaryDate) : 'Today';
    const chip = (label: string, view: DailyView): PillButton =>
      makePill(scene, {
        label,
        variant: dailyView === view ? 'secondary' : 'ghost',
        size: 'sm',
        onClick: () => {
          if (dailyView === view) return;
          dailyView = view;
          show();
        },
      });
    const primary = chip(primaryLabel, 'primary');
    const yesterday = chip('Yesterday', 'yesterday');
    const total = primary.width + SPACE.sm + yesterday.width;
    primary.setPosition(w / 2 - total / 2 + primary.width / 2, y + primary.height / 2);
    yesterday.setPosition(w / 2 + total / 2 - yesterday.width / 2, y + yesterday.height / 2);
    body.add([primary, yesterday]);
  };

  const renderDaily = (result: Loaded<LeaderboardResponse> | null): void => {
    resetBody();
    if (result?.ok && dailyView === 'primary') primaryDate = result.data.date;
    dayChips(bodyTop);
    let y = bodyTop + 34 + SPACE.md;
    if (result === null) {
      centeredNote(y, 'Loading\u2026', 0.7);
      return;
    }
    if (!result.ok) {
      if (!result.empty) renderError(y);
      else {
        centeredNote(
          y,
          dailyView === 'yesterday'
            ? 'There was no Daily yesterday.'
            : 'Today\u2019s puzzle isn\u2019t up yet.'
        );
      }
      return;
    }

    const data = result.data;
    noteVisibility(data.viewerHidden);
    const header = text(
      w / 2,
      y,
      `${formatPuzzleDate(data.date, true)} \u00B7 par ${data.par}`,
      compact ? 14 : 15,
      { weight: '800' }
    ).setOrigin(0.5, 0);
    body.add(header);
    y += header.height + 2;
    const atPar = data.distribution[0]?.players ?? 0;
    const summary =
      data.totalPlayers === 0
        ? 'No solves yet. Be the first penguin in!'
        : data.viewerRank > 0
          ? `You're #${data.viewerRank} of ${data.totalPlayers} \u00B7 ${atPar} hit par`
          : `${plural(data.totalPlayers, 'player', 'players')} \u00B7 ${atPar} hit par`;
    const summaryText = text(w / 2, y, summary, compact ? 12 : 13, {
      weight: '700',
      color: PALETTE.arrow,
    }).setOrigin(0.5, 0);
    body.add(summaryText);
    y += summaryText.height + SPACE.sm;
    if (data.totalPlayers === 0) return;

    const viewerEntry =
      data.viewerRank > 0
        ? [...data.entries, ...data.nearbyEntries].find((entry) => entry.rank === data.viewerRank)
        : undefined;

    // Distribution bars, only while at least five rows still fit below them.
    const barH = compact ? 10 : 12;
    const barGap = compact ? 4 : 5;
    const chartH = data.distribution.length * (barH + barGap) + SPACE.sm;
    if (bodyBottom - y - chartH >= rowH * Math.min(5, data.entries.length + 1)) {
      const labelW = 52;
      const countW = 34;
      const barLeft = rowLeft + labelW;
      const barMax = rowW - labelW - countW;
      const max = Math.max(1, ...data.distribution.map((bucket) => bucket.players));
      const chart = scene.add.graphics();
      body.add(chart);
      data.distribution.forEach((bucket, index) => {
        const by = y + index * (barH + barGap);
        const cy = by + barH / 2;
        const label =
          bucket.moves === data.par
            ? `${bucket.moves} (par)`
            : `${bucket.moves}${bucket.orMore ? '+' : ''}`;
        body.add(
          text(rowLeft, cy, label, compact ? 10 : 11, { weight: '700' })
            .setOrigin(0, 0.5)
            .setAlpha(0.85)
        );
        const mine =
          viewerEntry !== undefined &&
          (bucket.orMore ? viewerEntry.moves >= bucket.moves : viewerEntry.moves === bucket.moves);
        const width = bucket.players > 0 ? Math.max(4, (barMax * bucket.players) / max) : 0;
        if (width > 0) {
          chart.fillStyle(mine ? PALETTE.gold : BAR_FILL, mine ? 0.95 : 0.7);
          chart.fillRoundedRect(barLeft, by, width, barH, Math.min(5, barH / 2));
        }
        body.add(
          text(barLeft + width + 6, cy, String(bucket.players), compact ? 10 : 11, {
            weight: '800',
            color: mine ? PALETTE.arrow : PALETTE.text,
          }).setOrigin(0, 0.5)
        );
      });
      y += chartH;
    }

    addRankedRows<LeaderboardEntry>(y, data.entries, viewerEntry, (rowY, entry) =>
      addRow(
        rowY,
        entry.rank,
        entry.username,
        `${plural(entry.moves, 'move', 'moves')} \u00B7 ${formatDuration(entry.timeMs)}`,
        signedIn && entry.username === context.username,
        entry.streak
      )
    );
  };

  const rankedTitle = (kind: RankedBoardKind, data: RankedBoardResponse): string => {
    if (kind === 'streak') return 'Current streaks';
    if (kind === 'alltime') return 'All-time';
    return data.periodStart && data.periodEnd
      ? `This week \u00B7 ${formatPuzzleDate(data.periodStart)} \u2013 ${formatPuzzleDate(data.periodEnd)}`
      : 'This week';
  };
  const RANKED_HINT: Record<RankedBoardKind, string> = {
    week: 'Best stars from each Daily, Monday to Sunday',
    streak: 'Days in a row with the Daily solved',
    alltime: 'Days with the Daily solved',
  };
  const rankedValue = (kind: RankedBoardKind, value: number): string =>
    kind === 'week' ? `${value} \u2605` : plural(value, 'day', 'days');

  const viewerLine = (kind: RankedBoardKind, data: RankedBoardResponse): string => {
    if (!signedIn) return 'Sign in to join the boards.';
    const viewer = data.viewer;
    if (kind === 'streak') {
      return viewer && viewer.value > 0
        ? `Your streak: ${plural(viewer.value, 'day', 'days')}`
        : 'No streak yet. Solve today\u2019s Daily to start one.';
    }
    if (!viewer) {
      return kind === 'week'
        ? 'Solve a Daily to join this week\u2019s board.'
        : 'Solve a Daily to get on the board.';
    }
    const total = data.totalPlayers ? ` of ${data.totalPlayers}` : '';
    return `You: #${viewer.rank}${total} \u00B7 ${rankedValue(kind, viewer.value)}`;
  };

  const renderRanked = (
    kind: RankedBoardKind,
    result: Loaded<RankedBoardResponse> | null
  ): void => {
    resetBody();
    let y = bodyTop + SPACE.xs;
    if (result === null) {
      centeredNote(y + 40, 'Loading\u2026', 0.7);
      return;
    }
    if (!result.ok) {
      renderError(y + 40);
      return;
    }
    const data = result.data;
    noteVisibility(data.viewerHidden);
    const header = text(w / 2, y, rankedTitle(kind, data), compact ? 14 : 15, {
      weight: '800',
    }).setOrigin(0.5, 0);
    body.add(header);
    y += header.height + 2;
    const hint = text(w / 2, y, RANKED_HINT[kind], compact ? 11 : 12, { weight: '600' })
      .setOrigin(0.5, 0)
      .setAlpha(0.7);
    body.add(hint);
    y += hint.height + SPACE.xs;
    const mine = text(w / 2, y, viewerLine(kind, data), compact ? 12 : 13, {
      weight: '700',
      color: PALETTE.arrow,
    }).setOrigin(0.5, 0);
    fitText(mine, rowW);
    body.add(mine);
    y += mine.height + SPACE.sm;

    if (data.entries.length === 0) {
      centeredNote(y + SPACE.md, 'Nobody here yet. Solve the Daily to be first!');
      return;
    }
    addRankedRows(y, data.entries, undefined, (rowY, entry) =>
      addRow(
        rowY,
        entry.rank,
        entry.username,
        rankedValue(kind, entry.value),
        signedIn && entry.username === context.username,
        0,
        kind === 'streak'
      )
    );
  };

  const show = (): void => {
    if (closed) return;
    token += 1;
    const current = token;
    for (const [id, button] of tabButtons) {
      button.setVariant(id === currentTab ? 'secondary' : 'chip');
    }
    if (currentTab === 'daily') {
      const view = dailyView;
      renderDaily(null);
      void cachedLoad(dailyCache, view, () => loadDaily(view, options.puzzleId, hostPost)).then(
        (result) => {
          if (!closed && current === token) renderDaily(result);
        }
      );
      return;
    }
    const kind = currentTab;
    renderRanked(kind, null);
    void cachedLoad(rankedCache, kind, () => loadRanked(kind)).then((result) => {
      if (!closed && current === token) renderRanked(kind, result);
    });
  };

  const selectTab = (tab: LeaderboardTab): void => {
    if (tab === currentTab) return;
    currentTab = tab;
    show();
  };

  show();
  layer.setAlpha(0);
  scene.tweens.add({ targets: layer, alpha: 1, duration: 160, ease: 'Quad.easeOut' });
  return layer;
};
