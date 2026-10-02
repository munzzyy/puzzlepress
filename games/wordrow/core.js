/*
  Wordrow core: pure game logic, zero DOM. Everything here takes and returns
  plain data so game.js and the test suite can drive it identically.
*/

export const WORD_LENGTH = 5;
export const MAX_GUESSES = 6; // default guess count; easy overrides to 7 via createGame

const STATE_RANK = { absent: 0, present: 1, correct: 2 };

/**
 * Evaluates one guess against the answer, classic two-pass duplicate-letter
 * handling: exact matches are claimed first, then leftover letters are
 * matched against whatever remains of the answer's letter pool.
 */
export function evaluateGuess(guess, answer) {
  const g = guess.toLowerCase().split("");
  const a = answer.toLowerCase().split("");
  const result = new Array(g.length).fill("absent");
  const pool = {};

  for (let i = 0; i < a.length; i++) {
    if (g[i] === a[i]) continue;
    pool[a[i]] = (pool[a[i]] || 0) + 1;
  }

  for (let i = 0; i < g.length; i++) {
    if (g[i] === a[i]) result[i] = "correct";
  }

  for (let i = 0; i < g.length; i++) {
    if (result[i] === "correct") continue;
    const letter = g[i];
    if (pool[letter] > 0) {
      result[i] = "present";
      pool[letter] -= 1;
    }
  }

  return result;
}

/**
 * Best state seen for each letter across all guesses so far, correct beats
 * present beats absent. Used to color the on-screen keyboard.
 */
export function keyboardStates(guesses, evaluations) {
  const states = {};
  for (let i = 0; i < guesses.length; i++) {
    const guess = guesses[i];
    const evaluation = evaluations[i];
    for (let j = 0; j < guess.length; j++) {
      const letter = guess[j].toLowerCase();
      const state = evaluation[j];
      if (!states[letter] || STATE_RANK[state] > STATE_RANK[states[letter]]) {
        states[letter] = state;
      }
    }
  }
  return states;
}

/**
 * Hard mode: any letter revealed correct must be reused in the same spot,
 * any letter revealed present must appear somewhere in the new guess.
 * Returns null when the guess is fine, or a human-readable reason.
 */
export function hardModeViolation(guess, previousGuesses, previousEvaluations) {
  if (previousGuesses.length === 0) return null;
  const lastGuess = previousGuesses[previousGuesses.length - 1];
  const lastEval = previousEvaluations[previousEvaluations.length - 1];
  const g = guess.toLowerCase().split("");

  for (let i = 0; i < lastGuess.length; i++) {
    if (lastEval[i] === "correct" && g[i] !== lastGuess[i]) {
      return `Position ${i + 1} must be ${lastGuess[i].toUpperCase()}`;
    }
  }

  for (let i = 0; i < lastGuess.length; i++) {
    if (lastEval[i] === "present" && !g.includes(lastGuess[i])) {
      return `Guess must include ${lastGuess[i].toUpperCase()}`;
    }
  }

  return null;
}

export function createGame(answer, opts = {}) {
  return {
    answer: answer.toLowerCase(),
    guesses: [],
    evaluations: [],
    status: "playing",
    hardMode: Boolean(opts.hardMode),
    maxGuesses: opts.maxGuesses || MAX_GUESSES,
  };
}

/**
 * Attempts to submit `guess`. Returns { state, error }. On failure the
 * original state is returned unchanged so callers never mutate on error.
 */
export function submitGuess(state, guess, opts = {}) {
  const allowed = opts.allowed || null;
  const clean = String(guess || "").toLowerCase();

  if (state.status !== "playing") {
    return { state, error: "Game is over" };
  }
  if (clean.length !== WORD_LENGTH) {
    return { state, error: "Not enough letters" };
  }
  if (!/^[a-z]+$/.test(clean)) {
    return { state, error: "Letters only" };
  }
  if (allowed && !allowed.has(clean)) {
    return { state, error: "Not in word list" };
  }
  if (state.hardMode) {
    const violation = hardModeViolation(clean, state.guesses, state.evaluations);
    if (violation) {
      return { state, error: violation };
    }
  }

  const evaluation = evaluateGuess(clean, state.answer);
  const guesses = [...state.guesses, clean];
  const evaluations = [...state.evaluations, evaluation];
  const won = clean === state.answer;
  const outOfGuesses = guesses.length >= (state.maxGuesses || MAX_GUESSES);
  const status = won ? "won" : outOfGuesses ? "lost" : "playing";

  return {
    state: { ...state, guesses, evaluations, status },
    error: null,
  };
}

export function isGameOver(state) {
  return state.status === "won" || state.status === "lost";
}

const SHARE_GLYPH = { correct: "\u{1F7E6}", present: "\u{1F7E7}", absent: "⬛" };
const SHARE_GLYPH_HIGH_CONTRAST = { correct: "\u{1F7E7}", present: "\u{1F7E6}", absent: "⬛" };

/**
 * Spoiler-free share text: title, difficulty word, day number, guess count,
 * hard-mode mark, then the emoji grid. No letters ever appear in the output.
 * opts.diffLabel (e.g. "Easy"/"Medium"/"Hard") is required by the contract
 * ("Wordrow Hard #3 4/6"); omitted entirely when not supplied (random play).
 * opts.highContrast swaps which square stands for correct vs present, to
 * match the player's on-screen high-contrast setting.
 */
export function shareText(state, opts = {}) {
  const dayNumber = opts.dayNumber != null ? opts.dayNumber : "?";
  const maxGuesses = state.maxGuesses || MAX_GUESSES;
  const score = state.status === "won" ? String(state.guesses.length) : "X";
  const mark = state.hardMode ? "*" : "";
  const label = opts.diffLabel ? `${opts.diffLabel} ` : "";
  const glyphs = opts.highContrast ? SHARE_GLYPH_HIGH_CONTRAST : SHARE_GLYPH;
  const grid = state.evaluations
    .map((row) => row.map((cell) => glyphs[cell]).join(""))
    .join("\n");

  return `Wordrow ${label}#${dayNumber} ${score}/${maxGuesses}${mark}\n\n${grid}`;
}

/** Guesses the game accepts: the allowed list minus blocked words. Answers come from a separate list. */
export function guessList(allowed, blocked) {
  return new Set(allowed.filter((w) => !blocked.has(w)));
}
