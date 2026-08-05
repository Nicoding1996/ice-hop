import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { redis } from '@devvit/web/server';
import type {
  EndlessSolveResponse,
  EndlessTier,
  MarkPlayedResponse,
} from '../../shared/api';
import { dailyPuzzleId, type DailyPuzzleRef } from '../../shared/daily';
import { replayMoves, verifySolvedTranscript } from '../../shared/game/replay';
import type { Board, Move } from '../../shared/game/types';
import { validateBoardStructure } from '../../shared/game/validation';
import { todayUtc } from '../../shared/date';
import { solve } from '../../shared/solver/solver';
import { syncAchievements } from './achievements';
import { getEndlessStats } from './endless';
import { keys } from './keys';
import { trackEndlessCompleted, trackTelemetry } from './telemetry';

const ENDLESS_ISSUE_TTL_SECONDS = 60 * 60 * 48;
const ENDLESS_RESOLUTION_TTL_SECONDS = 60 * 60 * 72;
const DAILY_PLAY_TTL_SECONDS = 60 * 60 * 24 * 8;
const TRANSACTION_ATTEMPTS = 8;

const property = (value: object, key: string): unknown => Reflect.get(value, key);
const isObject = (value: unknown): value is object =>
  typeof value === 'object' && value !== null;
// Devvit 0.12.24 can omit boolean transaction replies from TxClient.exec().
// Authoritative transactions therefore queue at least one non-boolean write;
// a non-empty result distinguishes a commit from a WATCH abort without relying
// on the SDK's incomplete result cardinality.
const transactionCommitted = (result: unknown, _queuedResults: number): boolean =>
  Array.isArray(result) && result.length > 0;

const readTier = (value: unknown): EndlessTier | null => {
  if (value === 'easy' || value === 'medium' || value === 'hard') return value;
  return null;
};

type DailyPlay = {
  readonly playId: string;
  readonly puzzleId: string;
  readonly startedAt: number;
};

const parseDailyPlay = (raw: string | undefined): DailyPlay | null => {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isObject(value)) return null;
    const playId = property(value, 'playId');
    const puzzleId = property(value, 'puzzleId');
    const startedAt = property(value, 'startedAt');
    if (
      typeof playId !== 'string' ||
      !playId ||
      playId.length > 100 ||
      typeof puzzleId !== 'string' ||
      typeof startedAt !== 'number' ||
      !Number.isSafeInteger(startedAt) ||
      startedAt < 0
    ) {
      return null;
    }
    return { playId, puzzleId, startedAt };
  } catch {
    return null;
  }
};

const GUEST_DAILY_TOKEN_VERSION = 'v1';

const getGuestDailySigningSecret = async (): Promise<string> => {
  const key = keys.dailyGuestSecrets();
  const existing = await redis.hGet(key, GUEST_DAILY_TOKEN_VERSION);
  if (existing) return existing;
  const candidate = randomBytes(32).toString('base64url');
  const added = await redis.hSetNX(key, GUEST_DAILY_TOKEN_VERSION, candidate);
  if (added) return candidate;
  const winner = await redis.hGet(key, GUEST_DAILY_TOKEN_VERSION);
  if (!winner) throw new Error('Guest Daily signing secret is unavailable.');
  return winner;
};

const issueGuestDailyToken = async (play: DailyPlay): Promise<string> => {
  const secret = await getGuestDailySigningSecret();
  const payload = Buffer.from(
    `${play.puzzleId}\n${play.startedAt}\n${play.playId}`,
    'utf8'
  ).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${GUEST_DAILY_TOKEN_VERSION}.${payload}.${signature}`;
};

const parseGuestDailyToken = async (token: string): Promise<DailyPlay | null> => {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== GUEST_DAILY_TOKEN_VERSION) return null;
  const payload = parts[1];
  const suppliedSignature = parts[2];
  const secret = await getGuestDailySigningSecret();
  const expectedSignature = createHmac('sha256', secret).update(payload).digest('base64url');
  const supplied = Buffer.from(suppliedSignature, 'utf8');
  const expected = Buffer.from(expectedSignature, 'utf8');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;

  try {
    const decoded = Buffer.from(payload, 'base64url').toString('utf8').split('\n');
    if (decoded.length !== 3) return null;
    const startedAt = Number(decoded[1]);
    const play: DailyPlay = {
      puzzleId: decoded[0],
      startedAt,
      playId: decoded[2],
    };
    if (
      !play.puzzleId ||
      !play.playId ||
      play.playId.length > 100 ||
      !Number.isSafeInteger(play.startedAt) ||
      play.startedAt < 0
    ) {
      return null;
    }
    return play;
  } catch {
    return null;
  }
};

/** Bind one non-resettable server clock before disclosing a Daily board. */
export const issueDailyPlay = async (user: string, ref: DailyPuzzleRef): Promise<string> => {
  const candidate: DailyPlay = {
    playId: randomUUID(),
    puzzleId: dailyPuzzleId(ref),
    startedAt: Date.now(),
  };

  // Guests receive a signed, puzzle-bound bearer capability. Only one random
  // server secret is stored, so anonymous reloads cannot grow Redis cardinality.
  if (user === 'anon') return issueGuestDailyToken(candidate);

  const key = keys.dailyPlay(ref, user);
  for (let attempt = 0; attempt < TRANSACTION_ATTEMPTS; attempt++) {
    const transaction = await redis.watch(key);
    const existingRaw = await redis.hGet(key, 'play');
    if (existingRaw) {
      await transaction.unwatch();
      const existing = parseDailyPlay(existingRaw);
      if (!existing || existing.puzzleId !== dailyPuzzleId(ref)) {
        throw new Error('Daily play record is invalid.');
      }
      return existing.playId;
    }

    await transaction.multi();
    await transaction.hSet(key, { play: JSON.stringify(candidate) });
    await transaction.expire(key, DAILY_PLAY_TTL_SECONDS);
    const result: unknown = await transaction.exec();
    if (!transactionCommitted(result, 2)) continue;

    const winner = parseDailyPlay(await redis.hGet(key, 'play'));
    if (!winner || winner.puzzleId !== dailyPuzzleId(ref)) {
      throw new Error('Daily play record was not saved.');
    }
    return winner.playId;
  }
  throw new Error('Daily play clock was too busy to issue.');
};

/** Return trusted elapsed milliseconds for the puzzle's original disclosure. */
export const getDailyElapsed = async (
  user: string,
  playId: string,
  expectedRef: DailyPuzzleRef
): Promise<number | null> => {
  if (!playId || playId.length > 512) return null;
  const play =
    user === 'anon'
      ? await parseGuestDailyToken(playId)
      : parseDailyPlay(await redis.hGet(keys.dailyPlay(expectedRef, user), 'play'));
  const now = Date.now();
  if (
    !play ||
    (user !== 'anon' && play.playId !== playId) ||
    play.puzzleId !== dailyPuzzleId(expectedRef) ||
    play.startedAt > now ||
    now - play.startedAt > DAILY_PLAY_TTL_SECONDS * 1000
  ) {
    return null;
  }
  return Math.max(0, now - play.startedAt);
};

export const MAX_OUTSTANDING_ENDLESS_ISSUES = 16;
const ENDLESS_ACTIVE_ISSUE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

type EndlessReservation = {
  readonly kind: 'reserved';
  readonly date: string;
  readonly issuedAt: number;
};

type EndlessIssue = {
  readonly kind: 'issued';
  readonly tier: EndlessTier;
  readonly board: Board;
  readonly par: number;
  readonly date: string;
  readonly issuedAt: number;
};

type EndlessRecord = EndlessReservation | EndlessIssue;

const readIssueTimestamp = (value: object): number | null => {
  const issuedAtValue = property(value, 'issuedAt');
  if (
    typeof issuedAtValue === 'number' &&
    Number.isSafeInteger(issuedAtValue) &&
    issuedAtValue >= 0
  ) {
    return issuedAtValue;
  }
  return issuedAtValue === undefined ? 0 : null;
};

const parseEndlessIssue = (raw: string): EndlessIssue | null => {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isObject(value)) return null;
    const kind = property(value, 'kind');
    const tier = readTier(property(value, 'tier'));
    const parValue = property(value, 'par');
    const dateValue = property(value, 'date');
    const issuedAt = readIssueTimestamp(value);
    const structure = validateBoardStructure(property(value, 'board'));
    if (
      (kind !== undefined && kind !== 'issued') ||
      !tier ||
      typeof parValue !== 'number' ||
      !Number.isSafeInteger(parValue) ||
      parValue < 1 ||
      typeof dateValue !== 'string' ||
      issuedAt === null ||
      !structure.ok
    ) {
      return null;
    }
    return {
      kind: 'issued',
      tier,
      board: structure.board,
      par: parValue,
      date: dateValue,
      issuedAt,
    };
  } catch {
    return null;
  }
};

const parseEndlessRecord = (raw: string): EndlessRecord | null => {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isObject(value)) return null;
    if (property(value, 'kind') !== 'reserved') return parseEndlessIssue(raw);
    const date = property(value, 'date');
    const issuedAt = readIssueTimestamp(value);
    return typeof date === 'string' && issuedAt !== null
      ? { kind: 'reserved', date, issuedAt }
      : null;
  } catch {
    return null;
  }
};

const readEndlessIssue = async (
  user: string,
  issueId: string
): Promise<{ readonly issue?: EndlessIssue; readonly reason?: string }> => {
  if (user === 'anon') return { reason: 'Sign in to save Endless progress.' };
  if (!issueId || issueId.length > 100) return { reason: 'Invalid puzzle issue.' };
  const raw =
    (await redis.hGet(keys.endlessIssues(user), issueId)) ??
    (await redis.get(keys.endlessIssue(user, issueId)));
  if (!raw) return { reason: 'This Endless puzzle has expired.' };
  const issue = parseEndlessIssue(raw);
  if (!issue) return { reason: 'This Endless puzzle is invalid.' };
  return { issue };
};

type ResolutionState = 'hinted' | 'completed' | 'legacy-completed';

type CompletionClaim = {
  readonly state: ResolutionState | null;
  readonly ledgerAdded: boolean;
};

const readResolution = (value: string | undefined): ResolutionState | null => {
  if (value === 'hinted' || value === 'completed') return value;
  // Older completion code used "1" after its counters had already advanced.
  if (value === '1') return 'legacy-completed';
  return null;
};

/**
 * Reject issue spam before the route consumes a pooled board. Resolved and
 * malformed fields are pruned only when the fixed cap is reached; active issue
 * records remain available for retries until their collection expires.
 */
export const ensureEndlessIssueCapacity = async (user: string): Promise<void> => {
  if (user === 'anon') return;
  const issueKey = keys.endlessIssues(user);
  if ((await redis.hLen(issueKey)) < MAX_OUTSTANDING_ENDLESS_ISSUES) return;

  const records = await redis.hGetAll(issueKey);
  const removable = await Promise.all(
    Object.entries(records).map(async ([issueId, raw]): Promise<string | null> => {
      const record = parseEndlessRecord(raw);
      if (!record) return issueId;
      if (Date.now() - record.issuedAt > ENDLESS_ACTIVE_ISSUE_MAX_AGE_MS) return issueId;
      if (record.kind === 'reserved') return null;
      const resolution = readResolution(
        await redis.hGet(keys.endlessResolutions(user, record.date), issueId)
      );
      return resolution ? issueId : null;
    })
  );
  const fields = removable.filter((field): field is string => field !== null);
  if (fields.length > 0) await redis.hDel(issueKey, fields);
  if ((await redis.hLen(issueKey)) >= MAX_OUTSTANDING_ENDLESS_ISSUES) {
    throw new Error('Too many unfinished Endless puzzles. Finish one or try again later.');
  }
};

/** Atomically reserve capacity before the route consumes or generates a board. */
export const reserveEndlessIssue = async (user: string): Promise<string> => {
  const issueId = randomUUID();
  if (user === 'anon') return issueId;

  await ensureEndlessIssueCapacity(user);
  const reservation: EndlessReservation = {
    kind: 'reserved',
    date: todayUtc(),
    issuedAt: Date.now(),
  };
  const key = keys.endlessIssues(user);
  for (let attempt = 0; attempt < TRANSACTION_ATTEMPTS; attempt++) {
    const transaction = await redis.watch(key);
    if ((await redis.hLen(key)) >= MAX_OUTSTANDING_ENDLESS_ISSUES) {
      await transaction.unwatch();
      throw new Error('Too many unfinished Endless puzzles. Finish one or try again later.');
    }
    await transaction.multi();
    await transaction.hSet(key, { [issueId]: JSON.stringify(reservation) });
    await transaction.expire(key, ENDLESS_ISSUE_TTL_SECONDS);
    const result: unknown = await transaction.exec();
    if (!transactionCommitted(result, 2)) continue;
    const winner = await redis.hGet(key, issueId);
    if (winner && parseEndlessRecord(winner)?.kind === 'reserved') return issueId;
  }
  throw new Error('Endless puzzle issue was too busy to reserve.');
};

/** Fill a previously reserved slot with the exact board disclosed to the user. */
export const finalizeEndlessIssue = async (
  user: string,
  issueId: string,
  tier: EndlessTier,
  board: Board,
  par: number
): Promise<void> => {
  if (user === 'anon') return;
  const key = keys.endlessIssues(user);
  for (let attempt = 0; attempt < TRANSACTION_ATTEMPTS; attempt++) {
    const transaction = await redis.watch(key);
    const raw = await redis.hGet(key, issueId);
    const record = raw ? parseEndlessRecord(raw) : null;
    if (!record || record.kind !== 'reserved') {
      await transaction.unwatch();
      throw new Error('Endless puzzle reservation was lost.');
    }
    const issue: EndlessIssue = {
      kind: 'issued',
      tier,
      board,
      par,
      date: record.date,
      issuedAt: record.issuedAt,
    };
    await transaction.multi();
    await transaction.hSet(key, { [issueId]: JSON.stringify(issue) });
    await transaction.expire(key, ENDLESS_ISSUE_TTL_SECONDS);
    const result: unknown = await transaction.exec();
    if (transactionCommitted(result, 2)) return;
  }
  throw new Error('Endless puzzle issue was too busy to save.');
};

/** Release an abandoned reservation/board; completion ledgers remain untouched. */
export const releaseEndlessIssue = async (user: string, issueId: string): Promise<void> => {
  if (user === 'anon' || !issueId || issueId.length > 100) return;
  await redis.hDel(keys.endlessIssues(user), [issueId]);
};

/** Convenience wrapper used by core callers and tests. */
export const issueEndlessPuzzle = async (
  user: string,
  tier: EndlessTier,
  board: Board,
  par: number
): Promise<string> => {
  const issueId = await reserveEndlessIssue(user);
  try {
    await finalizeEndlessIssue(user, issueId, tier, board, par);
    return issueId;
  } catch (error) {
    await releaseEndlessIssue(user, issueId);
    throw error;
  }
};

/** Atomically claim hint eligibility and its expiry. */
const claimHintResolution = async (
  user: string,
  issueId: string,
  issue: EndlessIssue
): Promise<ResolutionState | null> => {
  const key = keys.endlessResolutions(user, issue.date);
  for (let attempt = 0; attempt < TRANSACTION_ATTEMPTS; attempt++) {
    const transaction = await redis.watch(key);
    const raw = await redis.hGet(key, issueId);
    const state = readResolution(raw);
    if (raw && !state) {
      await transaction.unwatch();
      return null;
    }
    if (state) {
      await transaction.unwatch();
      return state;
    }

    await transaction.multi();
    await transaction.hSet(key, { [issueId]: 'hinted' });
    await transaction.expire(key, ENDLESS_RESOLUTION_TTL_SECONDS);
    const result: unknown = await transaction.exec();
    if (transactionCommitted(result, 2)) return 'hinted';
  }
  return null;
};

/** Atomically couple a completion resolution to its permanent tier ledger. */
const claimCompletionResolution = async (
  user: string,
  issueId: string,
  issue: EndlessIssue,
  ledgerValue: string,
  hardAtPar: boolean
): Promise<CompletionClaim> => {
  const resolutionKey = keys.endlessResolutions(user, issue.date);
  const ledgerKey = keys.endlessLedger(user, issue.tier);
  const metaKey = keys.endlessLedgerMeta(user);
  for (let attempt = 0; attempt < TRANSACTION_ATTEMPTS; attempt++) {
    const transaction = hardAtPar
      ? await redis.watch(resolutionKey, ledgerKey, metaKey)
      : await redis.watch(resolutionKey, ledgerKey);
    const [rawResolution, rawLedger, rawHardAtPar] = await Promise.all([
      redis.hGet(resolutionKey, issueId),
      redis.hGet(ledgerKey, issueId),
      hardAtPar ? redis.hGet(metaKey, 'hardAtPar') : Promise.resolve(undefined),
    ]);
    const state = readResolution(rawResolution);
    if (rawResolution && !state) {
      await transaction.unwatch();
      return { state: null, ledgerAdded: false };
    }
    if (state === 'hinted' || state === 'legacy-completed') {
      await transaction.unwatch();
      return { state, ledgerAdded: false };
    }
    if (state === 'completed' && rawLedger && (!hardAtPar || rawHardAtPar === '1')) {
      await transaction.unwatch();
      return { state, ledgerAdded: false };
    }

    await transaction.multi();
    let expectedResults = 1;
    if (!state) {
      await transaction.hSet(resolutionKey, { [issueId]: 'completed' });
      expectedResults += 1;
    }
    if (!rawLedger) {
      await transaction.hSet(ledgerKey, { [issueId]: ledgerValue });
      expectedResults += 1;
    }
    if (hardAtPar && rawHardAtPar !== '1') {
      await transaction.hSet(metaKey, { hardAtPar: '1' });
      expectedResults += 1;
    }
    await transaction.expire(resolutionKey, ENDLESS_RESOLUTION_TTL_SECONDS);
    const result: unknown = await transaction.exec();
    if (transactionCommitted(result, expectedResults)) {
      return { state: 'completed', ledgerAdded: !rawLedger };
    }
  }
  return { state: null, ledgerAdded: false };
};

export type EndlessHintResult =
  | { readonly ok: true; readonly move: Move }
  | { readonly ok: false; readonly reason: string };

/**
 * Replay the signed user's exact current state, atomically make this issue
 * ineligible for progression, then return the solver's best next move.
 */
export const getEndlessHint = async (
  user: string,
  issueId: string,
  transcript: unknown
): Promise<EndlessHintResult> => {
  const loaded = await readEndlessIssue(user, issueId);
  if (!loaded.issue) return { ok: false, reason: loaded.reason ?? 'Invalid puzzle issue.' };
  const issue = loaded.issue;

  const replay = replayMoves(issue.board, transcript);
  if (!replay.ok) return { ok: false, reason: replay.reason };
  if (replay.solved) return { ok: false, reason: 'This puzzle is already solved.' };

  const result = solve({ ...replay.board, pieces: replay.pieces }, { maxStates: 60_000 });
  const move = result.solution[0];
  if (!result.solvable || !move) {
    return { ok: false, reason: 'No solution remains from this position.' };
  }

  const resolution = await claimHintResolution(user, issueId, issue);
  if (resolution === 'completed' || resolution === 'legacy-completed') {
    return { ok: false, reason: 'This puzzle was already completed.' };
  }
  if (resolution !== 'hinted') {
    return { ok: false, reason: 'Could not reserve this hint. Please try again.' };
  }
  return { ok: true, move };
};

export type EndlessCompletionResult =
  | { readonly ok: true; readonly result: EndlessSolveResponse }
  | { readonly ok: false; readonly reason: string };

const completedEndlessTier = async (
  user: string,
  issueId: string
): Promise<EndlessTier | null> => {
  const tiers: readonly EndlessTier[] = ['easy', 'medium', 'hard'];
  const values = await Promise.all(
    tiers.map((tier) => redis.hGet(keys.endlessLedger(user, tier), issueId))
  );
  const index = values.findIndex((value) => Boolean(value));
  return index >= 0 ? tiers[index] : null;
};

const completedEndlessSnapshot = async (
  user: string
): Promise<EndlessSolveResponse> => {
  const counts = await getEndlessStats(user);
  const achievements = await syncAchievements(user, counts);
  return { ...counts, achievements, counted: false };
};

/**
 * Verify an issued Endless board and record it exactly once. The per-tier hash
 * is the authoritative completion ledger, so retries can reconstruct a response
 * even after the bounded issue collection has released the full board.
 */
export const completeEndlessPuzzle = async (
  user: string,
  issueId: string,
  transcript: unknown
): Promise<EndlessCompletionResult> => {
  const loaded = await readEndlessIssue(user, issueId);
  if (!loaded.issue) {
    if (user === 'anon') {
      return { ok: false, reason: loaded.reason ?? 'Invalid puzzle issue.' };
    }
    const completedTier = await completedEndlessTier(user, issueId);
    return completedTier
      ? { ok: true, result: await completedEndlessSnapshot(user) }
      : { ok: false, reason: loaded.reason ?? 'Invalid puzzle issue.' };
  }
  const issue = loaded.issue;

  const replay = verifySolvedTranscript(issue.board, transcript);
  if (!replay.ok) return { ok: false, reason: replay.reason };
  if (replay.moveCount < issue.par) return { ok: false, reason: 'Invalid move history.' };

  const atPar = replay.moveCount === issue.par;
  const ledgerValue = JSON.stringify({ completedAt: Date.now(), atPar });
  const resolution = await claimCompletionResolution(
    user,
    issueId,
    issue,
    ledgerValue,
    issue.tier === 'hard' && atPar
  );
  if (resolution.state === 'hinted') {
    return { ok: false, reason: 'A hinted puzzle does not count toward progression.' };
  }
  if (!resolution.state) {
    return { ok: false, reason: 'Could not verify this completion. Please try again.' };
  }

  // A legacy "1" resolution already advanced old counters and intentionally
  // remains outside the new ledger. New completed resolutions are committed
  // atomically with their permanent ledger and Hard-at-par evidence.
  const ledgerAdded = resolution.ledgerAdded;
  const counts = await getEndlessStats(user);
  const achievements = await syncAchievements(user, counts);
  if (ledgerAdded) await trackEndlessCompleted(issue.tier, atPar);

  // Full boards are no longer outstanding after all projections succeed. A lost
  // response remains retryable through the permanent user-bound ledger above.
  await Promise.all([
    redis.hDel(keys.endlessIssues(user), [issueId]),
    redis.del(keys.endlessIssue(user, issueId)),
  ]);
  return { ok: true, result: { ...counts, achievements, counted: ledgerAdded } };
};

export type CommunityCompletion = {
  readonly moves: number;
  readonly par: number;
};

const parseCommunityCompletion = (raw: string | undefined): CommunityCompletion | null => {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isObject(value)) return null;
    const moves = property(value, 'moves');
    const par = property(value, 'par');
    if (
      typeof moves !== 'number' ||
      !Number.isSafeInteger(moves) ||
      moves < 1 ||
      typeof par !== 'number' ||
      !Number.isSafeInteger(par) ||
      par < 1
    ) {
      return null;
    }
    return { moves, par };
  } catch {
    return null;
  }
};

type CommunityCandidate = CommunityCompletion & { readonly id: string };

const parseCommunityCandidate = (raw: string): CommunityCandidate | null => {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isObject(value)) return null;
    const id = property(value, 'id');
    const completion = parseCommunityCompletion(raw);
    return typeof id === 'string' && completion ? { id, ...completion } : null;
  } catch {
    return null;
  }
};

/** Derive the best verified community score from candidates plus legacy data. */
export const getBestCommunityCompletion = async (
  user: string,
  id: string
): Promise<CommunityCompletion | null> => {
  const [materializedRaw, rows] = await Promise.all([
    redis.hGet(keys.ugcCompletions(user), id),
    redis.zRange(keys.ugcCompletionCandidates(user, id), 0, -1, { by: 'rank' }),
  ]);
  let best = parseCommunityCompletion(materializedRaw);
  for (const row of rows) {
    const candidate = parseCommunityCandidate(row.member);
    if (!candidate) continue;
    if (!best || candidate.moves < best.moves) {
      best = { moves: candidate.moves, par: candidate.par };
    }
  }
  return best;
};

const compactCommunityCompletion = async (
  user: string,
  id: string
): Promise<CommunityCompletion> => {
  const candidateKey = keys.ugcCompletionCandidates(user, id);
  const materializedKey = keys.ugcCompletions(user);
  for (let attempt = 0; attempt < TRANSACTION_ATTEMPTS; attempt++) {
    const transaction = await redis.watch(candidateKey);
    const rows = await redis.zRange(candidateKey, 0, -1, { by: 'rank' });
    let best: CommunityCompletion | null = null;
    const remove: string[] = [];
    for (const row of rows) {
      const candidate = parseCommunityCandidate(row.member);
      if (!candidate) {
        remove.push(row.member);
      } else if (!best) {
        best = { moves: candidate.moves, par: candidate.par };
      } else {
        remove.push(row.member);
      }
    }
    if (!best) {
      await transaction.unwatch();
      throw new Error('Verified community completion candidate is missing.');
    }

    await transaction.multi();
    let expectedResults = 1;
    if (remove.length > 0) {
      await transaction.zRem(candidateKey, remove);
      expectedResults += 1;
    }
    await transaction.hSet(materializedKey, { [id]: JSON.stringify(best) });
    const result: unknown = await transaction.exec();
    if (transactionCommitted(result, expectedResults)) return best;
  }
  throw new Error('Community best score was too busy to publish.');
};

type CommunitySubmission = {
  readonly id: string;
  readonly creator: string;
  readonly board: Board;
  readonly par: number;
};

const parseCommunitySubmission = (raw: string, expectedId: string): CommunitySubmission | null => {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isObject(value)) return null;
    const id = property(value, 'id');
    const creator = property(value, 'creator');
    const parValue = property(value, 'par');
    const structure = validateBoardStructure(property(value, 'board'));
    if (
      id !== expectedId ||
      typeof creator !== 'string' ||
      typeof parValue !== 'number' ||
      !Number.isSafeInteger(parValue) ||
      parValue < 1 ||
      !structure.ok
    ) {
      return null;
    }
    return { id, creator, board: structure.board, par: parValue };
  } catch {
    return null;
  }
};

const recordCommunityEvidence = async (
  user: string,
  id: string,
  creator: string,
  candidate: CommunityCandidate,
  existing: CommunityCompletion | null
): Promise<boolean> => {
  const candidateKey = keys.ugcCompletionCandidates(user, id);
  const playedKey = keys.ugcPlayed(user);
  const creditKey = keys.ugcSolveCredits(id);
  for (let attempt = 0; attempt < TRANSACTION_ATTEMPTS; attempt++) {
    const transaction = await redis.watch(candidateKey, playedKey, creditKey);
    const [playedScore, credited] = await Promise.all([
      redis.zScore(playedKey, id),
      redis.hGet(creditKey, user),
    ]);
    const firstSolve = typeof playedScore !== 'number';
    const needsCreditMarker = creator !== user && !credited;

    await transaction.multi();
    let expectedResults = 1;
    if (existing) {
      await transaction.zAdd(candidateKey, {
        member: JSON.stringify({ id: 'carry', ...existing }),
        score: existing.moves,
      });
      expectedResults += 1;
    }
    await transaction.zAdd(candidateKey, {
      member: JSON.stringify(candidate),
      score: candidate.moves,
    });
    if (firstSolve) {
      await transaction.zAdd(playedKey, { member: id, score: Date.now() });
      expectedResults += 1;
    }
    if (needsCreditMarker) {
      await transaction.hSet(creditKey, { [user]: '1' });
      expectedResults += 1;
      // A pre-ledger played row was normally already reflected in ugcSolves.
      // Seed only its migration marker; increment solely with a new played claim.
      if (firstSolve) {
        await transaction.hIncrBy(keys.ugcSolves(), id, 1);
        expectedResults += 1;
      }
    }
    const result: unknown = await transaction.exec();
    if (transactionCommitted(result, expectedResults)) return firstSolve;
  }
  throw new Error('Community completion was too busy to save.');
};

/** Verify a community solve and atomically persist proof, played, and credit evidence. */
export const completeCommunityPuzzle = async (
  user: string,
  id: string,
  transcript: unknown
): Promise<MarkPlayedResponse> => {
  if (!id || id.length > 64) {
    return { ok: false, saved: false, reason: 'Invalid puzzle id.' };
  }
  const raw = await redis.get(keys.ugcSubmission(id));
  if (!raw) return { ok: false, saved: false, reason: 'Puzzle not found.' };
  const submission = parseCommunitySubmission(raw, id);
  if (!submission) return { ok: false, saved: false, reason: 'Puzzle data is invalid.' };

  const replay = verifySolvedTranscript(submission.board, transcript);
  if (!replay.ok) return { ok: false, saved: false, reason: replay.reason };
  if (replay.moveCount < submission.par) {
    return { ok: false, saved: false, reason: 'Invalid move history.' };
  }
  if (user === 'anon') return { ok: true, saved: false, firstSolve: false };

  const existing = await getBestCommunityCompletion(user, id);
  const candidate: CommunityCandidate = {
    id: randomUUID(),
    moves: replay.moveCount,
    par: submission.par,
  };
  const firstSolve = await recordCommunityEvidence(
    user,
    id,
    submission.creator,
    candidate,
    existing
  );

  // Materialization is a compact projection of the durable candidates. If it
  // exhausts its contention retries, the verified candidate remains readable
  // and all first-solve effects have still committed together.
  try {
    await compactCommunityCompletion(user, id);
  } catch (error) {
    if (!(await getBestCommunityCompletion(user, id))) throw error;
    console.warn(`Community completion projection will repair on retry: ${error}`);
  }

  if (firstSolve) await trackTelemetry('community:completed');
  return { ok: true, saved: true, firstSolve };
};
