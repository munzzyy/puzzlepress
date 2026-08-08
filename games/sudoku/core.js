/*
  Sudoku pure logic. No DOM, no globals, no storage. A board is always an
  array of 81 ints (0 = blank), row-major: index = row * 9 + col.
*/

const SIZE = 81;

function assertBoardString(str) {
  if (typeof str !== "string" || !/^[0-9]{81}$/.test(str)) {
    throw new Error("sudoku: expected an 81-digit board string");
  }
}

/** "081...4" -> [0, 8, 1, ..., 4] */
export function parseCells(str) {
  assertBoardString(str);
  return str.split("").map(Number);
}

/** [0, 8, 1, ...] -> "081..." */
export function cellsToString(cells) {
  if (!Array.isArray(cells) || cells.length !== SIZE) {
    throw new Error("sudoku: expected 81 cells");
  }
  return cells.join("");
}

export function rowOf(i) {
  return Math.floor(i / 9);
}

export function colOf(i) {
  return i % 9;
}

export function boxOf(i) {
  return Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3);
}

/** The 20 other cells sharing a row, column, or box with `i`. */
export function peersOf(i) {
  const row = rowOf(i);
  const col = colOf(i);
  const boxRow = Math.floor(row / 3) * 3;
  const boxCol = Math.floor(col / 3) * 3;
  const set = new Set();
  for (let c = 0; c < 9; c++) set.add(row * 9 + c);
  for (let r = 0; r < 9; r++) set.add(r * 9 + col);
  for (let r = boxRow; r < boxRow + 3; r++) {
    for (let c = boxCol; c < boxCol + 3; c++) set.add(r * 9 + c);
  }
  set.delete(i);
  return [...set];
}

/** Indices of every filled cell that shares its value with a peer. */
export function findConflicts(cells) {
  const bad = new Set();
  for (let i = 0; i < SIZE; i++) {
    const v = cells[i];
    if (v === 0) continue;
    for (const p of peersOf(i)) {
      if (cells[p] === v) {
        bad.add(i);
        bad.add(p);
      }
    }
  }
  return bad;
}

export function isComplete(cells) {
  return cells.every((v) => v !== 0);
}

/** Complete and every digit matches the known solution. */
export function isSolved(cells, solution) {
  if (!isComplete(cells)) return false;
  for (let i = 0; i < SIZE; i++) {
    if (cells[i] !== solution[i]) return false;
  }
  return true;
}

/**
 * Fresh puzzle state. `puzzleCells` is the 81-cell starting board (0 =
 * blank). Given cells can never be changed or annotated.
 */
export function createState(puzzleCells) {
  return {
    given: puzzleCells.map((v) => v !== 0),
    values: [...puzzleCells],
    marks: puzzleCells.map(() => []),
    history: [],
  };
}

/**
 * Sets `index` to `value` (0 clears the cell). No-op on a given cell or an
 * unchanged value. Filling a cell drops its own pencil marks. Returns a new
 * state; the input is never mutated.
 */
export function setValue(state, index, value) {
  if (state.given[index]) return state;
  if (state.values[index] === value) return state;

  const prevValue = state.values[index];
  const prevMarks = state.marks[index];
  const values = state.values.slice();
  const marks = state.marks.slice();
  values[index] = value;
  marks[index] = value === 0 ? prevMarks : [];

  const history = state.history.concat([{ type: "value", index, prevValue, prevMarks }]);
  return { ...state, values, marks, history };
}

/**
 * Toggles a pencil mark 1-9 on an empty, non-given cell. No-op on a given
 * or already-filled cell.
 */
export function toggleMark(state, index, value) {
  if (state.given[index] || state.values[index] !== 0) return state;

  const prevMarks = state.marks[index];
  const marks = state.marks.slice();
  const has = prevMarks.includes(value);
  marks[index] = has
    ? prevMarks.filter((v) => v !== value)
    : [...prevMarks, value].sort((a, b) => a - b);

  const history = state.history.concat([{ type: "mark", index, prevMarks }]);
  return { ...state, marks, history };
}

/** Reverts the most recent setValue/toggleMark. No-op on empty history. */
export function undo(state) {
  if (state.history.length === 0) return state;

  const history = state.history.slice();
  const last = history.pop();
  const values = state.values.slice();
  const marks = state.marks.slice();

  if (last.type === "mark") {
    marks[last.index] = last.prevMarks;
  } else {
    values[last.index] = last.prevValue;
    marks[last.index] = last.prevMarks;
  }

  return { ...state, values, marks, history };
}

/**
 * Whether a saved day payload was written against `puzzleStr`. v2 saves
 * carry the exact board string they were saved from, so those compare
 * directly. Payloads carried over from the v1 storage migration predate the
 * puzzle field; for those, fall back to matching the given cells, since a
 * save from any other board disagrees on digits the player can never edit.
 * Anything malformed is rejected rather than poured into a fresh board.
 */
export function savedMatchesPuzzle(saved, puzzleStr) {
  if (!saved || typeof saved !== "object") return false;
  if (typeof saved.puzzle === "string") return saved.puzzle === puzzleStr;
  if (!Array.isArray(saved.values) || saved.values.length !== SIZE) return false;
  if (!saved.values.every((v) => Number.isInteger(v) && v >= 0 && v <= 9)) return false;
  const cells = parseCells(puzzleStr);
  return cells.every((v, i) => v === 0 || saved.values[i] === v);
}

/** Cell indices carrying the same non-zero value as `index`, `index` included. */
export function sameValueCells(cells, index) {
  const v = cells[index];
  if (!v) return [];
  const out = [];
  for (let i = 0; i < SIZE; i++) {
    if (cells[i] === v) out.push(i);
  }
  return out;
}
