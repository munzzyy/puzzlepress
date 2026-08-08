/*
  Minigrid pure logic. No DOM, no globals, no I/O. game.js drives this with
  real input and shared.js for storage/daily-pick; this file only knows about
  grids, cursors, and letters.

  A puzzle is { grid: ["ABCDE", ...], clues: { across: {n: text}, down: {n: text} } }.
  "#" marks a block. Every open cell in a shipped puzzle belongs to exactly one
  across run and one down run, each length >= 3 (enforced by the generator),
  but parsePuzzle below only assumes length >= 2 so it stays robust to smaller
  grids used in tests.
*/

function key(r, c) {
  return `${r},${c}`;
}

/** Row-major numbering + across/down slot metadata derived from a grid. */
export function parsePuzzle(puzzle) {
  const grid = puzzle.grid;
  const rows = grid.length;
  const cols = grid[0].length;
  const isBlock = (r, c) => grid[r][c] === "#";

  const acrossSlots = [];
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      if (isBlock(r, c)) {
        c++;
        continue;
      }
      const start = c;
      while (c < cols && !isBlock(r, c)) c++;
      const length = c - start;
      if (length >= 2) {
        const cells = [];
        for (let cc = start; cc < start + length; cc++) cells.push([r, cc]);
        acrossSlots.push({ dir: "across", row: r, col: start, length, cells, number: 0 });
      }
    }
  }

  const downSlots = [];
  for (let c = 0; c < cols; c++) {
    let r = 0;
    while (r < rows) {
      if (isBlock(r, c)) {
        r++;
        continue;
      }
      const start = r;
      while (r < rows && !isBlock(r, c)) r++;
      const length = r - start;
      if (length >= 2) {
        const cells = [];
        for (let rr = start; rr < start + length; rr++) cells.push([rr, c]);
        downSlots.push({ dir: "down", row: start, col: c, length, cells, number: 0 });
      }
    }
  }

  const acrossStart = new Map(acrossSlots.map((s) => [key(s.row, s.col), s]));
  const downStart = new Map(downSlots.map((s) => [key(s.row, s.col), s]));
  const numbering = new Map();
  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (isBlock(r, c)) continue;
      const k = key(r, c);
      if (acrossStart.has(k) || downStart.has(k)) {
        n++;
        numbering.set(k, n);
      }
    }
  }
  for (const s of acrossSlots) s.number = numbering.get(key(s.row, s.col));
  for (const s of downSlots) s.number = numbering.get(key(s.row, s.col));

  const cellSlot = new Map();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!isBlock(r, c)) cellSlot.set(key(r, c), { across: null, down: null });
    }
  }
  for (const s of acrossSlots) for (const [r, c] of s.cells) cellSlot.get(key(r, c)).across = s;
  for (const s of downSlots) for (const [r, c] of s.cells) cellSlot.get(key(r, c)).down = s;

  return { rows, cols, isBlock, acrossSlots, downSlots, numbering, cellSlot };
}

/** All slots in reading order: by number, across before down at a tie. */
export function orderedSlots(meta) {
  return [...meta.acrossSlots, ...meta.downSlots].sort(
    (a, b) => a.number - b.number || (a.dir === "across" ? -1 : 1)
  );
}

function firstOpenCell(grid) {
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c] !== "#") return { r, c };
    }
  }
  return { r: 0, c: 0 };
}

export function createInitialState(puzzle, now = Date.now()) {
  const entries = puzzle.grid.map((row) => row.split("").map((ch) => (ch === "#" ? null : "")));
  return {
    entries,
    direction: "across",
    cursor: firstOpenCell(puzzle.grid),
    startedAt: now,
    solvedAt: null,
    checked: {},
    revealed: {},
    usedHelp: false,
  };
}

export function setDirection(state, dir) {
  return dir === state.direction ? state : { ...state, direction: dir };
}

export function toggleDirection(state) {
  return { ...state, direction: state.direction === "across" ? "down" : "across" };
}

/** Moves the cursor along dr/dc, hopping over blocks, stopping at grid edges. */
export function moveCursor(state, grid, dr, dc) {
  const rows = grid.length;
  const cols = grid[0].length;
  let r = state.cursor.r + dr;
  let c = state.cursor.c + dc;
  while (r >= 0 && r < rows && c >= 0 && c < cols) {
    if (grid[r][c] !== "#") return { ...state, cursor: { r, c } };
    r += dr;
    c += dc;
  }
  return state;
}

/** Click/tap a cell: re-selecting the active cell flips direction instead. */
export function selectCell(state, r, c) {
  if (state.cursor.r === r && state.cursor.c === c) return toggleDirection(state);
  return { ...state, cursor: { r, c } };
}

export function jumpToSlot(state, slot) {
  return { ...state, direction: slot.dir, cursor: { r: slot.row, c: slot.col } };
}

export function advanceClue(state, meta, delta) {
  const order = orderedSlots(meta);
  if (order.length === 0) return state;
  const active = meta.cellSlot.get(key(state.cursor.r, state.cursor.c))[state.direction];
  const idx = Math.max(0, order.indexOf(active));
  const next = order[((idx + delta) % order.length + order.length) % order.length];
  return jumpToSlot(state, next);
}

/** Types one letter at the cursor and steps forward within the run. */
export function typeLetter(state, grid, ch) {
  const letter = String(ch).toUpperCase();
  if (!/^[A-Z]$/.test(letter)) return state;
  const { r, c } = state.cursor;
  const entries = state.entries.map((row) => row.slice());
  entries[r][c] = letter;
  const checked = { ...state.checked };
  delete checked[key(r, c)];

  const dr = state.direction === "down" ? 1 : 0;
  const dc = state.direction === "across" ? 1 : 0;
  const nr = r + dr;
  const nc = c + dc;
  const inBounds = nr >= 0 && nr < grid.length && nc >= 0 && nc < grid[0].length;
  const cursor = inBounds && grid[nr][nc] !== "#" ? { r: nr, c: nc } : state.cursor;

  return { ...state, entries, checked, cursor };
}

/** Clears the current cell, or steps back within the run and clears that one. */
export function backspace(state, grid) {
  const { r, c } = state.cursor;
  const entries = state.entries.map((row) => row.slice());
  if (entries[r][c]) {
    entries[r][c] = "";
    return { ...state, entries };
  }
  const dr = state.direction === "down" ? -1 : 0;
  const dc = state.direction === "across" ? -1 : 0;
  const nr = r + dr;
  const nc = c + dc;
  const inBounds = nr >= 0 && nr < grid.length && nc >= 0 && nc < grid[0].length;
  if (inBounds && grid[nr][nc] !== "#") {
    entries[nr][nc] = "";
    return { ...state, entries, cursor: { r: nr, c: nc } };
  }
  return { ...state, entries };
}

/** Marks the current cell right/wrong against the answer. Counts as help. */
export function checkCell(state, grid) {
  const { r, c } = state.cursor;
  const letter = state.entries[r][c];
  const checked = { ...state.checked };
  if (letter) checked[key(r, c)] = letter === grid[r][c] ? "correct" : "wrong";
  return { ...state, checked, usedHelp: true };
}

/** Fills the current cell with the correct letter. Counts as help. */
export function revealCell(state, grid) {
  const { r, c } = state.cursor;
  const entries = state.entries.map((row) => row.slice());
  entries[r][c] = grid[r][c];
  const checked = { ...state.checked };
  delete checked[key(r, c)];
  const revealed = { ...state.revealed, [key(r, c)]: true };
  return { ...state, entries, checked, revealed, usedHelp: true };
}

export function isSolved(state, grid) {
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c] === "#") continue;
      if (state.entries[r][c] !== grid[r][c]) return false;
    }
  }
  return true;
}

/** Freezes solvedAt the first time the grid is fully correct. Idempotent. */
export function finishIfSolved(state, grid, now = Date.now()) {
  if (state.solvedAt != null) return state;
  if (!isSolved(state, grid)) return state;
  return { ...state, solvedAt: now };
}

export function elapsedMs(state, now = Date.now()) {
  const end = state.solvedAt != null ? state.solvedAt : now;
  return Math.max(0, end - state.startedAt);
}

export function formatTime(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function shareText({ dateLabel, diffLabel, ms, usedHelp, url }) {
  const time = formatTime(ms);
  const note = usedHelp ? " (with help)" : "";
  const label = diffLabel ? ` ${diffLabel}` : "";
  return `Minigrid${label} - ${dateLabel}\nSolved in ${time}${note}\n${url}`;
}
