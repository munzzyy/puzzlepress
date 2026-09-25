/*
  Heptagram core logic. Pure: no DOM, no globals, no storage. game.js wires
  this to the page; core.test.mjs exercises it directly.

  Puzzle shape: { letters: "ABCDEFG", center: "A", words: [...], maxScore }
  letters and center are stored uppercase; words are stored lowercase and are
  the exact accepted-answer set for that puzzle (a player's guess only counts
  if it appears there, not merely because it "looks" legal).
*/

export const RANKS = [
  { name: "Newcomer", pct: 0 },
  { name: "Beginner", pct: 0.02 },
  { name: "Apprentice", pct: 0.05 },
  { name: "Fair", pct: 0.08 },
  { name: "Skilled", pct: 0.15 },
  { name: "Strong", pct: 0.25 },
  { name: "Excellent", pct: 0.4 },
  { name: "Superb", pct: 0.5 },
  { name: "Master", pct: 0.7 },
  { name: "Luminary", pct: 1 },
];

/** Reaching this rank marks the day as won for streak purposes. */
export const WIN_RANK = "Master";

export function normalizeWord(raw) {
  return String(raw || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function letterSet(letters) {
  return new Set(String(letters).toLowerCase().split(""));
}

/** Does the word use all seven puzzle letters at least once? */
export function isPangram(word, letters) {
  const set = letterSet(letters);
  const w = new Set(word.toLowerCase().split(""));
  for (const ch of set) {
    if (!w.has(ch)) return false;
  }
  return true;
}

/** 4-letter words score 1 point, longer words score their length, pangrams add 7. */
export function wordScore(word, letters) {
  const w = normalizeWord(word);
  if (w.length < 4) return 0;
  const base = w.length === 4 ? 1 : w.length;
  return base + (isPangram(w, letters) ? 7 : 0);
}

/** Shape check only: length, allowed letters, center letter. Ignores the answer list. */
export function legalShape(word, puzzle) {
  const w = normalizeWord(word);
  if (w.length < 4) return { ok: false, reason: "too-short" };
  const allowed = letterSet(puzzle.letters);
  for (const ch of w) {
    if (!allowed.has(ch)) return { ok: false, reason: "bad-letters" };
  }
  if (!w.includes(puzzle.center.toLowerCase())) {
    return { ok: false, reason: "missing-center" };
  }
  return { ok: true };
}

export function totalScore(found, letters) {
  return found.reduce((sum, w) => sum + wordScore(w, letters), 0);
}

/** The puzzle minus any blocked words, with maxScore recomputed so ranks still line up. */
export function withoutBlocked(puzzle, blocked) {
  const words = puzzle.words.filter((w) => !blocked.has(w));
  if (words.length === puzzle.words.length) return puzzle;
  return { ...puzzle, words, maxScore: totalScore(words, puzzle.letters) };
}

/** Total score if every non-pangram word in the puzzle were found, pangrams excluded. */
export function maxScoreWithoutPangram(puzzle) {
  return puzzle.words
    .filter((w) => !isPangram(w, puzzle.letters))
    .reduce((sum, w) => sum + wordScore(w, puzzle.letters), 0);
}

/**
 * True when finding every non-pangram word still falls short of the Master
 * rank threshold, i.e. this puzzle can only be won by finding a pangram.
 * The generator (tools/gen_heptagram.py) enforces this for hard puzzles and
 * its opposite (win reachable without the pangram) for easy ones.
 */
export function pangramRequiredForWin(puzzle) {
  const masterPct = RANKS.find((r) => r.name === WIN_RANK).pct;
  return maxScoreWithoutPangram(puzzle) < masterPct * puzzle.maxScore;
}

/** Highest rank whose threshold the score meets, given the puzzle's maxScore. */
export function rankForScore(score, maxScore) {
  let current = RANKS[0];
  for (const rank of RANKS) {
    if (score >= rank.pct * maxScore) current = rank;
  }
  return current;
}

/** The next rank up, or null if already at the top. */
export function nextRank(score, maxScore) {
  const current = rankForScore(score, maxScore);
  const idx = RANKS.findIndex((r) => r.name === current.name);
  return idx >= 0 && idx < RANKS.length - 1 ? RANKS[idx + 1] : null;
}

export function createState() {
  return { found: [], finished: false, usedHints: false };
}

/**
 * Attempts to add a guess to the state. Returns a fresh state object plus a
 * result describing what happened; never mutates the input.
 */
export function submitGuess(puzzle, state, raw) {
  const word = normalizeWord(raw);
  const shape = legalShape(word, puzzle);

  if (!shape.ok) {
    return { state, result: { ok: false, reason: shape.reason, word } };
  }
  if (state.found.includes(word)) {
    return { state, result: { ok: false, reason: "already-found", word } };
  }
  if (!puzzle.words.includes(word)) {
    return { state, result: { ok: false, reason: "not-in-list", word } };
  }

  const score = wordScore(word, puzzle.letters);
  const pangram = isPangram(word, puzzle.letters);
  const nextState = { ...state, found: [...state.found, word] };
  return { state: nextState, result: { ok: true, word, score, pangram } };
}

export function sortedFound(state) {
  return [...state.found].sort();
}

export function isComplete(puzzle, state) {
  return state.found.length >= puzzle.words.length;
}

export function finish(state) {
  return { ...state, finished: true };
}

/** Reaching WIN_RANK (or better) by the time the day is finished counts as a win. */
export function didWin(puzzle, state) {
  const score = totalScore(state.found, puzzle.letters);
  const rank = rankForScore(score, puzzle.maxScore);
  const winIdx = RANKS.findIndex((r) => r.name === WIN_RANK);
  const rankIdx = RANKS.findIndex((r) => r.name === rank.name);
  return rankIdx >= winIdx;
}

/** Spoiler-free share text: no words revealed, ASCII only. diffLabel e.g. "Hard". */
export function shareText(puzzle, state, dateLabel, diffLabel = "Medium") {
  const score = totalScore(state.found, puzzle.letters);
  const rank = rankForScore(score, puzzle.maxScore);
  const rankIdx = RANKS.findIndex((r) => r.name === rank.name);
  const bar = RANKS.map((_, i) => (i <= rankIdx ? "#" : "-")).join("");
  const hintNote = state.usedHints ? " (used hints)" : "";
  return (
    `Heptagram ${diffLabel} - ${dateLabel}\n` +
    `${rank.name} - ${score} points${hintNote}\n` +
    `Words: ${state.found.length}/${puzzle.words.length}\n` +
    bar
  );
}

/**
 * Word counts for the hints panel: how many answers start with each letter,
 * broken down by length, plus how many share each two-letter start. Built
 * fresh from the puzzle's own answer list, no spoilers beyond counts.
 */
export function hintStats(puzzle) {
  const byLetterLength = {};
  const twoLetterStarts = {};
  for (const word of puzzle.words) {
    const first = word[0].toUpperCase();
    const len = word.length;
    byLetterLength[first] = byLetterLength[first] || {};
    byLetterLength[first][len] = (byLetterLength[first][len] || 0) + 1;
    const two = word.slice(0, 2).toUpperCase();
    twoLetterStarts[two] = (twoLetterStarts[two] || 0) + 1;
  }
  return { byLetterLength, twoLetterStarts };
}

/** Marks a day's puzzle as having had its hints opened. Idempotent. */
export function useHints(state) {
  return state.usedHints ? state : { ...state, usedHints: true };
}
