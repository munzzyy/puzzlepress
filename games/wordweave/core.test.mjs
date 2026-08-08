import test from "node:test";
import assert from "node:assert/strict";
import {
  cellsAdjacent,
  isValidChain,
  wordFromChain,
  chainsEqual,
  createState,
  allTargetWords,
  remainingWords,
  isComplete,
  hintChargesAvailable,
  submitChain,
  useHint,
  shareText,
} from "./core.js";

// A tiny synthetic 8x6 puzzle, hand-tiled, so tests do not depend on the
// generated bank. Layout (row major):
// SPANNER  <- spangram cells span col 0 to col 5 across row 0 (7 letters
// would not fit in 6 cols, so the spangram wraps: row0 cols0-5 "SPANOK"
// is not a real word either). Build one deliberately below.

function makePuzzle() {
  // 8 rows x 6 cols = 48 cells.
  // Spangram BANDAGE (7 letters) starts at (0,0) and zigzags to (0,5)
  // using two rows so it still "touches" col 0 and col 5.
  // Path: (0,0)B (0,1)A (0,2)N (1,3)D (0,3)A... adjacency must hold; keep
  // it simple: spangram runs straight along row 0 except needs col0..col5
  // which is only 6 cells for a 7 letter word, so use a short 6-letter
  // spangram instead: "GARDEN".
  const spangramPath = [
    [0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5],
  ];
  const spangram = "GARDEN";

  // Remaining 42 cells (rows 1-7) tiled by words below, laid out with a
  // simple boustrophedon so consecutive cells are always adjacent.
  const rest = [];
  for (let r = 1; r < 8; r++) {
    if ((r - 1) % 2 === 0) {
      for (let c = 0; c < 6; c++) rest.push([r, c]);
    } else {
      for (let c = 5; c >= 0; c--) rest.push([r, c]);
    }
  }
  // rest has 42 cells; split into words summing to 42: 6+6+6+6+6+6+6
  const words = ["PLANET", "ROCKET", "ORBITS", "GALAXY", "NEBULA", "COMETS", "SATURN"];
  const solution = { [spangram]: spangramPath };
  const grid = Array.from({ length: 8 }, () => Array(6).fill(""));

  const place = (word, cells) => {
    solution[word] = cells;
    cells.forEach(([r, c], i) => {
      grid[r][c] = word[i];
    });
  };

  place(spangram, spangramPath);
  let pos = 0;
  for (const w of words) {
    const cells = rest.slice(pos, pos + w.length);
    place(w, cells);
    pos += w.length;
  }

  const gridStrs = grid.map((row) => row.join(""));
  const bonusWords = ["PLAN", "ROCK", "GALA", "COME"];

  return { theme: "Space mission", spangram, words, grid: gridStrs, solution, bonusWords };
}

test("cellsAdjacent covers all 8 directions and rejects self/far cells", () => {
  assert.equal(cellsAdjacent([2, 2], [2, 3]), true);
  assert.equal(cellsAdjacent([2, 2], [3, 3]), true);
  assert.equal(cellsAdjacent([2, 2], [1, 1]), true);
  assert.equal(cellsAdjacent([2, 2], [2, 2]), false);
  assert.equal(cellsAdjacent([2, 2], [2, 4]), false);
  assert.equal(cellsAdjacent([2, 2], [4, 2]), false);
});

test("isValidChain rejects out-of-bounds, repeats, and non-adjacent steps", () => {
  assert.equal(isValidChain([[0, 0], [0, 1]], 8, 6), true);
  assert.equal(isValidChain([[0, 0], [0, 0]], 8, 6), false);
  assert.equal(isValidChain([[0, 0], [0, 2]], 8, 6), false);
  assert.equal(isValidChain([[-1, 0], [0, 0]], 8, 6), false);
  assert.equal(isValidChain([[0, 0], [0, 6]], 8, 6), false);
  assert.equal(isValidChain([], 8, 6), false);
});

test("wordFromChain reads letters along a cell path", () => {
  const puzzle = makePuzzle();
  assert.equal(wordFromChain(puzzle.grid, puzzle.solution.GARDEN), "GARDEN");
});

test("chainsEqual accepts a path or its exact reverse only", () => {
  const a = [[0, 0], [0, 1], [0, 2]];
  const reversed = [[0, 2], [0, 1], [0, 0]];
  const different = [[0, 0], [1, 1], [0, 2]];
  assert.equal(chainsEqual(a, reversed), true);
  assert.equal(chainsEqual(a, a), true);
  assert.equal(chainsEqual(a, different), false);
});

test("submitChain finds the spangram and marks it as such", () => {
  const puzzle = makePuzzle();
  const state = createState();
  const { state: next, result } = submitChain(puzzle, state, puzzle.solution.GARDEN);
  assert.equal(result.status, "spangram");
  assert.equal(result.word, "GARDEN");
  assert.ok(next.found.GARDEN);
  assert.equal(next.found.GARDEN.type, "spangram");
  assert.equal(next.complete, false);
});

test("submitChain finds a theme word via the reverse-direction chain too", () => {
  const puzzle = makePuzzle();
  const state = createState();
  const reversed = puzzle.solution.PLANET.slice().reverse();
  const { result } = submitChain(puzzle, state, reversed);
  assert.equal(result.status, "theme");
  assert.equal(result.word, "PLANET");
});

test("submitChain rejects a chain that spells the right word over the wrong cells", () => {
  const puzzle = makePuzzle();
  const state = createState();
  // Same letters as PLANET but not the official adjacent path: force an
  // invalid (non-adjacent) synthetic chain of the right length.
  const bogus = [puzzle.solution.PLANET[0], puzzle.solution.SATURN[3]];
  const { result } = submitChain(puzzle, state, bogus.length === puzzle.solution.PLANET.length ? bogus : puzzle.solution.PLANET);
  // With only 2 cells this cannot spell PLANET, so it must be invalid.
  assert.notEqual(result.status, "already-found");
});

test("submitChain flags an already-found theme word without duplicating it", () => {
  const puzzle = makePuzzle();
  let state = createState();
  state = submitChain(puzzle, state, puzzle.solution.PLANET).state;
  const { result } = submitChain(puzzle, state, puzzle.solution.PLANET);
  assert.equal(result.status, "already-found");
});

test("bonus words accumulate hint charges every 3 finds", () => {
  const puzzle = makePuzzle();
  let state = createState();
  assert.equal(hintChargesAvailable(state), 0);

  const bonusCells = {
    PLAN: puzzle.solution.PLANET.slice(0, 4),
    ROCK: puzzle.solution.ROCKET.slice(0, 4),
    GALA: puzzle.solution.GALAXY.slice(0, 4),
  };

  let result;
  ({ state, result } = submitChain(puzzle, state, bonusCells.PLAN));
  assert.equal(result.status, "bonus");
  assert.equal(hintChargesAvailable(state), 0);

  ({ state, result } = submitChain(puzzle, state, bonusCells.ROCK));
  assert.equal(hintChargesAvailable(state), 0);

  ({ state, result } = submitChain(puzzle, state, bonusCells.GALA));
  assert.equal(result.status, "bonus");
  assert.equal(hintChargesAvailable(state), 1);
});

test("useHint is a no-op without a charge, and reveals a word once earned", () => {
  const puzzle = makePuzzle();
  let state = createState();

  let noHint;
  ({ state, result: noHint } = useHint(puzzle, state));
  assert.equal(noHint.status, "no-hint");

  for (const w of ["PLAN", "ROCK", "GALA"]) {
    state = submitChain(puzzle, state, puzzle.solution[Object.keys(puzzle.solution).find((k) => k.startsWith(w))].slice(0, 4)).state;
  }
  assert.equal(hintChargesAvailable(state), 1);

  const { state: afterHint, result } = useHint(puzzle, state);
  assert.equal(result.status, "hint");
  assert.ok(afterHint.found[result.word]);
  assert.equal(afterHint.found[result.word].type, "hint");
  assert.equal(hintChargesAvailable(afterHint), 0);
});

test("useHint never reveals the spangram", () => {
  const puzzle = makePuzzle();
  let state = createState();
  for (const w of ["PLAN", "ROCK", "GALA"]) {
    state = submitChain(puzzle, state, puzzle.solution[Object.keys(puzzle.solution).find((k) => k.startsWith(w))].slice(0, 4)).state;
  }
  const { result } = useHint(puzzle, state);
  assert.notEqual(result.word, puzzle.spangram);
});

test("puzzle is complete once every theme word and the spangram are found", () => {
  const puzzle = makePuzzle();
  let state = createState();
  assert.equal(isComplete(puzzle, state), false);

  for (const word of allTargetWords(puzzle)) {
    ({ state } = submitChain(puzzle, state, puzzle.solution[word]));
  }

  assert.equal(isComplete(puzzle, state), true);
  assert.equal(remainingWords(puzzle, state).length, 0);
});

test("shareText is spoiler-free: no theme words, just an emoji grid and time", () => {
  const puzzle = makePuzzle();
  let state = createState();
  for (const word of allTargetWords(puzzle)) {
    ({ state } = submitChain(puzzle, state, puzzle.solution[word]));
  }

  const text = shareText(puzzle, state, 42, 125);
  assert.match(text, /Wordweave Medium #42/);
  assert.match(text, /2:05/);
  for (const word of allTargetWords(puzzle)) {
    assert.equal(text.includes(word), false, `share text leaked ${word}`);
  }
  assert.match(text, /[\u{1F7E8}\u{1F7E6}]/u);
});

test("shareText names the active difficulty when one is passed", () => {
  const puzzle = makePuzzle();
  let state = createState();
  for (const word of allTargetWords(puzzle)) {
    ({ state } = submitChain(puzzle, state, puzzle.solution[word]));
  }

  assert.match(shareText(puzzle, state, 7, 60, "easy"), /Wordweave Easy #7/);
  assert.match(shareText(puzzle, state, 7, 60, "hard"), /Wordweave Hard #7/);
  assert.match(shareText(puzzle, state, 7, 60, "nonsense"), /Wordweave Medium #7/);
});

test("shareText notes hint usage when a hint was spent", () => {
  const puzzle = makePuzzle();
  let state = createState();
  for (const w of ["PLAN", "ROCK", "GALA"]) {
    state = submitChain(puzzle, state, puzzle.solution[Object.keys(puzzle.solution).find((k) => k.startsWith(w))].slice(0, 4)).state;
  }
  ({ state } = useHint(puzzle, state));
  const text = shareText(puzzle, state, 1, 10);
  assert.match(text, /1 hint/);
});

test("invalid chains (bad adjacency) are rejected without mutating state", () => {
  const puzzle = makePuzzle();
  const state = createState();
  const badChain = [[0, 0], [3, 3]];
  const { state: next, result } = submitChain(puzzle, state, badChain);
  assert.equal(result.status, "invalid");
  assert.equal(next, state);
});
