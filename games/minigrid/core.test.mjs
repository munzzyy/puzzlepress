import test from "node:test";
import assert from "node:assert/strict";

const {
  parsePuzzle,
  orderedSlots,
  createInitialState,
  toggleDirection,
  moveCursor,
  selectCell,
  jumpToSlot,
  advanceClue,
  typeLetter,
  backspace,
  checkCell,
  revealCell,
  isSolved,
  finishIfSolved,
  elapsedMs,
  formatTime,
  shareText,
} = await import("./core.js");

// A valid bank-shaped 5x5: blocks at all four corners, the only symmetric
// block placement that keeps every run length >= 3 in a 5-wide grid (an
// interior block always slices its row or column into an illegal 1- or
// 2-length remainder). 10 entries: five across, five down.
const GRID = ["#BCD#", "EFGHI", "JKLMN", "OPQRS", "#TUV#"];
const PUZZLE = {
  grid: GRID,
  clues: {
    across: { 1: "cols 1-3 of row 0", 4: "row 1", 6: "row 2", 7: "row 3", 8: "cols 1-3 of row 4" },
    down: { 1: "col 1", 2: "col 2", 3: "col 3", 4: "col 0", 5: "col 4" },
  },
};

test("parsePuzzle finds five across and five down slots, first number at the first open cell", () => {
  const meta = parsePuzzle(PUZZLE);
  assert.equal(meta.acrossSlots.length, 5);
  assert.equal(meta.downSlots.length, 5);
  const nums = [...meta.numbering.entries()].sort((a, b) => a[1] - b[1]);
  assert.deepEqual(nums[0], ["0,1", 1]); // (0,0) is a block, so (0,1) is first
});

test("every open cell has both an across and a down slot (bank invariant)", () => {
  const meta = parsePuzzle(PUZZLE);
  for (const [k, slots] of meta.cellSlot) {
    assert.ok(slots.across, `missing across slot at ${k}`);
    assert.ok(slots.down, `missing down slot at ${k}`);
  }
});

test("orderedSlots sorts by number, across before down on a tie", () => {
  const meta = parsePuzzle(PUZZLE);
  const order = orderedSlots(meta);
  assert.equal(order[0].number, 1);
  assert.equal(order[0].dir, "across");
});

test("createInitialState starts at the first open cell, across, empty, unsolved", () => {
  const state = createInitialState(PUZZLE, 1000);
  assert.deepEqual(state.cursor, { r: 0, c: 1 });
  assert.equal(state.direction, "across");
  assert.equal(state.entries[0][1], "");
  assert.equal(state.entries[0][0], null); // block cell
  assert.equal(state.startedAt, 1000);
  assert.equal(state.solvedAt, null);
  assert.equal(state.usedHelp, false);
});

test("toggleDirection flips across/down", () => {
  const state = createInitialState(PUZZLE);
  assert.equal(toggleDirection(state).direction, "down");
  assert.equal(toggleDirection(toggleDirection(state)).direction, "across");
});

test("moveCursor hops over a block to the next open cell in that direction", () => {
  const hopGrid = ["A#B", "CDE", "F#G"];
  let state = createInitialState({ grid: hopGrid });
  state = selectCell(state, 0, 0);
  state = moveCursor(state, hopGrid, 0, 1);
  assert.deepEqual(state.cursor, { r: 0, c: 2 });
});

test("moveCursor stays put when no open cell exists further in that direction", () => {
  let state = createInitialState(PUZZLE);
  state = selectCell(state, 0, 1);
  state = moveCursor(state, GRID, -1, 0); // off the top edge
  assert.deepEqual(state.cursor, { r: 0, c: 1 });
});

test("selectCell moves the cursor, and re-selecting the same cell toggles direction", () => {
  let state = createInitialState(PUZZLE);
  state = selectCell(state, 2, 0);
  assert.deepEqual(state.cursor, { r: 2, c: 0 });
  assert.equal(state.direction, "across");
  state = selectCell(state, 2, 0);
  assert.equal(state.direction, "down");
});

test("jumpToSlot and advanceClue cycle through numbered slots and wrap around", () => {
  const meta = parsePuzzle(PUZZLE);
  let state = createInitialState(PUZZLE);
  const slot4across = orderedSlots(meta).find((s) => s.number === 4 && s.dir === "across");
  state = jumpToSlot(state, slot4across);
  assert.deepEqual(state.cursor, { r: 1, c: 0 });
  assert.equal(state.direction, "across");

  const order = orderedSlots(meta);
  let cycled = state;
  for (let i = 0; i < order.length; i++) cycled = advanceClue(cycled, meta, 1);
  assert.deepEqual(cycled.cursor, state.cursor);
  assert.equal(cycled.direction, state.direction);

  const back = advanceClue(state, meta, -1);
  const forwardAgain = advanceClue(back, meta, 1);
  assert.deepEqual(forwardAgain.cursor, state.cursor);
});

test("typeLetter fills the cell and steps forward within the run", () => {
  let state = createInitialState(PUZZLE);
  state = typeLetter(state, GRID, "b");
  assert.equal(state.entries[0][1], "B");
  assert.deepEqual(state.cursor, { r: 0, c: 2 });
});

test("typeLetter does not advance past the end of the run (next cell is a block)", () => {
  let state = createInitialState(PUZZLE);
  state = selectCell(state, 0, 3);
  state = typeLetter(state, GRID, "d");
  assert.deepEqual(state.cursor, { r: 0, c: 3 });
});

test("typeLetter ignores non-letters", () => {
  let state = createInitialState(PUZZLE);
  const before = state;
  state = typeLetter(state, GRID, "5");
  assert.equal(state, before);
});

test("backspace clears the current cell before stepping back", () => {
  let state = createInitialState(PUZZLE); // cursor at (0,1)
  state = typeLetter(state, GRID, "b"); // -> (0,2)
  state = typeLetter(state, GRID, "c"); // -> (0,3)
  state = backspace(state, GRID);
  assert.equal(state.entries[0][2], "");
  assert.deepEqual(state.cursor, { r: 0, c: 2 });
  state = backspace(state, GRID);
  assert.equal(state.entries[0][1], "");
  assert.deepEqual(state.cursor, { r: 0, c: 1 });
});

test("checkCell marks correct vs wrong and flags usedHelp, is a no-op on an empty cell", () => {
  let state = createInitialState(PUZZLE); // cursor (0,1), answer 'B'
  state = checkCell(state, GRID);
  assert.equal(Object.keys(state.checked).length, 0);
  assert.equal(state.usedHelp, true);

  state = typeLetter(state, GRID, "x");
  state = checkCell({ ...state, cursor: { r: 0, c: 1 } }, GRID);
  assert.equal(state.checked["0,1"], "wrong");

  state = { ...state, cursor: { r: 0, c: 1 } };
  state = typeLetter(state, GRID, "b");
  state = checkCell({ ...state, cursor: { r: 0, c: 1 } }, GRID);
  assert.equal(state.checked["0,1"], "correct");
});

test("revealCell fills the correct letter and flags usedHelp", () => {
  let state = createInitialState(PUZZLE);
  state = revealCell(state, GRID);
  assert.equal(state.entries[0][1], "B");
  assert.equal(state.revealed["0,1"], true);
  assert.equal(state.usedHelp, true);
});

test("isSolved is false until every open cell matches, ignores blocks", () => {
  let state = createInitialState(PUZZLE);
  assert.equal(isSolved(state, GRID), false);
  for (let r = 0; r < GRID.length; r++) {
    for (let c = 0; c < GRID[r].length; c++) {
      if (GRID[r][c] !== "#") state.entries[r][c] = GRID[r][c];
    }
  }
  assert.equal(isSolved(state, GRID), true);
});

test("finishIfSolved freezes solvedAt once and is idempotent", () => {
  let state = createInitialState(PUZZLE, 0);
  for (let r = 0; r < GRID.length; r++) {
    for (let c = 0; c < GRID[r].length; c++) {
      if (GRID[r][c] !== "#") state.entries[r][c] = GRID[r][c];
    }
  }
  state = finishIfSolved(state, GRID, 5000);
  assert.equal(state.solvedAt, 5000);
  const again = finishIfSolved(state, GRID, 9999);
  assert.equal(again.solvedAt, 5000);
  assert.equal(again, state);
});

test("finishIfSolved leaves solvedAt null when the grid is incomplete", () => {
  const state = createInitialState(PUZZLE, 0);
  const result = finishIfSolved(state, GRID, 5000);
  assert.equal(result.solvedAt, null);
});

test("elapsedMs freezes once solved, keeps ticking otherwise", () => {
  const running = createInitialState(PUZZLE, 1000);
  assert.equal(elapsedMs(running, 4000), 3000);
  const solved = { ...running, solvedAt: 4000 };
  assert.equal(elapsedMs(solved, 999999), 3000);
});

test("formatTime renders M:SS with a zero-padded seconds field", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(9000), "0:09");
  assert.equal(formatTime(75000), "1:15");
  assert.equal(formatTime(3600000), "60:00");
});

test("shareText has no dashes beyond ASCII hyphen, no ellipsis, and reports time", () => {
  const text = shareText({ dateLabel: "2026-08-10", diffLabel: "Medium", ms: 82000, usedHelp: false, url: "https://x/y" });
  assert.ok(text.includes("1:22"));
  assert.ok(!text.includes("\u2014")); // em dash
  assert.ok(!text.includes("\u2013")); // en dash
  assert.ok(!text.includes("\u2026")); // ellipsis char
  const withHelp = shareText({ dateLabel: "2026-08-10", diffLabel: "Medium", ms: 1000, usedHelp: true, url: "u" });
  assert.ok(withHelp.includes("with help"));
});

test("shareText includes the difficulty word right after the game name", () => {
  const hard = shareText({ dateLabel: "2026-08-10", diffLabel: "Hard", ms: 5000, usedHelp: false, url: "u" });
  assert.ok(hard.startsWith("Minigrid Hard - 2026-08-10"));
  const easy = shareText({ dateLabel: "2026-08-10", diffLabel: "Easy", ms: 5000, usedHelp: false, url: "u" });
  assert.ok(easy.startsWith("Minigrid Easy - 2026-08-10"));
});

test("shareText falls back to a plain game name when no difficulty label is given", () => {
  const text = shareText({ dateLabel: "2026-08-10", ms: 5000, usedHelp: false, url: "u" });
  assert.ok(text.startsWith("Minigrid - 2026-08-10"));
});
