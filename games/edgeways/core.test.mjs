import test from "node:test";
import assert from "node:assert/strict";

import {
  sideIndexMap,
  allLetters,
  validateWordShape,
  canChainFrom,
  canAppendLetter,
  lettersUsed,
  isSolved,
  submitWord,
  progressCount,
  requiredStartLetter,
  resultSummary,
} from "./core.js";

const SIDES = ["ABC", "DEF", "GHI", "JKL"];

test("sideIndexMap assigns each letter its side index", () => {
  const map = sideIndexMap(SIDES);
  assert.equal(map.get("A"), 0);
  assert.equal(map.get("F"), 1);
  assert.equal(map.get("I"), 2);
  assert.equal(map.get("L"), 3);
  assert.equal(map.size, 12);
});

test("allLetters lists all twelve board letters in side order", () => {
  assert.deepEqual(allLetters(SIDES), "ABCDEFGHIJKL".split(""));
});

test("validateWordShape rejects words shorter than three letters", () => {
  assert.equal(validateWordShape("AD", SIDES).ok, false);
  assert.equal(validateWordShape("AD", SIDES).reason, "short");
});

test("validateWordShape rejects letters not on the board", () => {
  const result = validateWordShape("ADZ", SIDES);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "off-board");
});

test("validateWordShape rejects two consecutive letters on the same side", () => {
  const result = validateWordShape("ABD", SIDES); // A and B are both side 0
  assert.equal(result.ok, false);
  assert.equal(result.reason, "same-side");
});

test("validateWordShape accepts a word that jumps sides every letter", () => {
  assert.equal(validateWordShape("ADGJ", SIDES).ok, true);
});

test("validateWordShape is case-insensitive", () => {
  assert.equal(validateWordShape("adgj", SIDES).ok, true);
});

test("canChainFrom allows any word when there is no previous word", () => {
  assert.equal(canChainFrom("ADGJ", null), true);
});

test("canChainFrom requires the previous word's last letter", () => {
  assert.equal(canChainFrom("JBEHK", "ADGJ"), true);
  assert.equal(canChainFrom("ABCDEF", "ADGJ"), false);
});

test("canAppendLetter allows any on-board letter into an empty buffer", () => {
  assert.equal(canAppendLetter([], "G", SIDES), true);
  assert.equal(canAppendLetter([], "Z", SIDES), false);
});

test("canAppendLetter blocks a letter sharing the previous letter's side", () => {
  assert.equal(canAppendLetter(["A"], "B", SIDES), false); // both side 0
  assert.equal(canAppendLetter(["A"], "D", SIDES), true); // side 0 -> side 1
});

test("lettersUsed dedupes across multiple words", () => {
  const used = lettersUsed(["ADGJ", "JBEHK"]);
  assert.equal(used.size, 8);
  assert.ok(used.has("A"));
  assert.ok(used.has("K"));
});

test("isSolved is false until every board letter has appeared", () => {
  assert.equal(isSolved(["ADGJ", "JBEHK"], SIDES), false);
  assert.equal(isSolved(["ADGJ", "JBEHK", "KCFIL"], SIDES), true);
});

test("submitWord rejects a malformed word without touching the word list", () => {
  const result = submitWord([], "AB", SIDES);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "short");
});

test("submitWord rejects a word that breaks the chain", () => {
  const result = submitWord(["ADGJ"], "BEHK", SIDES); // valid shape, wrong start letter
  assert.equal(result.ok, false);
  assert.equal(result.reason, "chain");
});

test("submitWord rejects a word missing from the dictionary", () => {
  const dictionary = new Set(["adgj"]);
  const result = submitWord([], "JBEHK", SIDES, dictionary); // valid shape, not in dictionary
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unknown-word");
});

test("submitWord accepts a valid, dictionary-known word and reports partial progress", () => {
  const dictionary = new Set(["adgj"]);
  const result = submitWord([], "ADGJ", SIDES, dictionary);
  assert.equal(result.ok, true);
  assert.deepEqual(result.words, ["ADGJ"]);
  assert.equal(result.solved, false);
});

test("submitWord reports solved once the final word completes coverage", () => {
  const dictionary = new Set(["adgj", "jbehk", "kcfil"]);
  let words = [];
  let step = submitWord(words, "ADGJ", SIDES, dictionary);
  assert.equal(step.ok, true);
  words = step.words;
  step = submitWord(words, "JBEHK", SIDES, dictionary);
  assert.equal(step.ok, true);
  assert.equal(step.solved, false);
  words = step.words;
  step = submitWord(words, "KCFIL", SIDES, dictionary);
  assert.equal(step.ok, true);
  assert.equal(step.solved, true);
});

test("submitWord without a dictionary skips the word-list check", () => {
  const result = submitWord([], "ADGJ", SIDES);
  assert.equal(result.ok, true);
});

test("progressCount tracks how many of the twelve letters are covered", () => {
  assert.equal(progressCount([], SIDES), 0);
  assert.equal(progressCount(["ADGJ"], SIDES), 4);
  assert.equal(progressCount(["ADGJ", "JBEHK"], SIDES), 8);
});

test("requiredStartLetter is null before any word, then the chain letter", () => {
  assert.equal(requiredStartLetter([]), null);
  assert.equal(requiredStartLetter(["ADGJ"]), "J");
  assert.equal(requiredStartLetter(["ADGJ", "JBEHK"]), "K");
});

test("resultSummary reports par comparison", () => {
  assert.deepEqual(resultSummary(["ADGJ", "JBEHK"], 2), {
    count: 2,
    par: 2,
    underPar: true,
    delta: 0,
  });
  assert.deepEqual(resultSummary(["ADGJ", "JBEHK", "KCFIL"], 2), {
    count: 3,
    par: 2,
    underPar: false,
    delta: 1,
  });
});
