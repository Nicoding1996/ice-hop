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
};

/**
 * Order the stream by interleaving two views of the unplayed pool: the
 * top-voted puzzles (proven favourites stay visible) and the newest puzzles
 * (fresh submissions get exposure). Alternating between them gives every
 * session a mix of both instead of burying new puzzles behind popular ones.
 */
export const orderCommunityStream = (
  subs: readonly UgcSubmission[],
  opts: StreamOptions = {}
): UgcSubmission[] => {
  const played = opts.playedIds ?? new Set<string>();
  const limit = opts.limit ?? 20;

  const pool = subs.filter((s) => !played.has(s.id) && s.creator !== opts.excludeCreator);
  const byVotes = [...pool].sort((a, b) => b.votes - a.votes || b.createdAt - a.createdAt);
  const byNew = [...pool].sort((a, b) => b.createdAt - a.createdAt);

  const out: UgcSubmission[] = [];
  const seen = new Set<string>();
  let i = 0;
  let j = 0;
  let pickVotes = true;
  while (out.length < limit && (i < byVotes.length || j < byNew.length)) {
    if (pickVotes) {
      while (i < byVotes.length && seen.has(byVotes[i].id)) i++;
      if (i < byVotes.length) {
        out.push(byVotes[i]);
        seen.add(byVotes[i].id);
        i++;
      }
    } else {
      while (j < byNew.length && seen.has(byNew[j].id)) j++;
      if (j < byNew.length) {
        out.push(byNew[j]);
        seen.add(byNew[j].id);
        j++;
      }
    }
    pickVotes = !pickVotes;
  }
  return out;
};
