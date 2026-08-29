import {
  pickDaily,
  store,
  diffTabs,
  recordResult,
  resolveArchiveDay,
  share,
  confettiBurst,
  initChrome,
} from "../../assets/shared.js";
import {
  parseCells,
  peersOf,
  findConflicts,
  isSolved,
  sameValueCells,
  savedMatchesPuzzle,
  setValue,
  toggleMark,
  undo,
} from "./core.js";

const EPOCH = "2026-08-10";
const GAME_ID = "sudoku";
const DIFFICULTIES = ["easy", "medium", "hard"];
const LABELS = { easy: "Easy", medium: "Medium", hard: "Hard" };
const SAVE_INTERVAL_MS = 4000;
const DEFAULT_DIFFICULTY = "easy";

const HELP_HTML =
  "<p>Fill every row, column, and 3x3 box with the digits 1 through 9, no repeats. " +
  "Given numbers are locked in place. Select a cell, then pick a number to fill it, " +
  "or switch on Notes first to jot pencil marks instead. Easy, Medium, and Hard each " +
  "carry their own puzzle, streak, and stats for the day. " +
  "Undo, erase, and the error highlight toggle are there whenever you want the help.</p>";

// Pre-v2 sudoku kept every difficulty's board under one combined day key and
// one shared meta, so the generic shared.js migration skips this game
// entirely (see shared.js's migrateLegacy). This carries that bespoke shape
// onto the new pp.sudoku.<diff>.day.* / pp.sudoku.<diff>.meta keys once. Day
// state already had a natural home per difficulty, so it moves there intact;
// the old streak/played/wins meta was a single number with no per-difficulty
// history to preserve, so it lands on medium, same as every other game's
// legacy meta migration.
function migrateLegacySudoku() {
  try {
    const flagKey = `pp.${GAME_ID}.migrated`;
    if (localStorage.getItem(flagKey) === "1") return;

    const dayPrefix = `pp.${GAME_ID}.day.`;
    const legacyDayKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(dayPrefix)) legacyDayKeys.push(key);
    }
    for (const key of legacyDayKeys) {
      const dateKey = key.slice(dayPrefix.length);
      let payload = null;
      try {
        payload = JSON.parse(localStorage.getItem(key));
      } catch {
        payload = null;
      }
      if (payload && typeof payload === "object") {
        for (const difficulty of DIFFICULTIES) {
          const diffPayload = payload[difficulty];
          if (!diffPayload) continue;
          const newKey = `pp.${GAME_ID}.${difficulty}.day.${dateKey}`;
          if (localStorage.getItem(newKey) == null) {
            localStorage.setItem(newKey, JSON.stringify(diffPayload));
          }
        }
      }
      localStorage.removeItem(key);
    }

    const legacyMetaKey = `pp.${GAME_ID}.meta`;
    const legacyMeta = localStorage.getItem(legacyMetaKey);
    if (legacyMeta != null) {
      const newMetaKey = `pp.${GAME_ID}.medium.meta`;
      if (localStorage.getItem(newMetaKey) == null) {
        localStorage.setItem(newMetaKey, legacyMeta);
      }
      localStorage.removeItem(legacyMetaKey);
    }

    localStorage.setItem(flagKey, "1");
  } catch {
    /* storage unavailable: nothing to migrate, nothing to break */
  }
}

let dayStores = null; // difficulty -> store(GAME_ID, difficulty), built after migration

let bank = null;
let activeDifficulty = "easy";
let notesMode = false;
let errorHighlight = true;

// Per-difficulty runtime data for today's puzzles.
const puzzles = {}; // difficulty -> { puzzle: string, solution: number[] }
const states = {}; // difficulty -> { given, values, marks, history }
const timers = {}; // difficulty -> { elapsedMs, runningSince }
const solvedToday = {}; // difficulty -> bool
const selection = {}; // difficulty -> index

let freePlay = null; // { difficulty, solution: number[], state } or null
let saveTimer = null;
let archive = null; // resolveArchiveDay(EPOCH, ...): the day, real or archived, we're playing

const el = {};

function qs(id) {
  return document.getElementById(id);
}

function cacheEls() {
  el.board = qs("board");
  el.pad = qs("pad");
  el.timer = qs("timer");
  el.status = qs("status");
  el.donePanel = qs("done-panel");
  el.doneMessage = qs("done-message");
  el.diffTabsMount = qs("diff-tabs");
  el.undoBtn = document.querySelector('[data-action="undo"]');
  el.notesBtn = document.querySelector('[data-action="notes"]');
  el.errorsBtn = document.querySelector('[data-action="errors"]');
  el.shareBtn = document.querySelector('[data-action="share"]');
  el.randomBtn = document.querySelector('[data-action="random"]');
}

function fmtTime(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

async function loadBank() {
  const res = await fetch("../../data/sudoku.json");
  if (!res.ok) throw new Error("could not load sudoku bank");
  return res.json();
}

function currentState() {
  return freePlay ? freePlay.state : states[activeDifficulty];
}

function currentSolution() {
  return freePlay ? freePlay.solution : puzzles[activeDifficulty].solution;
}

function currentSelected() {
  return freePlay ? freePlay.selected : selection[activeDifficulty];
}

function setSelected(index) {
  if (freePlay) freePlay.selected = index;
  else selection[activeDifficulty] = index;
}

function isDone() {
  return freePlay ? freePlay.done : solvedToday[activeDifficulty];
}

// ---------- persistence ----------

function stateFromSaved(puzzleStr, saved) {
  const puzzleCells = parseCells(puzzleStr);
  const given = puzzleCells.map((v) => v !== 0);
  const values = saved && saved.values ? saved.values.slice() : puzzleCells.slice();
  const marks =
    saved && saved.marks ? saved.marks.map((m) => m.slice()) : puzzleCells.map(() => []);
  return { given, values, marks, history: [] };
}

function firstEditableIndex(state) {
  const i = state.given.findIndex((g) => !g);
  return i === -1 ? 0 : i;
}

function loadToday() {
  for (const difficulty of DIFFICULTIES) {
    const entry = pickDaily(bank[difficulty], EPOCH, archive.now);
    const solution = parseCells(entry.solution);
    puzzles[difficulty] = { puzzle: entry.puzzle, solution };

    // Only restore state that was saved against this exact board. A stale
    // payload (bank edit, epoch change) would otherwise lock wrong digits
    // into the new puzzle's given cells. Payloads carried over from v1 have
    // no puzzle field, so savedMatchesPuzzle checks them against the givens
    // instead of throwing that day's board and timer away.
    const savedRaw = dayStores[difficulty].loadDay(archive.dateKey);
    const savedFor = savedMatchesPuzzle(savedRaw, entry.puzzle) ? savedRaw : null;
    const state = stateFromSaved(entry.puzzle, savedFor);
    states[difficulty] = state;
    timers[difficulty] = { elapsedMs: (savedFor && savedFor.elapsedMs) || 0, runningSince: null };
    solvedToday[difficulty] = Boolean(savedFor && savedFor.done) || isSolved(state.values, solution);
    selection[difficulty] = firstEditableIndex(state);
  }
}

function saveToday() {
  for (const difficulty of DIFFICULTIES) {
    dayStores[difficulty].saveDay(
      {
        puzzle: puzzles[difficulty].puzzle,
        values: states[difficulty].values,
        marks: states[difficulty].marks,
        elapsedMs: elapsedFor(difficulty),
        done: solvedToday[difficulty],
      },
      archive.dateKey
    );
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    saveToday();
  }, SAVE_INTERVAL_MS);
}

// ---------- timer ----------

function elapsedFor(difficulty) {
  const t = timers[difficulty];
  if (!t) return 0;
  return t.elapsedMs + (t.runningSince ? performance.now() - t.runningSince : 0);
}

function freePlayElapsed() {
  if (!freePlay) return 0;
  return freePlay.elapsedMs + (freePlay.runningSince ? performance.now() - freePlay.runningSince : 0);
}

function pauseAllTimers() {
  for (const difficulty of DIFFICULTIES) {
    const t = timers[difficulty];
    if (t.runningSince) {
      t.elapsedMs += performance.now() - t.runningSince;
      t.runningSince = null;
    }
  }
  if (freePlay && freePlay.runningSince) {
    freePlay.elapsedMs += performance.now() - freePlay.runningSince;
    freePlay.runningSince = null;
  }
}

function resumeActiveTimer() {
  if (document.hidden) return;
  if (freePlay) {
    if (!freePlay.done && !freePlay.runningSince) freePlay.runningSince = performance.now();
    return;
  }
  const t = timers[activeDifficulty];
  if (!solvedToday[activeDifficulty] && !t.runningSince) t.runningSince = performance.now();
}

function tick() {
  el.timer.textContent = fmtTime(freePlay ? freePlayElapsed() : elapsedFor(activeDifficulty));
}

// ---------- board rendering ----------

function buildBoard() {
  el.board.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 81; i++) {
    const row = Math.floor(i / 9);
    const col = i % 9;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sk-cell";
    btn.dataset.index = String(i);
    btn.setAttribute("role", "gridcell");
    if (col === 2 || col === 5) btn.classList.add("sk-box-right");
    if (row === 2 || row === 5) btn.classList.add("sk-box-bottom");
    btn.addEventListener("click", () => {
      setSelected(i);
      renderBoard();
    });
    frag.appendChild(btn);
  }
  el.board.appendChild(frag);
  el.board.addEventListener("keydown", onBoardKeydown);
}

function markGridHTML(marks) {
  let html = '<span class="sk-marks">';
  for (let n = 1; n <= 9; n++) {
    const has = marks.includes(n);
    html += `<span class="sk-mark${has ? "" : " sk-mark--empty"}">${has ? n : ""}</span>`;
  }
  html += "</span>";
  return html;
}

function renderBoard() {
  const state = currentState();
  const solution = currentSolution();
  const selected = currentSelected();
  const conflicts = errorHighlight ? findConflicts(state.values) : new Set();
  const peers = selected != null ? new Set(peersOf(selected)) : new Set();
  const same = selected != null ? new Set(sameValueCells(state.values, selected)) : new Set();

  const cells = el.board.children;
  for (let i = 0; i < 81; i++) {
    const btn = cells[i];
    const v = state.values[i];
    btn.dataset.given = String(state.given[i]);
    btn.dataset.selected = String(i === selected);
    btn.dataset.peer = String(peers.has(i) && i !== selected);
    btn.dataset.same = String(same.has(i) && i !== selected);
    btn.dataset.conflict = String(conflicts.has(i));
    btn.tabIndex = i === selected ? 0 : -1;

    const row = Math.floor(i / 9) + 1;
    const col = (i % 9) + 1;
    let label = `Row ${row}, column ${col}`;
    label += v ? `, ${v}${state.given[i] ? " (given)" : ""}` : ", empty";
    if (!v && state.marks[i].length) label += `, notes ${state.marks[i].join(", ")}`;
    btn.setAttribute("aria-label", label);

    if (v) {
      btn.textContent = String(v);
    } else if (state.marks[i].length) {
      btn.innerHTML = markGridHTML(state.marks[i]);
    } else {
      btn.textContent = "";
    }
  }

  renderPad(state);
  renderStatus();
}

function renderPad(state) {
  const counts = new Array(10).fill(0);
  for (const v of state.values) if (v) counts[v]++;
  const buttons = el.pad.children;
  for (let n = 1; n <= 9; n++) {
    const btn = buttons[n - 1];
    btn.dataset.exhausted = String(counts[n] >= 9);
  }
}

function renderStatus() {
  if (isDone()) {
    el.status.textContent = "";
    return;
  }
  el.status.textContent = notesMode ? "Notes mode: tap a number to add or remove a pencil mark." : "";
}

function buildPad() {
  el.pad.innerHTML = "";
  for (let n = 1; n <= 9; n++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sk-pad-btn";
    btn.dataset.value = String(n);
    btn.textContent = String(n);
    btn.setAttribute("aria-label", `Enter ${n}`);
    btn.addEventListener("click", () => enterDigit(n));
    el.pad.appendChild(btn);
  }
  const erase = document.createElement("button");
  erase.type = "button";
  erase.className = "sk-pad-btn sk-pad-btn--erase";
  erase.setAttribute("aria-label", "Erase cell");
  erase.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18" style="margin:auto"><path d="M18 13 11 20H7l-4-4 9-9 8 8-2 2Z"/><path d="M14.5 8.5 17 11"/></svg>';
  erase.addEventListener("click", () => enterDigit(0));
  el.pad.appendChild(erase);
}

// ---------- gameplay actions ----------

function applyState(nextState) {
  if (freePlay) freePlay.state = nextState;
  else states[activeDifficulty] = nextState;
}

function enterDigit(n) {
  if (isDone()) return;
  const selected = currentSelected();
  if (selected == null) return;
  const state = currentState();
  if (state.given[selected]) return;

  const next = notesMode && n !== 0 ? toggleMark(state, selected, n) : setValue(state, selected, n);
  if (next === state) return;
  applyState(next);

  const cellEl = el.board.children[selected];
  if (cellEl) {
    cellEl.classList.remove("sk-cell--pop");
    void cellEl.offsetWidth;
    cellEl.classList.add("sk-cell--pop");
  }

  renderBoard();

  if (n !== 0 && !notesMode) checkWin();
  persist();
}

function checkWin() {
  const state = currentState();
  const solution = currentSolution();
  if (!isSolved(state.values, solution)) return;

  if (freePlay) {
    freePlay.done = true;
    if (freePlay.runningSince) {
      freePlay.elapsedMs += performance.now() - freePlay.runningSince;
      freePlay.runningSince = null;
    }
    showDone(freePlay.elapsedMs, true);
    return;
  }

  solvedToday[activeDifficulty] = true;
  const t = timers[activeDifficulty];
  if (t.runningSince) {
    t.elapsedMs += performance.now() - t.runningSince;
    t.runningSince = null;
  }
  if (!archive.isArchive) recordResult(GAME_ID, true, activeDifficulty);
  confettiBurst();
  showDone(t.elapsedMs, false);
}

function showDone(elapsedMs, isFreePlay) {
  el.donePanel.hidden = false;
  const label = isFreePlay ? "Random puzzle" : LABELS[activeDifficulty];
  el.doneMessage.textContent = isFreePlay
    ? `Solved in ${fmtTime(elapsedMs)}. Free play doesn't affect your streak.`
    : `${label} solved in ${fmtTime(elapsedMs)}. Nice work.`;
  el.randomBtn.hidden = isFreePlay;
  renderBoard();
}

function hideDone() {
  el.donePanel.hidden = true;
}

function persist() {
  if (!freePlay) scheduleSave();
}

// ---------- tab / difficulty switching ----------

function switchDifficulty(difficulty) {
  if (freePlay) exitFreePlay();
  pauseAllTimers();
  activeDifficulty = difficulty;
  hideDone();
  if (solvedToday[difficulty]) {
    showDone(elapsedFor(difficulty), false);
  }
  resumeActiveTimer();
  renderBoard();
  tick();
}

// ---------- free play ----------

function startFreePlay() {
  const list = bank[activeDifficulty].puzzles;
  const todaysPuzzle = puzzles[activeDifficulty].puzzle;
  let candidate = list[Math.floor(Math.random() * list.length)];
  for (let attempt = 0; attempt < 8 && candidate.puzzle === todaysPuzzle && list.length > 1; attempt++) {
    candidate = list[Math.floor(Math.random() * list.length)];
  }
  const solution = parseCells(candidate.solution);
  const state = stateFromSaved(candidate.puzzle, null);
  freePlay = {
    difficulty: activeDifficulty,
    solution,
    state,
    selected: firstEditableIndex(state),
    elapsedMs: 0,
    runningSince: performance.now(),
    done: false,
  };
  hideDone();
  renderBoard();
}

function exitFreePlay() {
  freePlay = null;
}

// ---------- keyboard + toolbar wiring ----------

function onBoardKeydown(e) {
  const selected = currentSelected();
  if (selected == null) return;

  if (e.key >= "1" && e.key <= "9") {
    e.preventDefault();
    enterDigit(Number(e.key));
    return;
  }
  if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") {
    e.preventDefault();
    enterDigit(0);
    return;
  }

  const row = Math.floor(selected / 9);
  const col = selected % 9;
  let next = null;
  if (e.key === "ArrowUp") next = row > 0 ? selected - 9 : selected;
  else if (e.key === "ArrowDown") next = row < 8 ? selected + 9 : selected;
  else if (e.key === "ArrowLeft") next = col > 0 ? selected - 1 : selected;
  else if (e.key === "ArrowRight") next = col < 8 ? selected + 1 : selected;

  if (next != null) {
    e.preventDefault();
    setSelected(next);
    renderBoard();
    const btn = el.board.children[next];
    if (btn) btn.focus();
  }
}

function wireToolbar() {
  el.undoBtn.addEventListener("click", () => {
    if (isDone()) return;
    const state = currentState();
    const next = undo(state);
    if (next === state) return;
    applyState(next);
    renderBoard();
    persist();
  });

  el.notesBtn.addEventListener("click", () => {
    notesMode = !notesMode;
    el.notesBtn.setAttribute("aria-pressed", String(notesMode));
    renderStatus();
  });

  el.errorsBtn.addEventListener("click", () => {
    errorHighlight = !errorHighlight;
    el.errorsBtn.setAttribute("aria-pressed", String(errorHighlight));
    renderBoard();
  });

  el.shareBtn.addEventListener("click", () => {
    const isFreePlay = Boolean(freePlay);
    const label = isFreePlay ? "random puzzle" : LABELS[activeDifficulty];
    const elapsed = isFreePlay ? freePlay.elapsedMs : timers[activeDifficulty].elapsedMs;
    const text = `Puzzle Press: Sudoku\n${label} in ${fmtTime(elapsed)}`;
    share(text);
  });

  el.randomBtn.addEventListener("click", () => {
    startFreePlay();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      pauseAllTimers();
      saveToday();
    } else {
      resumeActiveTimer();
    }
  });

  window.addEventListener("pagehide", () => {
    pauseAllTimers();
    if (!freePlay) saveToday();
  });
}

// ---------- boot ----------

async function main() {
  cacheEls();
  archive = resolveArchiveDay(EPOCH, new URLSearchParams(location.search).get("date"));
  initChrome({
    id: GAME_ID,
    name: "Sudoku",
    hubHref: "../../index.html",
    helpHTML: HELP_HTML,
    archiveDate: archive.isArchive ? archive.dateKey : null,
  });

  migrateLegacySudoku();
  dayStores = Object.fromEntries(DIFFICULTIES.map((d) => [d, store(GAME_ID, d)]));

  try {
    bank = await loadBank();
  } catch (err) {
    el.status.textContent = "Could not load today's puzzles. Try reloading.";
    return;
  }

  loadToday();
  buildBoard();
  buildPad();
  wireToolbar();

  activeDifficulty = diffTabs(el.diffTabsMount, GAME_ID, switchDifficulty, DEFAULT_DIFFICULTY);
  if (solvedToday[activeDifficulty]) showDone(elapsedFor(activeDifficulty), false);
  resumeActiveTimer();
  renderBoard();
  tick();

  window.setInterval(() => {
    tick();
    if (!document.hidden) scheduleSave();
  }, 1000);
}

main();
