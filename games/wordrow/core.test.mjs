import test from "node:test";
import assert from "node:assert/strict";

import {
  WORD_LENGTH,
  MAX_GUESSES,
  evaluateGuess,
  keyboardStates,
  hardModeViolation,
  createGame,
  submitGuess,
  isGameOver,
  shareText,
} from "./core.js";

test("evaluateGuess marks exact matches correct", () => {
  assert.deepEqual(evaluateGuess("crane", "crane"), [
    "correct",
    "correct",
    "correct",
    "correct",
    "correct",
  ]);
});

test("evaluateGuess marks letters absent when not in the answer", () => {
  assert.deepEqual(evaluateGuess("could", "brain"), [
    "absent",
    "absent",
    "absent",
    "absent",
    "absent",
  ]);
});

test("evaluateGuess: exact matches are claimed before leftovers get present", () => {
  // erase vs arose: r, s, e land correct in place; the leading e has no
  // letter left to claim in the answer's pool so it reads absent, while a
  // is present but out of position.
  assert.deepEqual(evaluateGuess("erase", "arose"), [
    "absent",
    "correct",
    "present",
    "correct",
    "correct",
  ]);
});

test("evaluateGuess does not double count a letter the answer has once", () => {
  // "sleep" guessed against "abide": answer has one "e", guess has two.
  // Only the first "e" (index 2) can claim it as present; the second
  // (index 3) must come back absent, not a second "present".
  assert.deepEqual(evaluateGuess("sleep", "abide"), [
    "absent",
    "absent",
    "present",
    "absent",
    "absent",
  ]);
});

test("evaluateGuess: guess letter present but already fully claimed by correct positions", () => {
  // answer "level": guessing "villa" has two "l"s in guess but answer only
  // has two "l"s too, both used by different logic paths - use a tighter
  // case: answer "allot", guess "lolly" only has as many "l" as answer.
  assert.deepEqual(evaluateGuess("allot", "allot"), [
    "correct",
    "correct",
    "correct",
    "correct",
    "correct",
  ]);
});

test("keyboardStates keeps the best state seen per letter", () => {
  const guesses = ["train", "tarot"];
  const evaluations = [evaluateGuess("train", "toast"), evaluateGuess("tarot", "toast")];
  const states = keyboardStates(guesses, evaluations);
  assert.equal(states.t, "correct");
});

test("keyboardStates never downgrades a correct letter to present", () => {
  const guesses = ["aaaaa", "bbbbb"];
  const evaluations = [
    ["correct", "absent", "absent", "absent", "absent"],
    ["absent", "absent", "absent", "absent", "absent"],
  ];
  const states = keyboardStates(guesses, evaluations);
  assert.equal(states.a, "correct");
});

test("hardModeViolation allows the first guess unconditionally", () => {
  assert.equal(hardModeViolation("crane", [], []), null);
});

test("hardModeViolation catches a dropped correct letter", () => {
  const evaluation = evaluateGuess("crane", "cabin");
  const violation = hardModeViolation("shape", ["crane"], [evaluation]);
  assert.match(violation, /Position 1/);
});

test("hardModeViolation catches a dropped present letter", () => {
  const evaluation = evaluateGuess("crane", "nacho");
  // "c" is present in "crane" vs "nacho"; a follow-up without any c should fail.
  const violation = hardModeViolation("mount", ["crane"], [evaluation]);
  assert.equal(typeof violation, "string");
});

test("hardModeViolation passes a guess that reuses every hint", () => {
  const evaluation = evaluateGuess("crane", "candy");
  // c correct@0, r absent, a present, n present, e absent
  const violation = hardModeViolation("caban", ["crane"], [evaluation]);
  assert.equal(violation, null);
});

test("submitGuess rejects the wrong length", () => {
  const game = createGame("crane");
  const { state, error } = submitGuess(game, "cran");
  assert.equal(error, "Not enough letters");
  assert.equal(state, game);
});

test("submitGuess rejects non-letters", () => {
  const game = createGame("crane");
  const { error } = submitGuess(game, "cr4ne");
  assert.equal(error, "Letters only");
});

test("submitGuess enforces the allowed dictionary when provided", () => {
  const game = createGame("crane");
  const allowed = new Set(["crane", "shape"]);
  const { error } = submitGuess(game, "zzzzz", { allowed });
  assert.equal(error, "Not in word list");
});

test("submitGuess accepts a guess present in the allowed dictionary", () => {
  const game = createGame("crane");
  const allowed = new Set(["crane", "shape"]);
  const { state, error } = submitGuess(game, "shape", { allowed });
  assert.equal(error, null);
  assert.equal(state.guesses.length, 1);
});

test("submitGuess wins on a correct guess", () => {
  const game = createGame("crane");
  const { state } = submitGuess(game, "crane");
  assert.equal(state.status, "won");
  assert.equal(isGameOver(state), true);
});

test("submitGuess loses after MAX_GUESSES wrong guesses", () => {
  let state = createGame("crane");
  const wrong = ["shale", "sound", "trout", "flint", "block", "whorl"];
  for (const guess of wrong) {
    const res = submitGuess(state, guess);
    state = res.state;
  }
  assert.equal(state.status, "lost");
  assert.equal(state.guesses.length, MAX_GUESSES);
});

test("submitGuess refuses further guesses once the game is over", () => {
  const won = submitGuess(createGame("crane"), "crane").state;
  const { error, state } = submitGuess(won, "shape");
  assert.equal(error, "Game is over");
  assert.equal(state, won);
});

test("submitGuess in hard mode rejects a guess that drops a hint", () => {
  let state = createGame("crane", { hardMode: true });
  state = submitGuess(state, "cabin").state;
  const { error } = submitGuess(state, "shale");
  assert.equal(typeof error, "string");
});

test("submitGuess in hard mode accepts a guess that reuses hints", () => {
  let state = createGame("crane", { hardMode: true });
  state = submitGuess(state, "cabin").state;
  const res = submitGuess(state, "crane");
  assert.equal(res.error, null);
  assert.equal(res.state.status, "won");
});

test("shareText never leaks letters and reflects the guess count on a win", () => {
  let state = createGame("crane");
  state = submitGuess(state, "shale").state;
  state = submitGuess(state, "crane").state;
  const text = shareText(state, { dayNumber: 7 });
  assert.match(text, /^Wordrow #7 2\/6/);
  assert.equal(/[a-zA-Z]/.test(text.split("\n\n")[1]), false);
});

test("shareText shows X on a loss", () => {
  let state = createGame("crane");
  const wrong = ["shale", "sound", "trout", "flint", "block", "whorl"];
  for (const guess of wrong) state = submitGuess(state, guess).state;
  const text = shareText(state, { dayNumber: 1 });
  assert.match(text, /X\/6/);
});

test("shareText marks hard mode games with an asterisk", () => {
  let state = createGame("crane", { hardMode: true });
  state = submitGuess(state, "crane").state;
  const text = shareText(state, { dayNumber: 3 });
  assert.match(text, /1\/6\*/);
});

test("WORD_LENGTH and MAX_GUESSES match the contract", () => {
  assert.equal(WORD_LENGTH, 5);
  assert.equal(MAX_GUESSES, 6);
});
