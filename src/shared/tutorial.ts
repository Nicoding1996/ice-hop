import type { Board } from './game/types';

/**
 * The three hands-on practice puzzles. Each one teaches a single rule with
 * exactly one useful first move, so the highlighted piece is always the right
 * one to touch. Boards are 5 wide and 3 tall so they read large on a phone.
 */
export type TutorialStep = {
  readonly board: Board;
  /** Instruction shown above the action strip. */
  readonly caption: string;
  /** The piece that glows before the first move. */
  readonly focusPiece: number;
};

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    // Penguin hops right over the rock into the water.
    caption: 'Tap the penguin, then tap the gold dot. Penguins hop over things.',
    focusPiece: 0,
    board: {
      width: 5,
      height: 3,
      holes: [7],
      pieces: [
        { kind: 'HOPPER', cells: [5] },
        { kind: 'BLOCKER', cells: [6] },
      ],
    },
  },
  {
    // The penguin needs something under it to hop over: slide the seal there.
    caption: 'Slide the seal under the penguin: drag it, or tap it and tap a stop.',
    focusPiece: 1,
    board: {
      width: 5,
      height: 3,
      holes: [12],
      pieces: [
        { kind: 'HOPPER', cells: [2] },
        { kind: 'SLIDER', cells: [8, 9], orient: 'H' },
      ],
    },
  },
  {
    // The swimming penguin must hop out so its friend can take its hole.
    caption: 'Penguins in the water can hop out again. Make room for the other penguin!',
    focusPiece: 0,
    board: {
      width: 5,
      height: 3,
      holes: [6, 8],
      pieces: [
        { kind: 'HOPPER', cells: [6] },
        { kind: 'BLOCKER', cells: [7] },
        { kind: 'HOPPER', cells: [9] },
      ],
    },
  },
];
