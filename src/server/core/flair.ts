// Player flair: the subreddit user flair Ice Hop keeps for each signed player.
//
// The text is one headline plus puzzles built: a Daily streak of 2+ days, else
// Dailies solved once there are two, else "Ice Hopper".
// - Ice Hop writes only over flair that shows Ice Hop text, or over an empty
//   flair it never wrote. Once a player or moderator changes or removes it, that
//   choice stays. Setting any Ice Hop text again hands the flair back.
// - The last text written is stored per player, so a refresh that would write
//   the same text makes no Reddit call.
// - Flair that shows a streak is indexed by the streak's newest solve date, and
//   a scheduler job rewrites it once the streak lapses at the 12:00 UTC rollover.
// - Moderators can turn player flair off with the `playerFlair` app setting.
//   Off stops every write; flair already set stays as it is.
import { context, reddit, redis, settings } from '@devvit/web/server';
import { dailyPuzzleDate, isStreakCurrent, previousDate } from '../../shared/date';
import { keys } from './keys';
import { getStreakRecords } from './leaderboard';

/** App setting (devvit.json `settings.subreddit`) that turns player flair on or off. */
const PLAYER_FLAIR_SETTING = 'playerFlair';
const FLAIR_BACKGROUND = '#1d6f9c';
/** Most lapsed-streak players one scheduler run re-checks; the next run continues. */
const MAX_LAPSED_PER_RUN = 30;
/** A run stops after this many failed refreshes: Reddit is probably unavailable. */
const MAX_FAILURES_PER_RUN = 3;
/** All-time board rows read per backfill page. */
const BACKFILL_PAGE = 200;
const BACKFILL_DONE = 'done';

const FIRE = '\uD83D\uDD25';
const PENGUIN = '\uD83D\uDC27';
const PUZZLE = '\uD83E\uDDE9';
const DOT = '\u00B7';

export type PlayerFlairStats = {
  /** Current Daily streak in days (0 once it lapsed). */
  readonly streak: number;
  /** Puzzle dates with the Daily solved: the All-time board value. */
  readonly dailies: number;
  /** Community puzzles the player has published. */
  readonly puzzles: number;
};

/** What one refresh did. */
export type FlairOutcome =
  /** Flair now shows the player's progress. */
  | 'written'
  /** Flair already showed it; no Reddit call. */
  | 'unchanged'
  /** A player or moderator chose this flair, so it was left alone. */
  | 'kept'
  /** The account no longer exists or is suspended. */
  | 'missing'
  /** Moderators turned player flair off (or the setting could not be read). */
  | 'disabled'
  /** A guest, or no subreddit context. */
  | 'skipped'
  /** Reddit or Redis failed; the next refresh tries again. */
  | 'failed';

type FlairRecord =
  | { readonly kind: 'shown'; readonly text: string }
  | { readonly kind: 'released'; readonly checked: string };

type FlairTarget = {
  readonly text: string;
  /** Newest solve date of the streak the text shows, or null when it shows none. */
  readonly streakDate: string | null;
};

/** The flair text for a player's progress (well under Reddit's 64 characters). */
export const playerFlairText = ({ streak, dailies, puzzles }: PlayerFlairStats): string => {
  const head =
    streak >= 2
      ? `${FIRE} ${streak}-day streak`
      : dailies >= 2
        ? `${PENGUIN} ${dailies} Dailies solved`
        : `${PENGUIN} Ice Hopper`;
  const maker =
    puzzles > 0 ? ` ${DOT} ${PUZZLE} ${puzzles} ${puzzles === 1 ? 'puzzle' : 'puzzles'}` : '';
  return `${head}${maker}`;
};

/** Every text this or an earlier version of Ice Hop wrote as player flair. */
const ICE_HOP_FLAIR = new RegExp(
  `^(?:${FIRE} \\d+-day streak|${PENGUIN} \\d+ Dailies solved|${PENGUIN} Ice Hopper)` +
    `(?: ${DOT} ${PUZZLE} \\d+ puzzles?)?$`,
  'u'
);

/** Whether `text` is flair Ice Hop writes, as opposed to one a person chose. */
export const isIceHopFlairText = (text: string): boolean => ICE_HOP_FLAIR.test(text.trim());

const property = (value: object, key: string): unknown => Reflect.get(value, key);
const isObject = (value: unknown): value is object =>
  typeof value === 'object' && value !== null;

const parseFlairRecord = (raw: string | null | undefined): FlairRecord | null => {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isObject(value)) return null;
    const shown = property(value, 'shown');
    if (typeof shown === 'string') return { kind: 'shown', text: shown };
    const released = property(value, 'released');
    return typeof released === 'string' ? { kind: 'released', checked: released } : null;
  } catch {
    return null;
  }
};

const recordJson = (record: FlairRecord): string =>
  JSON.stringify(
    record.kind === 'shown' ? { shown: record.text } : { released: record.checked }
  );

/**
 * Whether Ice Hop may write over `current`, the player's flair right now: flair
 * that shows Ice Hop text, or an empty flair Ice Hop never wrote. An empty flair
 * after Ice Hop wrote one means someone removed it, so it stays empty.
 */
const mayReplace = (current: string, record: FlairRecord | null): boolean =>
  isIceHopFlairText(current) || (current === '' && record === null);

/** Whether moderators left player flair on. A setting that can't be read counts as off. */
const playerFlairEnabled = async (): Promise<boolean> => {
  try {
    return (await settings.get(PLAYER_FLAIR_SETTING)) !== false;
  } catch (error) {
    console.warn(`Player flair setting unavailable: ${error}`);
    return false;
  }
};

const flairTarget = async (username: string): Promise<FlairTarget> => {
  const [records, allTime, puzzles] = await Promise.all([
    getStreakRecords([username]),
    redis.zScore(keys.allTimeLeaderboard(), username),
    redis.zCard(keys.ugcByCreator(username)),
  ]);
  const record = records[0];
  const streak =
    record && isStreakCurrent(record.lastDate, dailyPuzzleDate()) ? record.count : 0;
  const dailies =
    typeof allTime === 'number' && Number.isSafeInteger(allTime) && allTime > 0 ? allTime : 0;
  return {
    text: playerFlairText({ streak, dailies, puzzles }),
    streakDate: record && streak >= 2 ? record.lastDate : null,
  };
};

/** Streak index score for a streak whose newest solve is on `date`. */
const streakScore = (date: string): number => Date.parse(`${date}T00:00:00.000Z`);

const trackStreak = async (username: string, streakDate: string | null): Promise<void> => {
  if (streakDate) {
    await redis.zAdd(keys.playerFlairStreaks(), {
      member: username,
      score: streakScore(streakDate),
    });
  } else {
    await redis.zRem(keys.playerFlairStreaks(), [username]);
  }
};

/** The player's flair text here ('' for none), or null when the account is gone. */
const currentFlairText = async (
  subredditName: string,
  username: string
): Promise<string | null> => {
  const user = await reddit.getUserByUsername(username);
  if (!user) return null;
  const flair = await user.getUserFlairBySubreddit(subredditName);
  return flair?.flairText?.trim() ?? '';
};

const refreshFlair = async (
  subredditName: string,
  username: string,
  enabled: () => Promise<boolean>
): Promise<FlairOutcome> => {
  try {
    const [target, raw] = await Promise.all([
      flairTarget(username),
      redis.hGet(keys.playerFlair(), username),
    ]);
    const record = parseFlairRecord(raw);
    if (record?.kind === 'shown' && record.text === target.text) {
      await trackStreak(username, target.streakDate);
      return 'unchanged';
    }
    if (record?.kind === 'released' && record.checked === target.text) {
      await trackStreak(username, null);
      return 'kept';
    }
    if (!(await enabled())) return 'disabled';

    const current = await currentFlairText(subredditName, username);
    if (current === null) {
      await redis.hDel(keys.playerFlair(), [username]);
      await trackStreak(username, null);
      return 'missing';
    }
    if (!mayReplace(current, record)) {
      await redis.hSet(keys.playerFlair(), {
        [username]: recordJson({ kind: 'released', checked: target.text }),
      });
      await trackStreak(username, null);
      return 'kept';
    }
    const changed = current !== target.text;
    if (changed) {
      await reddit.setUserFlair({
        subredditName,
        username,
        text: target.text,
        backgroundColor: FLAIR_BACKGROUND,
        textColor: 'light',
      });
    }
    await redis.hSet(keys.playerFlair(), {
      [username]: recordJson({ kind: 'shown', text: target.text }),
    });
    await trackStreak(username, target.streakDate);
    return changed ? 'written' : 'unchanged';
  } catch (error) {
    console.error(`Player flair refresh failed for ${username}: ${error}`);
    return 'failed';
  }
};

/**
 * Bring a signed player's flair up to date after a Daily solve or a published
 * puzzle. Best-effort: it never throws, and a failure waits for the next refresh.
 */
export const refreshPlayerFlair = async (username: string): Promise<FlairOutcome> => {
  try {
    const subredditName = context.subredditName;
    if (!subredditName || username === 'anon') return 'skipped';
    return await refreshFlair(subredditName, username, playerFlairEnabled);
  } catch (error) {
    console.error(`Player flair refresh failed for ${username}: ${error}`);
    return 'failed';
  }
};

const parseCursor = (raw: string | undefined): number => {
  const offset = Number(raw);
  return Number.isSafeInteger(offset) && offset > 0 ? offset : 0;
};

/**
 * Seed the streak index once from the all-time board, so flair written before
 * the index existed is rewritten when its streak lapses. Pages run from the
 * most Dailies down: new players join at the bottom, so they never push an
 * unread row past the cursor, and anyone who moves up just solved, which
 * indexes them anyway. Players Ice Hop already tracks are skipped.
 */
const backfillStreakIndex = async (deadline: number): Promise<number> => {
  const cursorKey = keys.playerFlairBackfill();
  const cursor = await redis.get(cursorKey);
  if (cursor === BACKFILL_DONE) return 0;
  let offset = parseCursor(cursor);
  let indexed = 0;
  while (Date.now() < deadline) {
    const rows = await redis.zRange(
      keys.allTimeLeaderboard(),
      offset,
      offset + BACKFILL_PAGE - 1,
      { by: 'rank', reverse: true }
    );
    const usernames = rows.map((row) => row.member);
    if (usernames.length > 0) {
      const [records, tracked] = await Promise.all([
        getStreakRecords(usernames),
        redis.hMGet(keys.playerFlair(), usernames),
      ]);
      const entries = usernames.flatMap((member, index) => {
        const record = records[index];
        return record && record.count >= 2 && record.lastDate !== '' && !tracked[index]
          ? [{ member, score: streakScore(record.lastDate) }]
          : [];
      });
      if (entries.length > 0) await redis.zAdd(keys.playerFlairStreaks(), ...entries);
      indexed += entries.length;
    }
    offset += usernames.length;
    if (usernames.length < BACKFILL_PAGE) {
      await redis.set(cursorKey, BACKFILL_DONE);
      break;
    }
    await redis.set(cursorKey, String(offset));
  }
  return indexed;
};

export type FlairSweep = {
  /** Players the one-time backfill added to the streak index this run. */
  readonly backfilled: number;
  /** Players with a lapsed streak whose flair was re-checked. */
  readonly checked: number;
  /** Flairs rewritten. */
  readonly written: number;
};

/**
 * Scheduler job: re-check the flair of players whose streak lapsed, so no flair
 * keeps showing a streak the app no longer counts. Bounded per run; the next run
 * continues. While moderators have flair off, the index waits untouched.
 */
export const refreshLapsedFlair = async (budgetMs = 20_000): Promise<FlairSweep> => {
  const started = Date.now();
  const backfilled = await backfillStreakIndex(started + budgetMs / 4);
  const subredditName = context.subredditName;
  if (!subredditName) return { backfilled, checked: 0, written: 0 };

  // A streak stays current through the day after its newest solve, so a score
  // below yesterday's puzzle date belongs to a streak that has lapsed.
  const boundary = streakScore(previousDate(dailyPuzzleDate()));
  const lapsed = await redis.zRange(keys.playerFlairStreaks(), '-inf', boundary - 1, {
    by: 'score',
    limit: { offset: 0, count: MAX_LAPSED_PER_RUN },
  });
  if (lapsed.length === 0 || !(await playerFlairEnabled())) {
    return { backfilled, checked: 0, written: 0 };
  }

  const enabledThisRun = (): Promise<boolean> => Promise.resolve(true);
  let checked = 0;
  let written = 0;
  let failures = 0;
  for (const entry of lapsed) {
    if (Date.now() - started > budgetMs) break;
    checked += 1;
    const outcome = await refreshFlair(subredditName, entry.member, enabledThisRun);
    if (outcome === 'written') written += 1;
    if (outcome !== 'failed') continue;
    // Drop the entry so one broken account can't hold up the job. The player's
    // next Daily solve or published puzzle refreshes their flair anyway.
    await redis.zRem(keys.playerFlairStreaks(), [entry.member]);
    failures += 1;
    if (failures >= MAX_FAILURES_PER_RUN) break;
  }
  return { backfilled, checked, written };
};
