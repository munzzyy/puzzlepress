/*
  Clusters pure logic. No DOM, no globals, no localStorage. Everything here
  takes the puzzle and current state as arguments and returns a new state,
  so the whole game is a plain reducer game.js can drive.

  Puzzle shape: { groups: [{ name, words: [w,w,w,w], tier }, x4] }
  tier is one of TIERS, easiest first.
*/

export const TIERS = ["sand", "amber", "ink", "plum"];
export const GROUP_SIZE = 4;
export const GROUP_COUNT = 4;
export const BOARD_SIZE = GROUP_SIZE * GROUP_COUNT;
export const MAX_MISTAKES = 4;

const TIER_RANK = Object.fromEntries(TIERS.map((t, i) => [t, i]));

/** Flattens a puzzle into 16 { word, groupIndex } tiles, group order fixed. */
export function flattenPuzzle(puzzle) {
  const tiles = [];
  puzzle.groups.forEach((group, groupIndex) => {
    group.words.forEach((word) => tiles.push({ word, groupIndex }));
  });
  return tiles;
}

/** [0..15] in flattened order, the identity arrangement before any shuffle. */
export function initialOrder(puzzle) {
  return flattenPuzzle(puzzle).map((_, i) => i);
}

/** Fisher-Yates. rng defaults to Math.random but tests pass a seeded one. */
export function shuffle(list, rng = Math.random) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Fresh game state for a given display order (already shuffled if wanted). */
export function createState(order) {
  return {
    order: order.slice(),
    selected: [],
    solvedGroups: [],
    mistakes: 0,
    status: "playing",
    lastResult: null,
  };
}

export function isPlaying(state) {
  return state.status === "playing";
}

export function isOver(state) {
  return state.status !== "playing";
}

export function mistakesLeft(state) {
  return Math.max(0, MAX_MISTAKES - state.mistakes);
}

function isTileSolved(state, flatIndex) {
  return !state.order.includes(flatIndex);
}

/** Select or deselect a tile. No-ops once the game is over, a tile is
 * already solved, or 4 tiles are already selected and this one is new. */
export function toggleTile(state, flatIndex) {
  if (!isPlaying(state)) return state;
  if (isTileSolved(state, flatIndex)) return state;

  const already = state.selected.includes(flatIndex);
  if (already) {
    return { ...state, selected: state.selected.filter((i) => i !== flatIndex), lastResult: null };
  }
  if (state.selected.length >= GROUP_SIZE) return state;
  return { ...state, selected: [...state.selected, flatIndex], lastResult: null };
}

export function deselectAll(state) {
  if (state.selected.length === 0) return state;
  return { ...state, selected: [], lastResult: null };
}

/** Reshuffles the still-unsolved tiles in place. Selection is unaffected;
 * it tracks tile identity, not board position. */
export function shuffleBoard(state, rng = Math.random) {
  if (!isPlaying(state)) return state;
  return { ...state, order: shuffle(state.order, rng), lastResult: null };
}

function revealedGroups(puzzle, solvedGroupIndexes) {
  return puzzle.groups
    .map((group, groupIndex) => ({
      groupIndex,
      tier: group.tier,
      name: group.name,
      words: group.words.slice(),
      revealed: true,
    }))
    .filter((g) => !solvedGroupIndexes.has(g.groupIndex))
    .sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier]);
}

/**
 * Submits the current 4 selected tiles as a guess. Requires exactly 4
 * selected; a no-op otherwise so callers can gate the submit button on
 * selected.length === GROUP_SIZE instead of duplicating this check.
 */
export function submitGuess(puzzle, state) {
  if (!isPlaying(state)) return state;
  if (state.selected.length !== GROUP_SIZE) return state;

  const tiles = flattenPuzzle(puzzle);
  const groupIndexes = state.selected.map((i) => tiles[i].groupIndex);
  const allSame = groupIndexes.every((g) => g === groupIndexes[0]);

  if (allSame) {
    const groupIndex = groupIndexes[0];
    const group = puzzle.groups[groupIndex];
    const solvedGroups = [
      ...state.solvedGroups,
      { groupIndex, tier: group.tier, name: group.name, words: group.words.slice(), revealed: false },
    ];
    const order = state.order.filter((i) => !state.selected.includes(i));
    const won = solvedGroups.length === GROUP_COUNT;
    return {
      ...state,
      order,
      selected: [],
      solvedGroups,
      status: won ? "won" : "playing",
      lastResult: { type: "correct", groupIndex },
    };
  }

  const counts = new Map();
  for (const g of groupIndexes) counts.set(g, (counts.get(g) || 0) + 1);
  const maxCount = Math.max(...counts.values());
  const oneAway = maxCount === GROUP_SIZE - 1;
  const mistakes = state.mistakes + 1;
  const lost = mistakes >= MAX_MISTAKES;

  if (!lost) {
    return {
      ...state,
      selected: [],
      mistakes,
      lastResult: { type: oneAway ? "oneAway" : "wrong" },
    };
  }

  const solvedGroupIndexes = new Set(state.solvedGroups.map((g) => g.groupIndex));
  const solvedGroups = [...state.solvedGroups, ...revealedGroups(puzzle, solvedGroupIndexes)];
  return {
    ...state,
    order: [],
    selected: [],
    mistakes,
    solvedGroups,
    status: "lost",
    lastResult: { type: oneAway ? "oneAway" : "wrong" },
  };
}

const TIER_EMOJI = { sand: "\u{1F7EB}", amber: "\u{1F7E7}", ink: "\u{1F7E6}", plum: "\u{1F7EA}" };

/** One emoji row per solved-or-revealed group, in the order it happened. */
export function shareLines(state) {
  return state.solvedGroups.map((g) => TIER_EMOJI[g.tier].repeat(GROUP_SIZE));
}

/**
 * Spoiler-free share text: no words or category names, just the result and
 * a color-coded record of the run.
 */
export function resultLine(state) {
  const solvedCount = state.solvedGroups.filter((g) => !g.revealed).length;
  return state.status === "won"
    ? mistakesLeft(state) === MAX_MISTAKES
      ? "Perfect solve"
      : `Solved, ${state.mistakes} mistake${state.mistakes === 1 ? "" : "s"}`
    : `${solvedCount} of ${GROUP_COUNT} groups`;
}

export function formatShare(puzzleLabel, state) {
  return [puzzleLabel, resultLine(state), ...shareLines(state)].join("\n");
}
