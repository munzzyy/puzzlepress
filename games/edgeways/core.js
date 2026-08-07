/*
  Edgeways pure logic. No DOM, no globals, no imports. Everything here works
  the same in a browser tab or a test runner.

  A puzzle is { sides: ["ABC","DEF","GHI","JKL"], par: 2, solution: [...] }.
  Twelve letters sit on four sides, three per side. A word is a chain of
  letters where no two letters in a row share a side. Each new word must
  start with the letter the previous word ended on. The puzzle is solved
  once every one of the twelve letters has appeared in some accepted word.
*/

export const MIN_WORD_LENGTH = 3;

function up(s) {
  return String(s).toUpperCase();
}

/** Map from letter -> side index (0-3), built from a sides array. */
export function sideIndexMap(sides) {
  const map = new Map();
  sides.forEach((side, i) => {
    for (const ch of up(side)) map.set(ch, i);
  });
  return map;
}

/** All twelve letters on the board, in side order. */
export function allLetters(sides) {
  return up(sides.join("")).split("");
}

/**
 * Checks a candidate word against the board shape alone: minimum length,
 * every letter present on the board, and no two consecutive letters
 * sharing a side. Does not check the chain rule or the dictionary.
 */
export function validateWordShape(word, sides) {
  const w = up(word);
  if (w.length < MIN_WORD_LENGTH) {
    return { ok: false, reason: "short" };
  }
  const sideMap = sideIndexMap(sides);
  for (const ch of w) {
    if (!sideMap.has(ch)) return { ok: false, reason: "off-board" };
  }
  for (let i = 0; i < w.length - 1; i++) {
    if (sideMap.get(w[i]) === sideMap.get(w[i + 1])) {
      return { ok: false, reason: "same-side" };
    }
  }
  return { ok: true };
}

/** True if `word` may legally follow `previousWord` (or start the chain). */
export function canChainFrom(word, previousWord) {
  if (!previousWord) return true;
  const w = up(word);
  const p = up(previousWord);
  return w[0] === p[p.length - 1];
}

/**
 * True if `letter` may be appended to the in-progress `buffer` (an array of
 * letters for the word currently being built). An empty buffer accepts any
 * on-board letter; the caller is responsible for seeding the buffer with
 * the chain-required starting letter between words.
 */
export function canAppendLetter(buffer, letter, sides) {
  const sideMap = sideIndexMap(sides);
  const L = up(letter);
  if (!sideMap.has(L)) return false;
  if (buffer.length === 0) return true;
  const last = up(buffer[buffer.length - 1]);
  return sideMap.get(last) !== sideMap.get(L);
}

/** Distinct letters used across a list of accepted words, as a Set. */
export function lettersUsed(words) {
  const set = new Set();
  for (const w of words) for (const ch of up(w)) set.add(ch);
  return set;
}

/** True once every letter on the board has appeared in an accepted word. */
export function isSolved(words, sides) {
  const used = lettersUsed(words);
  return allLetters(sides).every((ch) => used.has(ch));
}

/**
 * Attempts to accept `rawWord` given the words already accepted.
 * `dictionary` is an optional Set/object with a `.has(lowercaseWord)`
 * method; when omitted, dictionary membership is not checked (useful for
 * generator self-checks). Returns either
 *   { ok:false, reason }
 * or
 *   { ok:true, words: [...words, word], word, solved }
 * and never mutates the input array.
 */
export function submitWord(words, rawWord, sides, dictionary) {
  const w = up(rawWord).trim();
  if (!w) return { ok: false, reason: "empty" };

  const shape = validateWordShape(w, sides);
  if (!shape.ok) return shape;

  const previous = words.length ? words[words.length - 1] : null;
  if (!canChainFrom(w, previous)) return { ok: false, reason: "chain" };

  if (dictionary && !dictionary.has(w.toLowerCase())) {
    return { ok: false, reason: "unknown-word" };
  }

  const nextWords = [...words, w];
  return { ok: true, word: w, words: nextWords, solved: isSolved(nextWords, sides) };
}

/** Number of the twelve board letters covered so far (0-12). */
export function progressCount(words, sides) {
  return lettersUsed(words).size;
}

/**
 * The letter a new word must begin with, or null if no word has been
 * accepted yet and any on-board letter may start the chain.
 */
export function requiredStartLetter(words) {
  if (!words.length) return null;
  const last = up(words[words.length - 1]);
  return last[last.length - 1];
}

/** Structured result summary used to build share text. */
export function resultSummary(words, par) {
  const count = words.length;
  return { count, par, underPar: count <= par, delta: count - par };
}
