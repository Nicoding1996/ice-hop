import type { Board, Orientation, Piece, PieceKind } from './types';

const MAX_BOARD_DIMENSION = 20;
const MAX_BOARD_CELLS = 400;

export type BoardStructureResult =
  | { ok: true; board: Board }
  | { ok: false; reason: string };

const property = (value: object, key: string): unknown => Reflect.get(value, key);

const isObject = (value: unknown): value is object =>
  typeof value === 'object' && value !== null;

const isCell = (value: unknown, cellCount: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < cellCount;

const readKind = (value: unknown): PieceKind | null => {
  if (value === 'HOPPER' || value === 'SLIDER' || value === 'BLOCKER') return value;
  return null;
};

const readOrientation = (value: unknown): Orientation | null => {
  if (value === 'H' || value === 'V') return value;
  return null;
};

const sliderHasValidFootprint = (
  cells: readonly number[],
  orient: Orientation,
  width: number
): boolean => {
  if (cells.length !== 2) return false;
  const [first, second] = cells;
  if (first === undefined || second === undefined) return false;

  if (orient === 'H') {
    return second === first + 1 && Math.floor(first / width) === Math.floor(second / width);
  }

  return second === first + width && first % width === second % width;
};

/**
 * Parses and validates board data at a runtime trust boundary.
 *
 * Cell and hole ordering is normalized, while piece ordering is preserved
 * because move transcripts address pieces by index.
 */
export const validateBoardStructure = (value: unknown): BoardStructureResult => {
  if (!isObject(value)) return { ok: false, reason: 'Board data is missing or malformed.' };

  const widthValue = property(value, 'width');
  const heightValue = property(value, 'height');
  if (
    typeof widthValue !== 'number' ||
    typeof heightValue !== 'number' ||
    !Number.isSafeInteger(widthValue) ||
    !Number.isSafeInteger(heightValue) ||
    widthValue < 1 ||
    heightValue < 1 ||
    widthValue > MAX_BOARD_DIMENSION ||
    heightValue > MAX_BOARD_DIMENSION ||
    widthValue * heightValue > MAX_BOARD_CELLS
  ) {
    return { ok: false, reason: 'Board dimensions are invalid.' };
  }

  const width = widthValue;
  const height = heightValue;
  const cellCount = width * height;
  const holesValue = property(value, 'holes');
  if (!Array.isArray(holesValue) || holesValue.length > cellCount) {
    return { ok: false, reason: 'Water-hole data is malformed.' };
  }

  const holes: number[] = [];
  const holeSet = new Set<number>();
  for (const rawHole of holesValue) {
    const hole: unknown = rawHole;
    if (!isCell(hole, cellCount)) {
      return { ok: false, reason: 'Every water hole must be inside the board.' };
    }
    if (holeSet.has(hole)) {
      return { ok: false, reason: 'Water holes cannot share a cell.' };
    }
    holes.push(hole);
    holeSet.add(hole);
  }
  holes.sort((a, b) => a - b);

  const piecesValue = property(value, 'pieces');
  if (!Array.isArray(piecesValue) || piecesValue.length > cellCount) {
    return { ok: false, reason: 'Piece data is malformed.' };
  }

  const pieces: Piece[] = [];
  const occupied = new Set<number>();
  for (const rawPieceValue of piecesValue) {
    const rawPiece: unknown = rawPieceValue;
    if (!isObject(rawPiece)) return { ok: false, reason: 'Piece data is malformed.' };

    const kind = readKind(property(rawPiece, 'kind'));
    if (!kind) return { ok: false, reason: 'A piece has an unknown type.' };

    const cellsValue = property(rawPiece, 'cells');
    if (!Array.isArray(cellsValue) || cellsValue.length === 0) {
      return { ok: false, reason: 'Every piece must occupy a board cell.' };
    }

    const cells: number[] = [];
    const ownCells = new Set<number>();
    for (const rawCell of cellsValue) {
      const cell: unknown = rawCell;
      if (!isCell(cell, cellCount)) {
        return { ok: false, reason: 'Every piece must stay inside the board.' };
      }
      if (ownCells.has(cell)) {
        return { ok: false, reason: 'A piece cannot occupy the same cell twice.' };
      }
      if (occupied.has(cell)) {
        return { ok: false, reason: 'Pieces cannot overlap.' };
      }
      cells.push(cell);
      ownCells.add(cell);
    }
    cells.sort((a, b) => a - b);

    const orientValue = property(rawPiece, 'orient');
    if (kind === 'SLIDER') {
      const orient = readOrientation(orientValue);
      if (!orient || !sliderHasValidFootprint(cells, orient, width)) {
        return { ok: false, reason: 'Every seal must be a straight 1x2 piece.' };
      }
      if (cells.some((cell) => holeSet.has(cell))) {
        return { ok: false, reason: 'A seal cannot occupy a water hole.' };
      }
      pieces.push({ kind, cells, orient });
    } else {
      if (cells.length !== 1) {
        return { ok: false, reason: 'Penguins and rocks must occupy exactly one cell.' };
      }
      if (orientValue !== undefined) {
        return { ok: false, reason: 'Only seals can have an orientation.' };
      }
      if (kind === 'BLOCKER' && holeSet.has(cells[0])) {
        return { ok: false, reason: 'A rock cannot occupy a water hole.' };
      }
      pieces.push({ kind, cells });
    }

    for (const cell of cells) occupied.add(cell);
  }

  return { ok: true, board: { width, height, holes, pieces } };
};
