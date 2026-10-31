// Puzzle-generation benchmark: `npm run bench:gen` (options below).
//
// Runs the production generators and reports, per difficulty:
// - Daily on demand: the request-path cascade used when no prepared puzzle
//   exists, by pass (designed / relaxed / fast / fallback);
// - Daily prepared: the week-ahead job's generator, with every earlier date's
//   puzzle excluded, as the job runs it;
// - Endless pool: the boards players are served, including repeats.
// Daily runs are seeded from the date so a run can be repeated.
// For every board it measures par, best solutions (different shortest
// solutions), and "3-star luck": the chance that random moves finish within
// par + 1 moves. Times are wall-clock on this machine.
//
// Options: --days N (Daily dates, default 28), --easy N --medium N --hard N
// (Endless boards per tier, defaults 300/150/60), --only daily|endless,
// --start YYYY-MM-DD (first Daily date, default 2026-10-01). PowerShell drops
// options passed through `npm run ... --`, so run the script directly there:
// `npx tsx tools/bench/generation.ts --only daily --days 56`.
import type { EndlessTier } from '../../src/shared/api';
import type { Board } from '../../src/shared/game/types';
import { addDays, seedFromDate } from '../../src/shared/date';
import { boardSignature } from '../../src/shared/game/board';
import { boardFingerprint, boardFingerprintId } from '../../src/shared/game/symmetry';
import { analyzeBoard } from '../../src/shared/solver/stateGraph';
import {
  dailyTierForDate,
  generateDailyOnDemand,
  generateDesignedDaily,
  type DailyPass,
  type DailyTier,
} from '../../src/server/core/dailyPolicy';
import { generateEndlessPoolPuzzle } from '../../src/server/core/endlessPolicy';

type Sample = {
  readonly ms: number;
  readonly par: number;
  readonly bestSolutions: number;
  readonly luck: number;
};

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && at + 1 < args.length ? (args[at + 1] ?? fallback) : fallback;
};
const count = (name: string, fallback: number): number => {
  const value = Number.parseInt(option(name, String(fallback)), 10);
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
};
const only = option('only', '');
const days = count('days', 28);
const start = option('start', '2026-10-01');

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
const fixed = (value: number, digits: number): string => value.toFixed(digits);
const percent = (value: number): string => `${fixed(value * 100, 1)}%`;

const measure = (board: Board, ms: number): Sample => {
  const analysis = analyzeBoard(board);
  if (!analysis) throw new Error('A generated board could not be analyzed.');
  return { ms, par: analysis.par, bestSolutions: analysis.bestSolutions, luck: analysis.threeStarLuck };
};

/** One summary line: time, par range, best solutions, 3-star luck. */
const summarize = (label: string, samples: readonly Sample[]): string => {
  if (samples.length === 0) return `${label}: no boards`;
  const ms = samples.map((sample) => sample.ms);
  const pars = samples.map((sample) => sample.par);
  const best = samples.map((sample) => sample.bestSolutions);
  const luck = samples.map((sample) => sample.luck);
  const unique = samples.filter((sample) => sample.bestSolutions === 1).length;
  return [
    `${label}: n=${samples.length}`,
    `time mean ${fixed(mean(ms), 0)}ms max ${Math.max(...ms)}ms`,
    `par ${Math.min(...pars)}-${Math.max(...pars)} (mean ${fixed(mean(pars), 1)})`,
    `one best solution ${unique}/${samples.length}`,
    `best solutions mean ${fixed(mean(best), 1)} max ${Math.max(...best)}`,
    `3-star luck mean ${percent(mean(luck))} max ${percent(Math.max(...luck))}`,
  ].join(' | ');
};

const dailyOnDemand = (): void => {
  console.log(`\nDaily on demand (request path, no prepared puzzle), ${days} dates from ${start}`);
  const byTier = new Map<DailyTier, Sample[]>();
  const passes = new Map<DailyTier, Map<DailyPass, number>>();
  for (let day = 0; day < days; day++) {
    const date = addDays(start, day);
    const tier = dailyTierForDate(date);
    const began = Date.now();
    const generated = generateDailyOnDemand(date, seedFromDate(date));
    const sample = measure(generated.board, Date.now() - began);
    byTier.set(tier, [...(byTier.get(tier) ?? []), sample]);
    const tally = passes.get(tier) ?? new Map<DailyPass, number>();
    tally.set(generated.pass, (tally.get(generated.pass) ?? 0) + 1);
    passes.set(tier, tally);
  }
  for (const tier of ['easy', 'medium', 'hard'] as const) {
    const tally = passes.get(tier);
    const passText = tally
      ? [...tally.entries()].map(([pass, n]) => `${pass} ${n}`).join(', ')
      : 'none';
    console.log(`  ${summarize(tier, byTier.get(tier) ?? [])}`);
    console.log(`    passes: ${passText}`);
  }
};

/** The week-ahead job's per-run budget (PREPARE_BUDGET_MS in daily.ts). */
const PREPARE_BUDGET_MS = 15_000;

const dailyPrepared = (): void => {
  console.log(`\nDaily prepared (week-ahead job), ${days} dates from ${start}`);
  const byTier = new Map<DailyTier, Sample[]>();
  const missed = new Map<DailyTier, number>();
  const exclude = new Set<string>();
  const fingerprints: string[] = [];
  for (let day = 0; day < days; day++) {
    const date = addDays(start, day);
    const tier = dailyTierForDate(date);
    const began = Date.now();
    const generated = generateDesignedDaily(date, {
      deadlineMs: PREPARE_BUDGET_MS,
      exclude,
      seed: seedFromDate(date),
    });
    const ms = Date.now() - began;
    if (!generated) {
      missed.set(tier, (missed.get(tier) ?? 0) + 1);
      continue;
    }
    byTier.set(tier, [...(byTier.get(tier) ?? []), measure(generated.board, ms)]);
    const id = boardFingerprintId(generated.board);
    exclude.add(id);
    fingerprints.push(id);
  }
  for (const tier of ['easy', 'medium', 'hard'] as const) {
    console.log(`  ${summarize(tier, byTier.get(tier) ?? [])}`);
    console.log(`    dates with no puzzle within one ${PREPARE_BUDGET_MS / 1000}s run: ${missed.get(tier) ?? 0}`);
  }
  console.log(
    `  repeats across ${fingerprints.length} dates (counting mirrored/rotated copies): ${fingerprints.length - new Set(fingerprints).size}`
  );
};

const endlessPool = (tier: EndlessTier, total: number): void => {
  const samples: Sample[] = [];
  const exact = new Set<string>();
  const shapes = new Set<string>();
  let exactRepeats = 0;
  let mirroredRepeats = 0;
  for (let index = 0; index < total; index++) {
    const began = Date.now();
    const puzzle = generateEndlessPoolPuzzle(tier);
    const ms = Date.now() - began;
    if (!puzzle) continue;
    samples.push(measure(puzzle.board, ms));
    const signature = boardSignature(puzzle.board);
    const fingerprint = boardFingerprint(puzzle.board);
    if (exact.has(signature)) exactRepeats++;
    else if (shapes.has(fingerprint)) mirroredRepeats++;
    exact.add(signature);
    shapes.add(fingerprint);
  }
  console.log(`  ${summarize(tier, samples)}`);
  console.log(
    `    repeats among ${samples.length}: exact ${exactRepeats}, mirrored/rotated ${mirroredRepeats}, different puzzles ${shapes.size}`
  );
};

const main = (): void => {
  const began = Date.now();
  if (only !== 'endless') {
    dailyOnDemand();
    dailyPrepared();
  }
  if (only !== 'daily') {
    console.log('\nEndless pool (what players are served)');
    endlessPool('easy', count('easy', 300));
    endlessPool('medium', count('medium', 150));
    endlessPool('hard', count('hard', 60));
  }
  console.log(`\nFinished in ${fixed((Date.now() - began) / 1000, 1)}s`);
};

main();
