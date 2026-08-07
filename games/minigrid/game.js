import {
  todayKey,
  pickDaily,
  store,
  recordResult,
  share,
  toast,
  confettiBurst,
  initChrome,
} from "../../assets/shared.js";
import * as core from "./core.js";

const GAME_ID = "minigrid";
const EPOCH = "2026-08-10";

const HELP_HTML =
  "<p>Fill the grid so every across and down answer matches its clue.</p>" +
  "<p>Tap a cell to select it, tap it again to switch between across and down, or use the arrow keys.</p>" +
  "<p>Type letters to fill a cell; Backspace clears one and steps back.</p>" +
  "<p>Check or Reveal a letter if you get stuck, but using either marks today's puzzle solved with help.</p>" +
  "<p>Your time starts the moment you begin and stops the instant the grid is complete.</p>";

initChrome({ id: GAME_ID, name: "Minigrid", hubHref: "../../index.html", helpHTML: HELP_HTML });

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function key(r, c) {
  return `${r},${c}`;
}

const els = {
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

let bank = null;
let puzzle = null;
let meta = null;
let state = null;
let isRandomMode = false;
let timerId = null;
let cellInputs = [];

async function loadBank() {
  const res = await fetch("../../data/minigrid.json");
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  return res.json();
}

function todaysPuzzle() {
  return pickDaily(bank, EPOCH);
}

function loadOrCreateDailyState() {
  const saved = store(GAME_ID).loadDay();
  if (saved && Array.isArray(saved.entries)) return saved;
  return core.createInitialState(puzzle, Date.now());
}

function saveState() {
  if (isRandomMode) return;
  store(GAME_ID).saveDay(state);
}

function activeSlot() {
  const slots = meta.cellSlot.get(key(state.cursor.r, state.cursor.c));
  return slots ? slots[state.direction] : null;
}

function buildGrid() {
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

      const num = meta.numbering.get(key(r, c));
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
        pendingToggle = state.cursor.r === r && state.cursor.c === c;
      });
      input.addEventListener("focus", () => {
        if (state.cursor.r !== r || state.cursor.c !== c) {
          state = core.selectCell(state, r, c);
          syncUI();
        }
      });
      input.addEventListener("click", () => {
        if (pendingToggle) {
          state = core.toggleDirection(state);
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
    state = core.moveCursor(state, puzzle.grid, dr, dc);
    syncUI();
    return;
  }
  if (k === "Backspace") {
    e.preventDefault();
    state = core.backspace(state, puzzle.grid);
    mutate();
    return;
  }
  if (k === " " || k === "Enter") {
    e.preventDefault();
    state = core.toggleDirection(state);
    syncUI();
    return;
  }
  if (k.length === 1 && /[a-zA-Z]/.test(k) && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    state = core.typeLetter(state, puzzle.grid, k);
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
    state = core.selectCell(state, r, c);
    state = core.typeLetter(state, puzzle.grid, letter);
    mutate();
  }
}

function updateCellVisuals() {
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
  const text = puzzle.clues[slot.dir][String(slot.number)];
  const dirLabel = slot.dir === "across" ? "Across" : "Down";
  els.clueActive.innerHTML =
    `<span class="mg-cluebar__num">${slot.number} ${dirLabel}</span>${esc(text)}`;
}

function buildClueLists() {
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
        state = core.jumpToSlot(state, slot);
        syncUI();
      });
      li.appendChild(btn);
      container.appendChild(li);
    }
  }
}

function updateClueListState() {
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
  els.helpBadge.hidden = !state.usedHelp;
}

function updateTimerDisplay() {
  els.timer.textContent = core.formatTime(core.elapsedMs(state, Date.now()));
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
  const input = cellInputs[state.cursor.r][state.cursor.c];
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
  const wasSolved = state.solvedAt != null;
  state = core.finishIfSolved(state, puzzle.grid, Date.now());
  if (!wasSolved && state.solvedAt != null) {
    saveState();
    showComplete(true);
  }
}

function showComplete(justSolved) {
  stopTimerLoop();
  updateTimerDisplay();
  els.completePanel.hidden = false;
  const time = core.formatTime(core.elapsedMs(state));
  els.completeTime.textContent = `Solved in ${time}${state.usedHelp ? " (with help)" : ""}`;
  if (justSolved) {
    confettiBurst();
    if (!isRandomMode) recordResult(GAME_ID, true);
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
  state = core.toggleDirection(state);
  syncUI();
});

els.cluePrev.addEventListener("click", () => {
  state = core.advanceClue(state, meta, -1);
  syncUI();
});

els.clueNext.addEventListener("click", () => {
  state = core.advanceClue(state, meta, 1);
  syncUI();
});

els.btnCheck.addEventListener("click", () => {
  state = core.checkCell(state, puzzle.grid);
  syncUI();
});

els.btnReveal.addEventListener("click", () => {
  state = core.revealCell(state, puzzle.grid);
  mutate();
});

els.btnShare.addEventListener("click", async () => {
  const url = new URL("../../index.html", location.href).href;
  const text = core.shareText({
    dateLabel: todayKey(),
    ms: core.elapsedMs(state),
    usedHelp: state.usedHelp,
    url,
  });
  await share(text);
});

function switchToRandom() {
  isRandomMode = true;
  stopTimerLoop();
  const idx = Math.floor(Math.random() * bank.puzzles.length);
  puzzle = bank.puzzles[idx];
  meta = core.parsePuzzle(puzzle);
  state = core.createInitialState(puzzle, Date.now());
  els.btnRandom.textContent = "Back to today's puzzle";
  els.randomBadge.hidden = false;
  els.completePanel.hidden = true;
  buildGrid();
  buildClueLists();
  fullRender();
  startTimerLoop();
  focusCursorCell();
}

function switchToDaily() {
  isRandomMode = false;
  stopTimerLoop();
  puzzle = todaysPuzzle();
  meta = core.parsePuzzle(puzzle);
  state = loadOrCreateDailyState();
  els.btnRandom.textContent = "Play a random puzzle";
  els.randomBadge.hidden = true;
  els.completePanel.hidden = true;
  buildGrid();
  buildClueLists();
  fullRender();
  if (state.solvedAt != null) {
    showComplete(false);
  } else {
    startTimerLoop();
  }
  focusCursorCell();
}

els.btnRandom.addEventListener("click", () => {
  if (isRandomMode) switchToDaily();
  else switchToRandom();
});

async function init() {
  try {
    bank = await loadBank();
  } catch (err) {
    toast("Could not load today's puzzle");
    return;
  }
  puzzle = todaysPuzzle();
  meta = core.parsePuzzle(puzzle);
  state = loadOrCreateDailyState();
  buildGrid();
  buildClueLists();
  fullRender();
  if (state.solvedAt != null) {
    showComplete(false);
  } else {
    startTimerLoop();
  }
  focusCursorCell();
}

init();
