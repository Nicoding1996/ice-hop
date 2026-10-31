import type { Move, PieceKind } from '../shared/game/types';
import { MAX_REPLAY_MOVES } from '../shared/game/replay';

const STORAGE_KEY_PREFIX = 'icehop.daily.handoff.v2';
const STORAGE_VERSION = 2;
const MAX_AGE_MS = 15 * 60 * 1000;
const CLOCK_SKEW_MS = 5_000;
const MAX_ID_LENGTH = 512;
const MAX_POST_ID_LENGTH = 200;
const MAX_CELL_INDEX = 399;

export type DailyHandoffAuth = 'guest' | 'signed';

export type DailyHandoff = {
  readonly version: 2;
  readonly auth: DailyHandoffAuth;
  readonly postId: string;
  readonly puzzleId: string;
  readonly playId: string;
  readonly moves: readonly Move[];
  readonly savedAt: number;
};

export type DailyHandoffInput = {
  readonly auth: DailyHandoffAuth;
  readonly postId: string;
  readonly puzzleId: string;
  readonly playId: string;
  readonly moves: readonly Move[];
};

export type DailyHandoffMatch = {
  readonly auth: DailyHandoffAuth;
  readonly postId: string;
  readonly puzzleId: string;
  /** Signed plays must match; guest init deliberately issues a fresh token. */
  readonly playId?: string;
};

const storageKey = (postId: string, puzzleId: string): string =>
  `${STORAGE_KEY_PREFIX}:${encodeURIComponent(postId)}:${encodeURIComponent(puzzleId)}`;

const property = (value: object, key: string): unknown => Reflect.get(value, key);
const isObject = (value: unknown): value is object =>
  typeof value === 'object' && value !== null;

const readKind = (value: unknown): PieceKind | null => {
  if (value === 'HOPPER' || value === 'SLIDER' || value === 'BLOCKER') return value;
  return null;
};

const readAuth = (value: unknown): DailyHandoffAuth | null =>
  value === 'guest' || value === 'signed' ? value : null;

const readString = (value: unknown, maxLength: number): string | null =>
  typeof value === 'string' && value.length > 0 && value.length <= maxLength
    ? value
    : null;

const parseMove = (value: unknown): Move | null => {
  if (!isObject(value)) return null;
  const pieceIndex = property(value, 'pieceIndex');
  const kind = readKind(property(value, 'kind'));
  const toValue = property(value, 'to');
  if (
    typeof pieceIndex !== 'number' ||
    !Number.isSafeInteger(pieceIndex) ||
    pieceIndex < 0 ||
    pieceIndex > MAX_CELL_INDEX ||
    !kind ||
    !Array.isArray(toValue) ||
    toValue.length < 1 ||
    toValue.length > 2
  ) {
    return null;
  }

  const to: number[] = [];
  let previous = -1;
  for (const rawCell of toValue) {
    const cell: unknown = rawCell;
    if (
      typeof cell !== 'number' ||
      !Number.isSafeInteger(cell) ||
      cell < 0 ||
      cell > MAX_CELL_INDEX ||
      cell <= previous
    ) {
      return null;
    }
    to.push(cell);
    previous = cell;
  }
  return { pieceIndex, kind, to };
};

const parseStoredHandoff = (raw: string): DailyHandoff | null => {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isObject(value)) return null;
    const keys = Object.keys(value).sort();
    const expectedKeys = [
      'auth',
      'moves',
      'playId',
      'postId',
      'puzzleId',
      'savedAt',
      'version',
    ];
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key, index) => key !== expectedKeys[index])
    ) {
      return null;
    }

    const version = property(value, 'version');
    const auth = readAuth(property(value, 'auth'));
    const postId = readString(property(value, 'postId'), MAX_POST_ID_LENGTH);
    const puzzleId = readString(property(value, 'puzzleId'), MAX_ID_LENGTH);
    const playId = readString(property(value, 'playId'), MAX_ID_LENGTH);
    const movesValue = property(value, 'moves');
    const savedAt = property(value, 'savedAt');
    const now = Date.now();
    if (
      version !== STORAGE_VERSION ||
      !auth ||
      !postId ||
      !puzzleId ||
      !playId ||
      !Array.isArray(movesValue) ||
      movesValue.length > MAX_REPLAY_MOVES ||
      typeof savedAt !== 'number' ||
      !Number.isSafeInteger(savedAt) ||
      savedAt < 0 ||
      savedAt > now + CLOCK_SKEW_MS ||
      now - savedAt > MAX_AGE_MS
    ) {
      return null;
    }

    const moves: Move[] = [];
    for (const rawMove of movesValue) {
      const move = parseMove(rawMove);
      if (!move) return null;
      moves.push({ pieceIndex: move.pieceIndex, kind: move.kind, to: [...move.to] });
    }

    return {
      version: 2,
      auth,
      postId,
      puzzleId,
      playId,
      moves,
      savedAt,
    };
  } catch {
    return null;
  }
};

/** Save only the bounded canonical transcript needed to continue in Phaser. */
export const saveDailyHandoff = (input: DailyHandoffInput): boolean => {
  if (
    (input.auth !== 'guest' && input.auth !== 'signed') ||
    input.postId.length < 1 ||
    input.postId.length > MAX_POST_ID_LENGTH ||
    input.puzzleId.length < 1 ||
    input.puzzleId.length > MAX_ID_LENGTH ||
    input.playId.length < 1 ||
    input.playId.length > MAX_ID_LENGTH ||
    input.moves.length > MAX_REPLAY_MOVES
  ) {
    return false;
  }

  const payload: DailyHandoff = {
    version: 2,
    auth: input.auth,
    postId: input.postId,
    puzzleId: input.puzzleId,
    playId: input.playId,
    moves: input.moves.map((move) => ({
      pieceIndex: move.pieceIndex,
      kind: move.kind,
      to: [...move.to],
    })),
    savedAt: Date.now(),
  };

  try {
    // sessionStorage is scoped to the current Reddit tab. Keying by immutable
    // post + puzzle identity also prevents two feed cards from overwriting one
    // another before the expanded view consumes its own continuation.
    sessionStorage.setItem(
      storageKey(input.postId, input.puzzleId),
      JSON.stringify(payload)
    );
    return true;
  } catch {
    return false;
  }
};

/**
 * Whether this tab holds a live signed continuation for one exact post/puzzle,
 * without consuming it. A signed handoff carries an issued play, so that
 * player's Daily clock is already running.
 */
export const hasSignedDailyHandoff = (postId: string, puzzleId: string): boolean => {
  try {
    const raw = sessionStorage.getItem(storageKey(postId, puzzleId));
    const handoff = raw ? parseStoredHandoff(raw) : null;
    return (
      handoff !== null &&
      handoff.auth === 'signed' &&
      handoff.postId === postId &&
      handoff.puzzleId === puzzleId
    );
  } catch {
    return false;
  }
};

/** Remove this tab's continuation for one exact post/puzzle attempt. */
export const clearDailyHandoff = (
  postId: string,
  puzzleId: string
): void => {
  try {
    sessionStorage.removeItem(storageKey(postId, puzzleId));
  } catch {
    /* Storage is an optional continuation channel. */
  }
};

/**
 * Consume only the continuation requested by the authoritative Daily response.
 * Identity is checked before deletion, so an unrelated card cannot discard it.
 */
export const consumeDailyHandoff = (
  match: DailyHandoffMatch
): DailyHandoff | null => {
  const key = storageKey(match.postId, match.puzzleId);
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;

  const handoff = parseStoredHandoff(raw);
  if (
    !handoff ||
    handoff.auth !== match.auth ||
    handoff.postId !== match.postId ||
    handoff.puzzleId !== match.puzzleId ||
    (match.auth === 'guest' && !handoff.playId.startsWith('v1.')) ||
    (match.auth === 'signed' &&
      (!match.playId || handoff.playId !== match.playId))
  ) {
    clearDailyHandoff(match.postId, match.puzzleId);
    return null;
  }

  clearDailyHandoff(match.postId, match.puzzleId);
  return handoff;
};
