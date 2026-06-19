// Date helpers shared by client and server. The daily puzzle is keyed by the
// UTC date string and generated from a deterministic seed derived from it.

export const todayUtc = (now: Date = new Date()): string => now.toISOString().slice(0, 10); // YYYY-MM-DD

/** The UTC date string for the day before `date`. Used for streak continuity. */
export const previousDate = (date: string): string => {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/** Stable 31-bit seed from a YYYY-MM-DD string (FNV-1a). */
export const seedFromDate = (date: string): number => {
  let h = 2166136261;
  for (let i = 0; i < date.length; i++) {
    h ^= date.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 0x7fffffff;
};
