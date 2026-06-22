// Pure ordering for the community puzzle stream. No platform imports so it is
// unit-testable in isolation. The server fetches a candidate pool from Redis
// and hands it here to decide what each player sees and in what order.
import type { UgcSubmission } from './api';

export type StreamOptions = {
  /** Submission ids the player has already solved; excluded from their stream. */
  readonly playedIds?: ReadonlySet<string>;
  /** Hide a player's own puzzles from their stream. */
  readonly excludeCreator?: string;
  /** Maximum puzzles to return. */
  readonly limit?: number;
  /**
   * Extra "discovery" candidates (e.g. a random sample of the whole catalog)
   * woven in as a third lane. Without this, only the top-voted and newest
   * windows are ever shown, so older mid-tier puzzles get buried forever once
   * the catalog outgrows those windows. Consumed in the order given - the
   * caller supplies the randomness, so this function stays deterministic.
   */
  readonly discovery?: readonly UgcSubmission[];
};

/**
 * Order the stream by round-robin across three views of the unplayed pool: the
 * top-voted puzzles (proven favourites stay visible), the newest puzzles (fresh
 * submissions get exposure), and an optional discovery lane (resurfaced older
 * puzzles, so nothing is buried). Alternating between them gives every session
 * a mix instead of burying new or mid-tier puzzles behind the popular ones.
 */
export const orderCommunityStream = (
  subs: readonly UgcSubmission[],
  opts: StreamOptions = {}
): UgcSubmission[] => {
  const played = opts.playedIds ?? new Set<string>();
  const limit = opts.limit ?? 20;
  const keep = (s: UgcSubmission): boolean =>
    !played.has(s.id) && s.creator !== opts.excludeCreator;

  const pool = subs.filter(keep);
  const byVotes = [...pool].sort((a, b) => b.votes - a.votes || b.createdAt - a.createdAt);
  const byNew = [...pool].sort((a, b) => b.createdAt - a.createdAt);
  const discovery = (opts.discovery ?? []).filter(keep);

  const lanes: ReadonlyArray<readonly UgcSubmission[]> = [byVotes, byNew, discovery];
  const cursors = lanes.map(() => 0);
  const out: UgcSubmission[] = [];
  const seen = new Set<string>();
  let lane = 0;
  // Stop once we've cycled through every lane without placing anything new.
  let sinceProgress = 0;
  while (out.length < limit && sinceProgress < lanes.length) {
    const arr = lanes[lane];
    let c = cursors[lane];
    while (c < arr.length && seen.has(arr[c].id)) c++;
    cursors[lane] = c;
    if (c < arr.length) {
      out.push(arr[c]);
      seen.add(arr[c].id);
      cursors[lane] = c + 1;
      sinceProgress = 0;
    } else {
      sinceProgress++;
    }
    lane = (lane + 1) % lanes.length;
  }
  return out;
};

export type CreatorTotals = { readonly puzzles: number; readonly solves: number; readonly votes: number };

/**
 * Aggregate a creator's headline stats across their submissions - the totals
 * shown atop the "My puzzles" view. Pure so it can be unit-tested directly.
 */
export const creatorTotals = (subs: readonly UgcSubmission[]): CreatorTotals =>
  subs.reduce(
    (acc, s) => ({
      puzzles: acc.puzzles + 1,
      solves: acc.solves + s.solves,
      votes: acc.votes + s.votes,
    }),
    { puzzles: 0, solves: 0, votes: 0 }
  );
