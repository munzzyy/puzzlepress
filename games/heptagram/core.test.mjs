import test from "node:test";
import assert from "node:assert/strict";
import {
  RANKS,
  WIN_RANK,
  normalizeWord,
  isPangram,
  wordScore,
  legalShape,
  totalScore,
  maxScoreWithoutPangram,
  pangramRequiredForWin,
  rankForScore,
  nextRank,
  createState,
  submitGuess,
  sortedFound,
  isComplete,
  finish,
  didWin,
  shareText,
  hintStats,
  useHints,
} from "./core.js";

const PUZZLE = {
  letters: "PLANETS",
  center: "A",
  words: ["plant", "plate", "petal", "plants", "atlas", "planets", "sale", "salt", "leap"],
  maxScore: wordScoreSum(),
};

function wordScoreSum() {
  const words = ["plant", "plate", "petal", "plants", "atlas", "planets", "sale", "salt", "leap"];
  return words.reduce((sum, w) => sum + wordScore(w, "PLANETS"), 0);
}

test("normalizeWord lowercases and strips non-letters", () => {
  assert.equal(normalizeWord("  PlAnT! "), "plant");
  assert.equal(normalizeWord(""), "");
});

test("isPangram requires every puzzle letter present at least once", () => {
  assert.equal(isPangram("planets", "PLANETS"), true);
  assert.equal(isPangram("plant", "PLANETS"), false);
});

test("wordScore: 4 letters is 1 point, longer words score their length", () => {
  assert.equal(wordScore("leap", "PLANETS"), 1);
  assert.equal(wordScore("plate", "PLANETS"), 5);
  assert.equal(wordScore("plant", "PLANETS"), 5);
});

test("wordScore adds a 7 point pangram bonus", () => {
  assert.equal(wordScore("planets", "PLANETS"), 7 + 7);
});

test("wordScore is 0 for words under 4 letters", () => {
  assert.equal(wordScore("pat", "PLANETS"), 0);
});

test("legalShape rejects short words, foreign letters, and missing center", () => {
  assert.equal(legalShape("cat", PUZZLE).ok, false);
  assert.equal(legalShape("cat", PUZZLE).reason, "too-short");
  assert.equal(legalShape("zebra", PUZZLE).reason, "bad-letters");
  assert.equal(legalShape("nest", PUZZLE).reason, "missing-center");
  assert.equal(legalShape("plate", PUZZLE).ok, true);
});

test("legalShape ignores casing", () => {
  assert.equal(legalShape("PLATE", PUZZLE).ok, true);
});

test("totalScore sums scores of the found words only", () => {
  assert.equal(totalScore(["plate", "leap"], "PLANETS"), 5 + 1);
  assert.equal(totalScore([], "PLANETS"), 0);
});

test("rankForScore returns Newcomer at 0 and climbs with the score", () => {
  assert.equal(rankForScore(0, 100).name, "Newcomer");
  assert.equal(rankForScore(100, 100).name, "Luminary");
  assert.equal(rankForScore(70, 100).name, "Master");
  assert.equal(rankForScore(69, 100).name, "Superb");
  assert.equal(rankForScore(39, 100).name, "Strong");
});

test("rankForScore never returns a rank above what the score qualifies for", () => {
  for (const rank of RANKS) {
    const score = Math.floor(rank.pct * 100);
    const result = rankForScore(score, 100);
    const resultIdx = RANKS.findIndex((r) => r.name === result.name);
    const rankIdx = RANKS.findIndex((r) => r.name === rank.name);
    assert.ok(resultIdx <= rankIdx || score >= rank.pct * 100);
  }
});

test("nextRank returns null once Luminary is reached", () => {
  assert.equal(nextRank(100, 100), null);
  assert.equal(nextRank(0, 100).name, "Beginner");
});

test("maxScoreWithoutPangram sums every non-pangram word, pangrams excluded", () => {
  // PUZZLE's only pangram is "planets" (14 pts); everything else is non-pangram.
  const expected = PUZZLE.maxScore - wordScore("planets", "PLANETS");
  assert.equal(maxScoreWithoutPangram(PUZZLE), expected);
});

test("pangramRequiredForWin: false for an easy-shaped puzzle where non-pangram words alone clear Master", () => {
  // 9 plain words worth plenty on their own, one small pangram bonus on top.
  const easyPuzzle = {
    letters: "PLANETS",
    center: "A",
    words: ["plant", "plate", "petal", "atlas", "salt", "leap", "tale", "seal", "pants", "steal", "planets"],
    maxScore: 0,
  };
  easyPuzzle.maxScore = easyPuzzle.words.reduce((s, w) => s + wordScore(w, easyPuzzle.letters), 0);
  assert.equal(pangramRequiredForWin(easyPuzzle), false);
});

test("pangramRequiredForWin: true for a hard-shaped puzzle where the pangram is required", () => {
  // Only the pangram is a valid word: finding everything except it is 0 points.
  const hardPuzzle = { letters: "PLANETS", center: "A", words: ["planets"], maxScore: 0 };
  hardPuzzle.maxScore = wordScore("planets", hardPuzzle.letters);
  assert.equal(pangramRequiredForWin(hardPuzzle), true);
});

test("submitGuess accepts a valid answer-list word and updates state immutably", () => {
  const state = createState();
  const { state: next, result } = submitGuess(PUZZLE, state, "plate");
  assert.equal(result.ok, true);
  assert.equal(result.score, 5);
  assert.equal(result.pangram, false);
  assert.deepEqual(state.found, []);
  assert.deepEqual(next.found, ["plate"]);
});

test("submitGuess flags the pangram bonus", () => {
  const { result } = submitGuess(PUZZLE, createState(), "planets");
  assert.equal(result.ok, true);
  assert.equal(result.pangram, true);
  assert.equal(result.score, 14);
});

test("submitGuess rejects words not in the puzzle's answer list", () => {
  const { result } = submitGuess(PUZZLE, createState(), "plans");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "not-in-list");
});

test("submitGuess rejects a repeat find", () => {
  const first = submitGuess(PUZZLE, createState(), "plate");
  const second = submitGuess(PUZZLE, first.state, "plate");
  assert.equal(second.result.ok, false);
  assert.equal(second.result.reason, "already-found");
  assert.equal(second.state.found.length, 1);
});

test("submitGuess accepts case-insensitively and normalizes storage", () => {
  const { state, result } = submitGuess(PUZZLE, createState(), "  PLATE ");
  assert.equal(result.ok, true);
  assert.deepEqual(state.found, ["plate"]);
});

test("sortedFound returns an alphabetized copy without mutating state", () => {
  const state = { found: ["salt", "leap", "atlas"], finished: false };
  assert.deepEqual(sortedFound(state), ["atlas", "leap", "salt"]);
  assert.deepEqual(state.found, ["salt", "leap", "atlas"]);
});

test("isComplete is true once every answer word has been found", () => {
  let state = createState();
  for (const w of PUZZLE.words) {
    state = submitGuess(PUZZLE, state, w).state;
  }
  assert.equal(isComplete(PUZZLE, state), true);
  assert.equal(isComplete(PUZZLE, createState()), false);
});

test("finish marks state finished without touching found words", () => {
  const state = submitGuess(PUZZLE, createState(), "plate").state;
  const finished = finish(state);
  assert.equal(finished.finished, true);
  assert.deepEqual(finished.found, state.found);
});

test("didWin requires reaching WIN_RANK's percent of maxScore", () => {
  assert.equal(WIN_RANK, "Master");
  let state = createState();
  assert.equal(didWin(PUZZLE, state), false);
  for (const w of PUZZLE.words) {
    state = submitGuess(PUZZLE, state, w).state;
  }
  assert.equal(didWin(PUZZLE, state), true);
});

test("shareText has no spoilers and is ASCII only", () => {
  const state = submitGuess(PUZZLE, createState(), "plate").state;
  const text = shareText(PUZZLE, state, "Aug 10");
  assert.ok(!text.includes("plate"));
  assert.ok(!/[^\x00-\x7f]/.test(text));
  assert.ok(text.includes("Words: 1/9"));
});

test("shareText defaults to Medium and includes the given difficulty word", () => {
  const state = createState();
  assert.ok(shareText(PUZZLE, state, "Aug 10").includes("Heptagram Medium - Aug 10"));
  assert.ok(shareText(PUZZLE, state, "Aug 10", "Hard").includes("Heptagram Hard - Aug 10"));
});

test("shareText notes hint usage only when hints were opened", () => {
  const state = createState();
  assert.ok(!shareText(PUZZLE, state, "Aug 10").includes("used hints"));
  assert.ok(shareText(PUZZLE, useHints(state), "Aug 10").includes("used hints"));
});

test("hintStats counts words by first letter and length, and by two-letter start", () => {
  const stats = hintStats(PUZZLE);
  assert.equal(stats.byLetterLength.P[5], 3); // plant, plate, petal
  assert.equal(stats.byLetterLength.P[6], 1); // plants
  assert.equal(stats.byLetterLength.P[7], 1); // planets
  assert.equal(stats.twoLetterStarts.PL, 4); // plant, plate, plants, planets
  assert.equal(stats.twoLetterStarts.SA, 2); // sale, salt
});

test("hintStats total word count across the table matches the puzzle's answer count", () => {
  const stats = hintStats(PUZZLE);
  let total = 0;
  for (const lengths of Object.values(stats.byLetterLength)) {
    for (const count of Object.values(lengths)) total += count;
  }
  assert.equal(total, PUZZLE.words.length);
});

test("useHints is idempotent and does not mutate the input state", () => {
  const state = createState();
  const once = useHints(state);
  const twice = useHints(once);
  assert.equal(state.usedHints, false);
  assert.equal(once.usedHints, true);
  assert.equal(twice, once);
});
