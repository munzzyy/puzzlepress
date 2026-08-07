import test from "node:test";
import assert from "node:assert/strict";

import {
  parseCells,
  cellsToString,
  rowOf,
  colOf,
  boxOf,
  peersOf,
  findConflicts,
  isComplete,
  isSolved,
  createState,
  setValue,
  toggleMark,
  undo,
  sameValueCells,
} from "./core.js";

const SOLVED =
  "534678912672195348198342567859761423426853791713924856961537284287419635345286179";

// Puzzle carved from SOLVED, matching it everywhere it has a digit.
const PUZZLE =
  "534678912672195348198342567859761423426853791713924856961537284287419635345286100";

test("parseCells / cellsToString round-trip", () => {
  const cells = parseCells(SOLVED);
  assert.equal(cells.length, 81);
  assert.equal(cells[0], 5);
  assert.equal(cellsToString(cells), SOLVED);
});

test("parseCells rejects malformed strings", () => {
  assert.throws(() => parseCells("12345"));
  assert.throws(() => parseCells("a".repeat(81)));
  assert.throws(() => parseCells(12345));
});

test("cellsToString rejects wrong-length arrays", () => {
  assert.throws(() => cellsToString([1, 2, 3]));
});

test("rowOf / colOf / boxOf address the grid correctly", () => {
  assert.equal(rowOf(0), 0);
  assert.equal(colOf(0), 0);
  assert.equal(boxOf(0), 0);

  assert.equal(rowOf(13), 1);
  assert.equal(colOf(13), 4);
  assert.equal(boxOf(13), 1);

  assert.equal(rowOf(80), 8);
  assert.equal(colOf(80), 8);
  assert.equal(boxOf(80), 8);
});

test("peersOf returns exactly 20 unique cells, never including self", () => {
  for (const i of [0, 40, 80, 13, 60]) {
    const peers = peersOf(i);
    assert.equal(peers.length, 20);
    assert.equal(new Set(peers).size, 20);
    assert.ok(!peers.includes(i));
  }
});

test("peersOf(40) covers its row, column and box", () => {
  const peers = new Set(peersOf(40));
  // row 4
  for (let c = 0; c < 9; c++) if (c !== 4) assert.ok(peers.has(4 * 9 + c));
  // col 4
  for (let r = 0; r < 9; r++) if (r !== 4) assert.ok(peers.has(r * 9 + 4));
  // box 4 (rows 3-5, cols 3-5)
  for (let r = 3; r < 6; r++) {
    for (let c = 3; c < 6; c++) {
      if (r * 9 + c !== 40) assert.ok(peers.has(r * 9 + c));
    }
  }
});

test("findConflicts is empty on a validly solved grid", () => {
  const cells = parseCells(SOLVED);
  assert.equal(findConflicts(cells).size, 0);
});

test("findConflicts flags a duplicate in a row", () => {
  const cells = parseCells(SOLVED);
  // Overwrite cell 1 (row 0) with the value already at cell 0.
  cells[1] = cells[0];
  const bad = findConflicts(cells);
  assert.ok(bad.has(0));
  assert.ok(bad.has(1));
});

test("findConflicts flags a duplicate in a column and a box", () => {
  const cells = parseCells(SOLVED);
  cells[9] = cells[0]; // same column, row 1
  let bad = findConflicts(cells);
  assert.ok(bad.has(0) && bad.has(9));

  const cells2 = parseCells(SOLVED);
  cells2[10] = cells2[0]; // same box (row 1, col 1)
  bad = findConflicts(cells2);
  assert.ok(bad.has(0) && bad.has(10));
});

test("findConflicts ignores blanks", () => {
  const cells = parseCells(PUZZLE);
  assert.equal(findConflicts(cells).size, 0);
});

test("isComplete / isSolved on the finished grid", () => {
  const solution = parseCells(SOLVED);
  assert.ok(isComplete(solution));
  assert.ok(isSolved(solution, solution));
});

test("isSolved is false on an incomplete grid", () => {
  const solution = parseCells(SOLVED);
  const cells = parseCells(PUZZLE);
  assert.ok(!isComplete(cells));
  assert.ok(!isSolved(cells, solution));
});

test("isSolved is false on a complete but wrong grid", () => {
  const solution = parseCells(SOLVED);
  const wrong = parseCells(SOLVED);
  // Swap two values in a completed grid so rows/cols break in a way that
  // still leaves the grid "complete" (every cell filled) but not correct.
  const tmp = wrong[0];
  wrong[0] = wrong[1];
  wrong[1] = tmp;
  assert.ok(isComplete(wrong));
  assert.ok(!isSolved(wrong, solution));
});

test("createState marks starting digits as given and copies values", () => {
  const cells = parseCells(PUZZLE);
  const state = createState(cells);
  assert.equal(state.given[0], true);
  assert.equal(state.given[79], false); // blank in PUZZLE
  assert.deepEqual(state.values, cells);
  assert.equal(state.marks[79].length, 0);
  assert.equal(state.history.length, 0);
});

test("setValue fills a blank cell and records history", () => {
  const state = createState(parseCells(PUZZLE));
  const next = setValue(state, 79, 7);
  assert.equal(next.values[79], 7);
  assert.equal(next.history.length, 1);
  assert.equal(state.values[79], 0, "original state must not mutate");
});

test("setValue refuses to overwrite a given cell", () => {
  const state = createState(parseCells(PUZZLE));
  const next = setValue(state, 0, 9);
  assert.equal(next, state);
  assert.equal(next.values[0], 5);
});

test("setValue is a no-op when the value does not change", () => {
  const state = createState(parseCells(PUZZLE));
  const filled = setValue(state, 79, 7);
  const again = setValue(filled, 79, 7);
  assert.equal(again, filled);
  assert.equal(again.history.length, 1);
});

test("setValue clears pencil marks on the filled cell", () => {
  let state = createState(parseCells(PUZZLE));
  state = toggleMark(state, 79, 3);
  state = toggleMark(state, 79, 5);
  assert.deepEqual(state.marks[79], [3, 5]);
  state = setValue(state, 79, 7);
  assert.deepEqual(state.marks[79], []);
});

test("toggleMark adds and removes a note, sorted", () => {
  let state = createState(parseCells(PUZZLE));
  state = toggleMark(state, 79, 5);
  state = toggleMark(state, 79, 2);
  assert.deepEqual(state.marks[79], [2, 5]);
  state = toggleMark(state, 79, 5);
  assert.deepEqual(state.marks[79], [2]);
});

test("toggleMark is a no-op on a given or filled cell", () => {
  const state = createState(parseCells(PUZZLE));
  const onGiven = toggleMark(state, 0, 5);
  assert.equal(onGiven, state);

  const filled = setValue(state, 79, 7);
  const onFilled = toggleMark(filled, 79, 5);
  assert.equal(onFilled, filled);
});

test("undo reverts a value entry", () => {
  const state = createState(parseCells(PUZZLE));
  const filled = setValue(state, 79, 7);
  const reverted = undo(filled);
  assert.equal(reverted.values[79], 0);
  assert.equal(reverted.history.length, 0);
});

test("undo reverts a pencil mark toggle", () => {
  const state = createState(parseCells(PUZZLE));
  const marked = toggleMark(state, 79, 5);
  const reverted = undo(marked);
  assert.deepEqual(reverted.marks[79], []);
});

test("undo is a no-op on empty history", () => {
  const state = createState(parseCells(PUZZLE));
  assert.equal(undo(state), state);
});

test("undo restores earlier pencil marks when clearing a filled cell", () => {
  let state = createState(parseCells(PUZZLE));
  state = toggleMark(state, 79, 4);
  state = setValue(state, 79, 7); // fill clears the mark, recorded in history
  const reverted = undo(state);
  assert.equal(reverted.values[79], 0);
  assert.deepEqual(reverted.marks[79], [4]);
});

test("multiple undos walk back through several moves", () => {
  let state = createState(parseCells(PUZZLE));
  state = setValue(state, 79, 7);
  state = setValue(state, 80, 3);
  assert.equal(state.values[79], 7);
  assert.equal(state.values[80], 3);
  state = undo(state);
  assert.equal(state.values[80], 0);
  assert.equal(state.values[79], 7);
  state = undo(state);
  assert.equal(state.values[79], 0);
  assert.equal(state.history.length, 0);
});

test("a full and error-free grid via setValue is solved", () => {
  const solution = parseCells(SOLVED);
  const cells = parseCells(PUZZLE);
  let state = createState(cells);
  for (let i = 0; i < 81; i++) {
    if (!state.given[i]) {
      state = setValue(state, i, solution[i]);
    }
  }
  assert.equal(findConflicts(state.values).size, 0);
  assert.ok(isSolved(state.values, solution));
});

test("a wrong entry produces a conflict and blocks the win", () => {
  const solution = parseCells(SOLVED);
  const cells = parseCells(PUZZLE);
  let state = createState(cells);
  for (let i = 0; i < 81; i++) {
    if (!state.given[i]) state = setValue(state, i, solution[i]);
  }
  // Corrupt one cell so it collides with a peer.
  const target = state.given.findIndex((g, i) => !g && i !== 79);
  const collideWith = peersOf(target).find((p) => !state.given[p]);
  state = setValue(state, target, state.values[collideWith]);
  assert.ok(findConflicts(state.values).has(target));
  assert.ok(!isSolved(state.values, solution));
});

test("sameValueCells finds every cell sharing a digit", () => {
  const cells = parseCells(SOLVED);
  const target = cells[0];
  const matches = sameValueCells(cells, 0);
  assert.ok(matches.includes(0));
  for (const i of matches) assert.equal(cells[i], target);
  assert.equal(matches.length, cells.filter((v) => v === target).length);
});

test("sameValueCells is empty for a blank cell", () => {
  const cells = parseCells(PUZZLE);
  assert.deepEqual(sameValueCells(cells, 79), []);
});
