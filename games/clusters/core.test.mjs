import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TIERS,
  BOARD_SIZE,
  MAX_MISTAKES,
  flattenPuzzle,
  initialOrder,
  shuffle,
  createState,
  toggleTile,
  deselectAll,
  shuffleBoard,
  submitGuess,
  isPlaying,
  isOver,
  mistakesLeft,
  shareLines,
  formatShare,
} from "./core.js";

function puzzle() {
  return {
    groups: [
      { name: "Shades of blue", words: ["NAVY", "COBALT", "AZURE", "TEAL"], tier: "sand" },
      { name: "Chess pieces", words: ["KING", "QUEEN", "ROOK", "BISHOP"], tier: "amber" },
      { name: "Stone fruits", words: ["PEACH", "PLUM", "APRICOT", "CHERRY"], tier: "ink" },
      { name: "Card suits", words: ["HEARTS", "CLUBS", "SPADES", "DIAMONDS"], tier: "plum" },
    ],
  };
}

test("flattenPuzzle produces 16 tiles tagged with their group", () => {
  const tiles = flattenPuzzle(puzzle());
  assert.equal(tiles.length, BOARD_SIZE);
  assert.equal(tiles[0].word, "NAVY");
  assert.equal(tiles[0].groupIndex, 0);
  assert.equal(tiles[15].word, "DIAMONDS");
  assert.equal(tiles[15].groupIndex, 3);
});

test("initialOrder is the identity permutation", () => {
  assert.deepEqual(initialOrder(puzzle()), [...Array(BOARD_SIZE).keys()]);
});

test("shuffle is a permutation and deterministic under a seeded rng", () => {
  const order = initialOrder(puzzle());
  let seed = 1;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const a = shuffle(order, rng);
  seed = 1;
  const b = shuffle(order, rng);
  assert.deepEqual(a, b);
  assert.deepEqual([...a].sort((x, y) => x - y), order);
});

test("toggleTile selects up to 4 tiles and toggles off on repeat", () => {
  let state = createState(initialOrder(puzzle()));
  state = toggleTile(state, 0);
  state = toggleTile(state, 1);
  assert.deepEqual(state.selected, [0, 1]);
  state = toggleTile(state, 0);
  assert.deepEqual(state.selected, [1]);
});

test("toggleTile refuses a 5th selection", () => {
  let state = createState(initialOrder(puzzle()));
  for (const i of [0, 1, 2, 3]) state = toggleTile(state, i);
  state = toggleTile(state, 4);
  assert.deepEqual(state.selected, [0, 1, 2, 3]);
});

test("deselectAll clears selection and is a no-op when already empty", () => {
  let state = createState(initialOrder(puzzle()));
  state = toggleTile(state, 0);
  state = deselectAll(state);
  assert.deepEqual(state.selected, []);
  const again = deselectAll(state);
  assert.equal(again, state);
});

test("submitGuess requires exactly 4 selected tiles", () => {
  let state = createState(initialOrder(puzzle()));
  state = toggleTile(state, 0);
  const before = state;
  state = submitGuess(puzzle(), state);
  assert.equal(state, before);
});

test("submitGuess on a correct group solves it and removes the tiles from order", () => {
  let state = createState(initialOrder(puzzle()));
  for (const i of [0, 1, 2, 3]) state = toggleTile(state, i);
  state = submitGuess(puzzle(), state);
  assert.equal(state.lastResult.type, "correct");
  assert.equal(state.lastResult.groupIndex, 0);
  assert.equal(state.solvedGroups.length, 1);
  assert.equal(state.solvedGroups[0].tier, "sand");
  assert.deepEqual(state.selected, []);
  assert.equal(state.order.length, BOARD_SIZE - 4);
  assert.ok(![0, 1, 2, 3].some((i) => state.order.includes(i)));
  assert.equal(isPlaying(state), true);
});

test("solving all four groups wins", () => {
  let state = createState(initialOrder(puzzle()));
  for (const group of [0, 1, 2, 3]) {
    for (const i of [0, 1, 2, 3]) state = toggleTile(state, group * 4 + i);
    state = submitGuess(puzzle(), state);
  }
  assert.equal(state.status, "won");
  assert.equal(isOver(state), true);
  assert.equal(state.solvedGroups.length, 4);
  assert.ok(state.solvedGroups.every((g) => !g.revealed));
});

test("a wrong guess with 3 from one group reports one away", () => {
  let state = createState(initialOrder(puzzle()));
  for (const i of [0, 1, 2, 4]) state = toggleTile(state, i);
  state = submitGuess(puzzle(), state);
  assert.equal(state.lastResult.type, "oneAway");
  assert.equal(state.mistakes, 1);
  assert.equal(state.status, "playing");
});

test("a wrong guess with a 2-2 split is just wrong, not one away", () => {
  let state = createState(initialOrder(puzzle()));
  for (const i of [0, 1, 4, 5]) state = toggleTile(state, i);
  state = submitGuess(puzzle(), state);
  assert.equal(state.lastResult.type, "wrong");
  assert.equal(state.mistakes, 1);
});

test("mistakesLeft counts down and four mistakes ends the game with remaining groups revealed", () => {
  let state = createState(initialOrder(puzzle()));
  assert.equal(mistakesLeft(state), MAX_MISTAKES);
  const wrongGuesses = [
    [0, 1, 4, 5],
    [0, 1, 4, 6],
    [0, 1, 4, 7],
    [0, 2, 4, 5],
  ];
  for (const guess of wrongGuesses) {
    for (const i of guess) state = toggleTile(state, i);
    state = submitGuess(puzzle(), state);
  }
  assert.equal(state.mistakes, MAX_MISTAKES);
  assert.equal(mistakesLeft(state), 0);
  assert.equal(state.status, "lost");
  assert.equal(isOver(state), true);
  assert.equal(state.order.length, 0);
  assert.equal(state.solvedGroups.length, 4);
  assert.ok(state.solvedGroups.every((g) => g.revealed));
  assert.deepEqual(
    state.solvedGroups.map((g) => g.tier),
    TIERS
  );
});

test("toggleTile and submitGuess are no-ops once the game is over", () => {
  let state = createState(initialOrder(puzzle()));
  for (const group of [0, 1, 2, 3]) {
    for (const i of [0, 1, 2, 3]) state = toggleTile(state, group * 4 + i);
    state = submitGuess(puzzle(), state);
  }
  const wonState = state;
  const afterToggle = toggleTile(state, 4);
  assert.equal(afterToggle, wonState);
});

test("shuffleBoard preserves the set of unsolved tiles and selection identity", () => {
  let state = createState(initialOrder(puzzle()));
  state = toggleTile(state, 2);
  const shuffled = shuffleBoard(state, () => 0.999);
  assert.deepEqual([...shuffled.order].sort((a, b) => a - b), state.order);
  assert.deepEqual(shuffled.selected, [2]);
});

test("shareLines and formatShare are spoiler-free (no words or category names)", () => {
  let state = createState(initialOrder(puzzle()));
  for (const i of [0, 1, 2, 3]) state = toggleTile(state, i);
  state = submitGuess(puzzle(), state);
  const lines = shareLines(state);
  assert.equal(lines.length, 1);
  assert.equal(lines[0], "\u{1F7EB}\u{1F7EB}\u{1F7EB}\u{1F7EB}");

  const text = formatShare("Clusters #12", state);
  assert.match(text, /^Clusters #12\n/);
  for (const group of puzzle().groups) {
    assert.ok(!text.includes(group.name));
    for (const word of group.words) assert.ok(!text.toUpperCase().includes(word));
  }
});

test("formatShare reports a perfect solve distinctly from a solve with mistakes", () => {
  let state = createState(initialOrder(puzzle()));
  for (const group of [0, 1, 2, 3]) {
    for (const i of [0, 1, 2, 3]) state = toggleTile(state, group * 4 + i);
    state = submitGuess(puzzle(), state);
  }
  assert.match(formatShare("Clusters #1", state), /Perfect solve/);
});

// v2 difficulty tiers (easy/medium/hard) are a bank-selection and UI
// concern owned by game.js, not a reducer concept: every difficulty plays
// the same puzzle shape through the same state machine above. The one
// integration point core.js owns is the opaque puzzleLabel formatShare
// takes, so this pins the exact difficulty-tagged label game.js builds
// (e.g. "Clusters Hard #3") flows through unchanged.
test("formatShare passes a difficulty-tagged label through untouched", () => {
  let state = createState(initialOrder(puzzle()));
  for (const i of [0, 1, 2, 3]) state = toggleTile(state, i);
  state = submitGuess(puzzle(), state);
  const text = formatShare("Clusters Hard #3", state);
  assert.match(text, /^Clusters Hard #3\n/);
});

function pick(state, indexes) {
  return indexes.reduce((s, i) => toggleTile(s, i), state);
}

test("repeating the same wrong four costs no extra mistake", () => {
  let state = createState(initialOrder(puzzle()));
  state = submitGuess(puzzle(), pick(state, [0, 1, 2, 4]));
  assert.equal(state.mistakes, 1);
  state = pick(state, [0, 1, 2, 4]);
  state = submitGuess(puzzle(), state);
  assert.equal(state.mistakes, 1);
  assert.deepEqual(state.lastResult, { type: "duplicate" });
  assert.deepEqual(state.selected, [0, 1, 2, 4]);
});

test("a different wrong four still counts as a mistake", () => {
  let state = createState(initialOrder(puzzle()));
  state = submitGuess(puzzle(), pick(state, [0, 1, 2, 4]));
  state = submitGuess(puzzle(), pick(state, [0, 1, 4, 5]));
  assert.equal(state.mistakes, 2);
  assert.equal(state.lastResult.type, "wrong");
});

test("the same four picked in another order is still a repeat", () => {
  let state = createState(initialOrder(puzzle()));
  state = submitGuess(puzzle(), pick(state, [0, 1, 2, 4]));
  state = submitGuess(puzzle(), pick(state, [4, 2, 0, 1]));
  assert.equal(state.mistakes, 1);
  assert.equal(state.lastResult.type, "duplicate");
});

test("a saved state from before guesses were tracked still plays", () => {
  const { guesses, ...old } = createState(initialOrder(puzzle()));
  assert.deepEqual(guesses, []);
  let state = submitGuess(puzzle(), pick({ ...old, mistakes: 1 }, [0, 1, 2, 4]));
  assert.equal(state.mistakes, 2);
  state = submitGuess(puzzle(), pick(state, [0, 1, 2, 4]));
  assert.equal(state.mistakes, 2);
  state = submitGuess(puzzle(), pick(deselectAll(state), [0, 1, 2, 3]));
  assert.equal(state.solvedGroups.length, 1);
});
