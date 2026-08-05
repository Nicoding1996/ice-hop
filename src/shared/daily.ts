export const CURRENT_DAILY_SCHEMA = 6;
export const LEGACY_DAILY_SCHEMA = 5;

export type DailyPuzzleRef = {
  readonly schema: typeof CURRENT_DAILY_SCHEMA | typeof LEGACY_DAILY_SCHEMA;
  readonly date: string;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const isDailyDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

export const currentDailyPuzzleRef = (date: string): DailyPuzzleRef => ({
  schema: CURRENT_DAILY_SCHEMA,
  date,
});

export const dailyPuzzleId = (ref: DailyPuzzleRef): string => `v${ref.schema}:${ref.date}`;

export const parseDailyPuzzleId = (value: unknown): DailyPuzzleRef | null => {
  if (typeof value !== 'string') return null;
  const separator = value.indexOf(':');
  if (separator < 0) return null;
  const version = value.slice(0, separator);
  const date = value.slice(separator + 1);
  if (!isDailyDate(date)) return null;
  if (version === `v${LEGACY_DAILY_SCHEMA}`) {
    return { schema: LEGACY_DAILY_SCHEMA, date };
  }
  if (version === `v${CURRENT_DAILY_SCHEMA}`) {
    return { schema: CURRENT_DAILY_SCHEMA, date };
  }
  return null;
};

/** Legacy post mappings stored only YYYY-MM-DD and always point at daily:5. */
export const parsePostDailyMapping = (value: unknown): DailyPuzzleRef | null => {
  if (isDailyDate(value)) return { schema: LEGACY_DAILY_SCHEMA, date: value };
  return parseDailyPuzzleId(value);
};

export const sameDailyPuzzle = (left: DailyPuzzleRef, right: DailyPuzzleRef): boolean =>
  left.schema === right.schema && left.date === right.date;
