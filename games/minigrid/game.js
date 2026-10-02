import {
  pickDaily,
  store,
  recordDaily,
  resolveArchiveDay,
  diffTabs,
  share,
  toast,
  confettiBurst,
  initChrome,
  watchDayRollover,
} from "../../assets/shared.js";
import * as core from "./core.js";

const GAME_ID = "minigrid";
const EPOCH = "2026-08-10";
const DIFFICULTIES = ["easy", "medium", "hard"];
const LABELS = { easy: "Easy", medium: "Medium", hard: "Hard" };
const DEFAULT_DIFFICULTY = "medium";

const HELP_HTML =
  "<p>Fill the grid so every across and down answer matches its clue.</p>" +
  "<p>Tap a cell to select it, tap it again to switch between across and down, or use the arrow keys.</p>" +
  "<p>Type letters to fill a cell; Backspace clears one and steps back.</p>" +
  "<p>Check or Reveal a letter if you get stuck, but using either marks today's puzzle solved with help.</p>" +
  "<p>Easy, Medium, and Hard each carry their own puzzle, streak, and stats for the day. Easy sticks to " +
  "everyday fill with straight clues; Hard leans on trickier fill and a few wordplay clues.</p>" +
  "<p>Your time starts the moment you begin and stops the instant the grid is complete.</p>";

const archive = resolveArchiveDay(EPOCH, new URLSearchParams(location.search).get("date"));

initChrome({
  id: GAME_ID,
  name: "Minigrid",
  hubHref: "../../index.html",
  helpHTML: HELP_HTML,
  archiveDate: archive.isArchive ? archive.dateKey : null,
});
watchDayRollover(archive);

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function key(r, c) {
  return `${r},${c}`;
}

const els = {
  diffTabsMount: document.getElementById("diff-tabs"),
  timer: document.getElementById("timer"),
  helpBadge: document.getElementById("help-badge"),
  randomBadge: document.getElementById("random-badge"),
  grid: document.getElementById("grid"),
  cluePrev: document.getElementById("clue-prev"),
  clueNext: document.getElementById("clue-next"),
  clueActive: document.getElementById("clue-active"),
  btnDirection: document.getElementById("btn-direction"),
  btnCheck: document.getElementById("btn-check"),
  btnReveal: document.getElementById("btn-reveal"),
  cluesAcross: document.getElementById("clues-across"),
  cluesDown: document.getElementById("clues-down"),
  completePanel: document.getElementById("complete-panel"),
  completeTime: document.getElementById("complete-time"),
  btnShare: document.getElementById("btn-share"),
  btnRandom: document.getElementById("btn-random"),
};

let bank = null; // { easy: { puzzles }, medium: { puzzles }, hard: { puzzles } }
let activeDifficulty = DEFAULT_DIFFICULTY;
let isRandomMode = false;
let timerId = null;
let cellInputs = [];

// Per-difficulty runtime data for today's puzzles, loaded once at boot so
// switching tabs is instant (mirrors sudoku's dayStores/puzzles pattern).
const dayStores = {}; // difficulty -> store(GAME_ID, difficulty)
const puzzles = {}; // difficulty -> today's puzzle { grid, clues }
const states = {}; // difficulty -> core state
const metas = {}; // difficulty -> puzzle/meta derived from core.parsePuzzle

let freePlay = null; // { difficulty, puzzle, meta, state } or null

function activePuzzle() {
  return freePlay ? freePlay.puzzle : puzzles[activeDifficulty];
}

function activeMeta() {
  return freePlay ? freePlay.meta : metas[activeDifficulty];
}

function activeState() {
  return freePlay ? freePlay.state : states[activeDifficulty];
}

function setActiveState(next) {
  if (freePlay) freePlay.state = next;
  else states[activeDifficulty] = next;
}

async function loadBank() {
  const res = await fetch("../../data/minigrid.json");
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  return res.json();
}

function sameGrid(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((row, i) => row === b[i]);
}

function loadOrCreateDailyState(difficulty, puzzle) {
  // The saved grid ties the payload to the layout it was typed into; entries
  // from a different puzzle (a bank edit, or a different difficulty's
  // puzzle under a stale key) would land in the wrong cells otherwise.
  const saved = dayStores[difficulty].loadDay(archive.dateKey);
  if (saved && Array.isArray(saved.entries) && sameGrid(saved.grid, puzzle.grid)) {
    const { grid, ...rest } = saved;
    return rest;
  }
  return core.createInitialState(puzzle, Date.now());
}

function loadToday() {
  for (const difficulty of DIFFICULTIES) {
    const puzzle = pickDaily(bank[difficulty], EPOCH, archive.now);
    puzzles[difficulty] = puzzle;
    metas[difficulty] = core.parsePuzzle(puzzle);
    states[difficulty] = loadOrCreateDailyState(difficulty, puzzle);
  }
}

function saveState() {
  if (freePlay) return;
  dayStores[activeDifficulty].saveDay(
    { ...states[activeDifficulty], grid: puzzles[activeDifficulty].grid },
    archive.dateKey
  );
}

function activeSlot() {
  const state = activeState();
  const meta = activeMeta();
  const slots = meta.cellSlot.get(key(state.cursor.r, state.cursor.c));
  return slots ? slots[state.direction] : null;
}

function buildGrid() {
  const puzzle = activePuzzle();
  els.grid.innerHTML = "";
  cellInputs = Array.from({ length: 5 }, () => Array(5).fill(null));

  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const isBlock = puzzle.grid[r][c] === "#";
      const cell = document.createElement("div");
      cell.className = "mg-cell";

      if (isBlock) {
        cell.classList.add("mg-cell--block");
        cell.setAttribute("aria-hidden", "true");
        els.grid.appendChild(cell);
        continue;
      }

      const num = activeMeta().numbering.get(key(r, c));
      if (num) {
        const label = document.createElement("span");
        label.className = "mg-cell__num";
        label.textContent = String(num);
        label.setAttribute("aria-hidden", "true");
        cell.appendChild(label);
      }

      const input = document.createElement("input");
      input.type = "text";
      input.className = "mg-cell__input";
      input.maxLength = 1;
      input.autocomplete = "off";
      input.autocapitalize = "characters";
      input.spellcheck = false;
      input.inputMode = "text";

      let pendingToggle = false;
      input.addEventListener("pointerdown", () => {
        const state = activeState();
        pendingToggle = state.cursor.r === r && state.cursor.c === c;
      });
      input.addEventListener("focus", () => {
        const state = activeState();
        if (state.cursor.r !== r || state.cursor.c !== c) {
          setActiveState(core.selectCell(state, r, c));
          syncUI();
        }
      });
      input.addEventListener("click", () => {
        if (pendingToggle) {
          setActiveState(core.toggleDirection(activeState()));
          syncUI();
        }
        pendingToggle = false;
      });
      input.addEventListener("keydown", (e) => onKeydown(e, r, c));
      input.addEventListener("input", (e) => onNativeInput(e, r, c));

      cell.appendChild(input);
      cellInputs[r][c] = input;
      els.grid.appendChild(cell);
    }
  }
}

function onKeydown(e, r, c) {
  const k = e.key;
  if (k === "ArrowUp" || k === "ArrowDown" || k === "ArrowLeft" || k === "ArrowRight") {
    e.preventDefault();
    const [dr, dc] = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k];
    setActiveState(core.moveCursor(activeState(), activePuzzle().grid, dr, dc));
    syncUI();
    return;
  }
  if (k === "Backspace") {
    e.preventDefault();
    setActiveState(core.backspace(activeState(), activePuzzle().grid));
    mutate();
    return;
  }
  if (k === " " || k === "Enter") {
    e.preventDefault();
    setActiveState(core.toggleDirection(activeState()));
    syncUI();
    return;
  }
  if (k.length === 1 && /[a-zA-Z]/.test(k) && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    setActiveState(core.typeLetter(activeState(), activePuzzle().grid, k));
    mutate();
  }
}

// Fallback for mobile input methods that don't dispatch a clean keydown.
function onNativeInput(e, r, c) {
  const val = e.target.value;
  e.target.value = "";
  if (!val) return;
  const letter = val[val.length - 1];
  if (/[a-zA-Z]/.test(letter)) {
    setActiveState(core.selectCell(activeState(), r, c));
    setActiveState(core.typeLetter(activeState(), activePuzzle().grid, letter));
    mutate();
  }
}

function updateCellVisuals() {
  const state = activeState();
  const meta = activeMeta();
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const input = cellInputs[r][c];
      if (!input) continue;
      const cellDiv = input.parentElement;
      const letter = state.entries[r][c] || "";
      if (input.value !== letter) input.value = letter;

      const k = key(r, c);
      const isCursor = state.cursor.r === r && state.cursor.c === c;
      const slots = meta.cellSlot.get(k);
      const activeWordSlot = slots ? slots[state.direction] : null;
      const inActiveWord = activeWordSlot && activeWordSlot.cells.some(([rr, cc]) => rr === r && cc === c);

      cellDiv.classList.toggle("mg-cell--active", isCursor);
      cellDiv.classList.toggle("mg-cell--word", !isCursor && !!inActiveWord);

      if (state.checked[k] === "correct") cellDiv.dataset.check = "correct";
      else if (state.checked[k] === "wrong") cellDiv.dataset.check = "wrong";
      else delete cellDiv.dataset.check;

      if (state.revealed[k]) cellDiv.dataset.revealed = "true";
      else delete cellDiv.dataset.revealed;

      input.setAttribute(
        "aria-label",
        `Row ${r + 1}, column ${c + 1}${letter ? `, letter ${letter}` : ", blank"}`
      );
    }
  }
}

function renderClueBar() {
  const slot = activeSlot();
  if (!slot) {
    els.clueActive.innerHTML = "";
    return;
  }
  const puzzle = activePuzzle();
  const text = puzzle.clues[slot.dir][String(slot.number)];
  const dirLabel = slot.dir === "across" ? "Across" : "Down";
  els.clueActive.innerHTML =
    `<span class="mg-cluebar__num">${slot.number} ${dirLabel}</span>${esc(text)}`;
}

function buildClueLists() {
  const puzzle = activePuzzle();
  const meta = activeMeta();
  els.cluesAcross.innerHTML = "";
  els.cluesDown.innerHTML = "";
  for (const dir of ["across", "down"]) {
    const container = dir === "across" ? els.cluesAcross : els.cluesDown;
    const slots = (dir === "across" ? meta.acrossSlots : meta.downSlots)
      .slice()
      .sort((a, b) => a.number - b.number);
    for (const slot of slots) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mg-clues__item";
      btn.dataset.dir = dir;
      btn.dataset.number = String(slot.number);
      btn.innerHTML =
        `<span class="mg-clues__num">${slot.number}</span><span>${esc(puzzle.clues[dir][String(slot.number)])}</span>`;
      btn.addEventListener("click", () => {
        setActiveState(core.jumpToSlot(activeState(), slot));
        syncUI();
      });
      li.appendChild(btn);
      container.appendChild(li);
    }
  }
}

function updateClueListState() {
  const state = activeState();
  const meta = activeMeta();
  const puzzle = activePuzzle();
  const active = activeSlot();
  const allSlots = [...meta.acrossSlots, ...meta.downSlots];
  document.querySelectorAll(".mg-clues__item").forEach((btn) => {
    const dir = btn.dataset.dir;
    const number = Number(btn.dataset.number);
    const isActive = !!active && active.dir === dir && active.number === number;
    btn.setAttribute("aria-current", isActive ? "true" : "false");
    const slot = allSlots.find((s) => s.dir === dir && s.number === number);
    const solved = slot.cells.every(([r, c]) => state.entries[r][c] === puzzle.grid[r][c]);
    btn.dataset.solved = solved ? "true" : "false";
  });
}

function updateHelpBadge() {
  els.helpBadge.hidden = !activeState().usedHelp;
}

function updateTimerDisplay() {
  els.timer.textContent = core.formatTime(core.elapsedMs(activeState(), Date.now()));
}

function startTimerLoop() {
  stopTimerLoop();
  timerId = window.setInterval(updateTimerDisplay, 500);
  updateTimerDisplay();
}

function stopTimerLoop() {
  if (timerId != null) {
    window.clearInterval(timerId);
    timerId = null;
  }
}

function focusCursorCell() {
  const state = activeState();
  const input = cellInputs[state.cursor.r] && cellInputs[state.cursor.r][state.cursor.c];
  if (input && document.activeElement !== input) input.focus({ preventScroll: true });
}

function syncUI() {
  updateCellVisuals();
  renderClueBar();
  updateClueListState();
  updateHelpBadge();
  saveState();
  focusCursorCell();
}

function mutate() {
  syncUI();
  const state = activeState();
  const puzzle = activePuzzle();
  const wasSolved = state.solvedAt != null;
  const next = core.finishIfSolved(state, puzzle.grid, Date.now());
  setActiveState(next);
  if (!wasSolved && next.solvedAt != null) {
    saveState();
    showComplete(true);
  }
}

function showComplete(justSolved) {
  stopTimerLoop();
  updateTimerDisplay();
  els.completePanel.hidden = false;
  const time = core.formatTime(core.elapsedMs(activeState()));
  els.completeTime.textContent = `Solved in ${time}${activeState().usedHelp ? " (with help)" : ""}`;
  if (justSolved) {
    confettiBurst();
    if (!isRandomMode && !archive.isArchive) {
      const time = core.formatTime(core.elapsedMs(activeState()));
      const note = activeState().usedHelp ? " (with help)" : "";
      recordDaily(GAME_ID, true, activeDifficulty, archive, `Solved in ${time}${note}`);
    }
    toast("Solved!");
  }
}

function fullRender() {
  updateCellVisuals();
  renderClueBar();
  updateClueListState();
  updateHelpBadge();
  updateTimerDisplay();
}

els.btnDirection.addEventListener("click", () => {
  setActiveState(core.toggleDirection(activeState()));
  syncUI();
});

els.cluePrev.addEventListener("click", () => {
  setActiveState(core.advanceClue(activeState(), activeMeta(), -1));
  syncUI();
});

els.clueNext.addEventListener("click", () => {
  setActiveState(core.advanceClue(activeState(), activeMeta(), 1));
  syncUI();
});

els.btnCheck.addEventListener("click", () => {
  setActiveState(core.checkCell(activeState(), activePuzzle().grid));
  syncUI();
});

els.btnReveal.addEventListener("click", () => {
  setActiveState(core.revealCell(activeState(), activePuzzle().grid));
  mutate();
});

els.btnShare.addEventListener("click", async () => {
  const url = new URL("../../index.html", location.href).href;
  const text = core.shareText({
    dateLabel: archive.dateKey,
    diffLabel: isRandomMode ? null : LABELS[activeDifficulty],
    ms: core.elapsedMs(activeState()),
    usedHelp: activeState().usedHelp,
    url,
  });
  await share(text);
});

function renderActive() {
  els.randomBadge.hidden = !isRandomMode;
  els.btnRandom.textContent = isRandomMode ? "Back to today's puzzle" : "Play a random puzzle";
  els.completePanel.hidden = true;
  buildGrid();
  buildClueLists();
  fullRender();
  if (activeState().solvedAt != null) {
    showComplete(false);
  } else {
    startTimerLoop();
  }
  focusCursorCell();
}

function switchToRandom() {
  const difficulty = activeDifficulty;
  const list = bank[difficulty].puzzles;
  const todaysPuzzle = puzzles[difficulty];
  let candidate = list[Math.floor(Math.random() * list.length)];
  for (let attempt = 0; attempt < 8 && candidate === todaysPuzzle && list.length > 1; attempt++) {
    candidate = list[Math.floor(Math.random() * list.length)];
  }
  isRandomMode = true;
  stopTimerLoop();
  freePlay = {
    difficulty,
    puzzle: candidate,
    meta: core.parsePuzzle(candidate),
    state: core.createInitialState(candidate, Date.now()),
  };
  renderActive();
}

function switchToDaily() {
  isRandomMode = false;
  freePlay = null;
  stopTimerLoop();
  renderActive();
}

els.btnRandom.addEventListener("click", () => {
  if (isRandomMode) switchToDaily();
  else switchToRandom();
});

function switchDifficulty(difficulty) {
  isRandomMode = false;
  freePlay = null;
  stopTimerLoop();
  activeDifficulty = difficulty;
  renderActive();
}

async function init() {
  try {
    bank = await loadBank();
  } catch (err) {
    toast("Could not load today's puzzle");
    return;
  }
  for (const difficulty of DIFFICULTIES) dayStores[difficulty] = store(GAME_ID, difficulty);
  loadToday();
  activeDifficulty = diffTabs(els.diffTabsMount, GAME_ID, switchDifficulty, DEFAULT_DIFFICULTY);
  renderActive();
}

init();
