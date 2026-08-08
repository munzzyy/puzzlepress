/*
  Wordweave pure logic. No DOM, no globals, no imports. game.js drives this
  with grid taps/drags/keystrokes and renders whatever it returns.

  A puzzle is { theme, spangram, words, grid, solution, bonusWords }.
  grid is 8 row-strings of 6 letters. solution maps every theme word (plus
  the spangram) to its exact ordered cell path: [[row,col], ...]. Every
  cell in the grid belongs to exactly one of those paths.
*/

const HINT_BONUS_STEP = 3;
const DIFF_LABELS = { easy: "Easy", medium: "Medium", hard: "Hard" };

/** True if two cells are king-adjacent (any of 8 directions) and distinct. */
export function cellsAdjacent(a, b) {
  const dr = Math.abs(a[0] - b[0]);
  const dc = Math.abs(a[1] - b[1]);
  return dr <= 1 && dc <= 1 && (dr !== 0 || dc !== 0);
}

/** True if cells form a legal chain: in bounds, no repeats, each step adjacent. */
export function isValidChain(cells, rows, cols) {
  if (!Array.isArray(cells) || cells.length === 0) return false;
  const seen = new Set();
  for (let i = 0; i < cells.length; i++) {
    const [r, c] = cells[i];
    if (r < 0 || r >= rows || c < 0 || c >= cols) return false;
    const key = `${r},${c}`;
    if (seen.has(key)) return false;
    seen.add(key);
    if (i > 0 && !cellsAdjacent(cells[i - 1], cells[i])) return false;
  }
  return true;
}

/** Reads the letters a chain of cells spells out of the grid. */
export function wordFromChain(grid, cells) {
  return cells.map(([r, c]) => grid[r][c]).join("");
}

function cellsEqual(a, b) {
  return a.length === b.length && a.every(([r, c], i) => r === b[i][0] && c === b[i][1]);
}

/** Cell paths match forwards or reversed (a chain can be dragged either way). */
export function chainsEqual(a, b) {
  return cellsEqual(a, b) || cellsEqual(a, b.slice().reverse());
}

function gridDims(puzzle) {
  return { rows: puzzle.grid.length, cols: puzzle.grid[0].length };
}

/** Fresh, empty game state for a puzzle. */
export function createState() {
  return {
    found: {}, // word -> { cells, type: 'spangram' | 'theme' | 'hint' }
    bonusFound: [],
    hintsUsedCount: 0,
    complete: false,
  };
}

function cloneState(state) {
  return {
    found: { ...state.found },
    bonusFound: state.bonusFound.slice(),
    hintsUsedCount: state.hintsUsedCount,
    complete: state.complete,
  };
}

/** All theme words + spangram this puzzle asks for. */
export function allTargetWords(puzzle) {
  return [puzzle.spangram, ...puzzle.words];
}

export function remainingWords(puzzle, state) {
  return allTargetWords(puzzle).filter((w) => !state.found[w]);
}

export function isComplete(puzzle, state) {
  return remainingWords(puzzle, state).length === 0;
}

/** Hint charges earned so far but not yet spent, from bonus-word finds. */
export function hintChargesAvailable(state) {
  return Math.floor(state.bonusFound.length / HINT_BONUS_STEP) - state.hintsUsedCount;
}

/**
 * Submits a candidate chain of [row,col] cells. Returns { state, result }
 * without mutating the input state. result.status is one of:
 * 'spangram' | 'theme' | 'bonus' | 'already-found' | 'invalid'.
 */
export function submitChain(puzzle, state, cells) {
  const { rows, cols } = gridDims(puzzle);
  if (!isValidChain(cells, rows, cols)) {
    return { state, result: { status: "invalid" } };
  }

  const spelled = wordFromChain(puzzle.grid, cells);
  const backwards = spelled.split("").reverse().join("");
  const next = cloneState(state);
  const targets = [puzzle.spangram, ...puzzle.words];
  const word = targets.includes(spelled) ? spelled : targets.includes(backwards) ? backwards : null;

  if (word) {
    if (state.found[word]) {
      return { state, result: { status: "already-found", word } };
    }
    const officialCells = puzzle.solution[word];
    if (!chainsEqual(cells, officialCells)) {
      return { state, result: { status: "invalid" } };
    }
    const type = word === puzzle.spangram ? "spangram" : "theme";
    next.found[word] = { cells: officialCells, type };
    next.complete = isComplete(puzzle, next);
    return { state: next, result: { status: type, word, complete: next.complete } };
  }

  const bonusList = puzzle.bonusWords || [];
  const bonusWord = bonusList.includes(spelled) ? spelled : bonusList.includes(backwards) ? backwards : null;
  if (bonusWord) {
    if (state.bonusFound.includes(bonusWord)) {
      return { state, result: { status: "already-found", word: bonusWord } };
    }
    next.bonusFound.push(bonusWord);
    return {
      state: next,
      result: { status: "bonus", word: bonusWord, hintCharges: hintChargesAvailable(next) },
    };
  }

  return { state, result: { status: "invalid" } };
}

/**
 * Spends one hint charge to reveal a remaining theme word (never the
 * spangram; that reveal is the player's moment). Picks the shortest
 * remaining word so a hint never accidentally hands over the whole board.
 */
export function useHint(puzzle, state) {
  if (hintChargesAvailable(state) < 1) {
    return { state, result: { status: "no-hint" } };
  }
  const candidates = puzzle.words.filter((w) => !state.found[w]);
  if (candidates.length === 0) {
    return { state, result: { status: "no-target" } };
  }
  const target = candidates.slice().sort((a, b) => a.length - b.length)[0];
  const next = cloneState(state);
  next.found[target] = { cells: puzzle.solution[target], type: "hint" };
  next.hintsUsedCount += 1;
  next.complete = isComplete(puzzle, next);
  return { state: next, result: { status: "hint", word: target, complete: next.complete } };
}

/** Spoiler-free share text: shape of the solve, not the words themselves. */
export function shareText(puzzle, state, dayNumber, elapsedSeconds, diff = "medium") {
  const { rows, cols } = gridDims(puzzle);
  const cellType = {};
  for (const word of Object.keys(state.found)) {
    const entry = state.found[word];
    for (const [r, c] of entry.cells) {
      cellType[`${r},${c}`] = entry.type;
    }
  }

  const lines = [];
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < cols; c++) {
      const type = cellType[`${r},${c}`];
      line += type === "spangram" ? "\u{1F7E8}" : type ? "\u{1F7E6}" : "⬜";
    }
    lines.push(line);
  }

  const mins = Math.floor(elapsedSeconds / 60);
  const secs = elapsedSeconds % 60;
  const time = `${mins}:${String(secs).padStart(2, "0")}`;
  const hintNote = state.hintsUsedCount > 0 ? ` (${state.hintsUsedCount} hint${state.hintsUsedCount === 1 ? "" : "s"})` : "";

  const label = DIFF_LABELS[diff] || DIFF_LABELS.medium;
  return [`Puzzle Press Wordweave ${label} #${dayNumber}`, `${time}${hintNote}`, "", ...lines].join("\n");
}
