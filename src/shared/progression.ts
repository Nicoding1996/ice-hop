export type GuestDailyCompletion = {
  readonly puzzleId: string;
  readonly moves: number;
  readonly stars: number;
};

const property = (value: object, key: string): unknown => Reflect.get(value, key);
const isObject = (value: unknown): value is object =>
  typeof value === 'object' && value !== null;

const parseGuestDailyCompletion = (value: unknown): GuestDailyCompletion | null => {
  if (!isObject(value)) return null;
  const puzzleId = property(value, 'puzzleId');
  const moves = property(value, 'moves');
  const stars = property(value, 'stars');
  if (
    typeof puzzleId !== 'string' ||
    !puzzleId ||
    typeof moves !== 'number' ||
    !Number.isSafeInteger(moves) ||
    moves < 1 ||
    typeof stars !== 'number' ||
    !Number.isSafeInteger(stars) ||
    stars < 1 ||
    stars > 3
  ) {
    return null;
  }
  return { puzzleId, moves, stars };
};

/** Read one verified guest Daily result from iframe-session registry data. */
export const guestDailyCompletionFor = (
  value: unknown,
  puzzleId: string
): GuestDailyCompletion | null => {
  if (!Array.isArray(value)) return null;
  for (const entry of value) {
    const completion = parseGuestDailyCompletion(entry);
    if (completion?.puzzleId === puzzleId) return completion;
  }
  return null;
};

/** Keep a small puzzle-keyed history for guest recaps within this iframe only. */
export const rememberGuestDailyCompletion = (
  value: unknown,
  completion: GuestDailyCompletion
): readonly GuestDailyCompletion[] => {
  const existing = Array.isArray(value)
    ? value
        .map(parseGuestDailyCompletion)
        .filter((entry): entry is GuestDailyCompletion => entry !== null)
    : [];
  return [completion, ...existing.filter((entry) => entry.puzzleId !== completion.puzzleId)].slice(
    0,
    8
  );
};

/** Server progression snapshots may arrive out of order; session totals never regress. */
export const mergeProgressCount = (knownValue: unknown, incoming: number): number => {
  const known =
    typeof knownValue === 'number' && Number.isSafeInteger(knownValue) && knownValue >= 0
      ? knownValue
      : 0;
  return Math.max(known, incoming);
};
