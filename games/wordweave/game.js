import {
  dayIndex,
  todayKey,
  store,
  recordResult,
  share,
  toast,
  confettiBurst,
  initChrome,
} from "../../assets/shared.js";
import {
  createState,
  allTargetWords,
  remainingWords,
  hintChargesAvailable,
  submitChain,
  useHint,
  shareText,
  cellsAdjacent,
} from "./core.js";

const GAME_ID = "wordweave";
const EPOCH = "2026-08-10";
const HELP_HTML =
  "<p>Drag or tap through adjacent letters, in any of eight directions, to spell one of the hidden theme words. Found words lock in place.</p>" +
  "<p>One word touches two opposite edges of the grid. Find that spanning word and the theme is revealed.</p>" +
  "<p>Any other real word you spell earns hint progress; three of them buy a hint that reveals a theme word for you.</p>" +
  "<p>Solve every word to finish. Every letter in the grid belongs to exactly one word, so nothing is wasted.</p>" +
  "<p>On a keyboard: arrow keys move, space or enter selects, backspace undoes, escape clears.</p>";

const dayStore = store(GAME_ID);
const els = {};

let bank = null;
let puzzle = null;
let state = createState();
let mode = "daily";
let dailyIndex = 0;
let currentPuzzleIndex = 0;
let dayNumber = 1;
let startedAt = Date.now();
let finishedAt = null;
let completionHandled = false;
let timerHandle = null;

let tileEls = new Map();
let foundCells = new Set();
let activeChain = [];
let cursor = [0, 0];
let gestureActive = false;
let movedDuringGesture = false;
let lastHoverKey = null;

function qs(id) {
  return document.getElementById(id);
}

function cacheEls() {
  els.banner = qs("ww-theme-banner");
  els.progress = qs("ww-progress");
  els.timer = qs("ww-timer");
  els.grid = qs("ww-grid");
  els.current = qs("ww-current");
  els.hintMeter = qs("ww-hint-meter");
  els.hintLabel = qs("ww-hint-label");
  els.hintBtn = qs("ww-hint-btn");
  els.foundList = qs("ww-found-list");
  els.practice = qs("ww-practice");
  els.practiceBtn = qs("ww-practice-btn");
  els.complete = qs("ww-complete");
  els.completeSummary = qs("ww-complete-summary");
  els.shareBtn = qs("ww-share-btn");
}

function cellKey(r, c) {
  return `${r},${c}`;
}

function wrappedDayIndex(length) {
  const idx = dayIndex(EPOCH);
  return ((idx % length) + length) % length;
}

function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function summaryText(elapsed) {
  const hints = state.hintsUsedCount;
  const hintNote = hints > 0 ? ` with ${hints} hint${hints === 1 ? "" : "s"}` : "";
  return `You wove every word in ${formatTime(elapsed)}${hintNote}.`;
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------

function renderGrid() {
  els.grid.innerHTML = "";
  tileEls = new Map();
  const rows = puzzle.grid.length;
  const cols = puzzle.grid[0].length;
  const frag = document.createDocumentFragment();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ww-tile";
      btn.textContent = puzzle.grid[r][c];
      btn.dataset.r = String(r);
      btn.dataset.c = String(c);
      btn.tabIndex = r === cursor[0] && c === cursor[1] ? 0 : -1;
      btn.setAttribute("aria-label", `${puzzle.grid[r][c]}, row ${r + 1}, column ${c + 1}`);
      btn.setAttribute("aria-pressed", "false");
      frag.appendChild(btn);
      tileEls.set(cellKey(r, c), btn);
    }
  }
  els.grid.appendChild(frag);
}

function paintGrid() {
  const selected = new Set(activeChain.map(([r, c]) => cellKey(r, c)));
  const foundType = {};
  for (const word of Object.keys(state.found)) {
    const entry = state.found[word];
    for (const [r, c] of entry.cells) foundType[cellKey(r, c)] = entry.type;
  }
  for (const [key, btn] of tileEls) {
    const type = foundType[key];
    if (type) {
      btn.dataset.state = type;
      btn.disabled = true;
      btn.setAttribute("aria-pressed", "false");
    } else if (selected.has(key)) {
      btn.dataset.state = "selected";
      btn.disabled = false;
      btn.setAttribute("aria-pressed", "true");
    } else {
      delete btn.dataset.state;
      btn.disabled = false;
      btn.setAttribute("aria-pressed", "false");
    }
  }
}

function updateFoundCells() {
  foundCells = new Set();
  for (const word of Object.keys(state.found)) {
    for (const [r, c] of state.found[word].cells) foundCells.add(cellKey(r, c));
  }
}

function renderChainUI() {
  if (activeChain.length === 0) {
    els.current.textContent = "";
    delete els.current.dataset.active;
    return;
  }
  els.current.textContent = activeChain.map(([r, c]) => puzzle.grid[r][c]).join("");
  els.current.dataset.active = "true";
}

function renderProgress() {
  const total = allTargetWords(puzzle).length;
  const found = total - remainingWords(puzzle, state).length;
  els.progress.textContent = `${found} / ${total} words`;
}

function renderFoundList() {
  els.foundList.innerHTML = "";
  const order = [puzzle.spangram, ...puzzle.words];
  for (const word of order) {
    const entry = state.found[word];
    if (!entry) continue;
    const li = document.createElement("li");
    li.className = "ww-found__chip";
    li.dataset.type = entry.type;
    li.textContent = word;
    els.foundList.appendChild(li);
  }
}

function renderHintMeter() {
  const progress = state.bonusFound.length % 3;
  const charges = hintChargesAvailable(state);
  const dots = els.hintMeter.querySelectorAll(".ww-hint-dot");
  dots.forEach((dot, i) => {
    dot.classList.toggle("ww-hint-dot--filled", charges > 0 || i < progress);
  });
  els.hintBtn.disabled = charges < 1;
  els.hintLabel.textContent =
    charges > 0
      ? `${charges} hint${charges === 1 ? "" : "s"} ready`
      : `Find non-theme words to earn a hint (${progress}/3)`;
}

function renderBanner() {
  if (state.found[puzzle.spangram]) {
    els.banner.textContent = `Theme: ${puzzle.theme}`;
    els.banner.dataset.revealed = "true";
  } else {
    els.banner.textContent =
      mode === "practice"
        ? "Practice puzzle: find the spanning word to reveal its theme."
        : "Find the spanning word to reveal today's theme.";
    delete els.banner.dataset.revealed;
  }
}

function renderAll() {
  paintGrid();
  renderChainUI();
  renderProgress();
  renderFoundList();
  renderHintMeter();
  renderBanner();
}

// ---------------------------------------------------------------------
// Timer
// ---------------------------------------------------------------------

function updateTimerDisplay() {
  const now = state.complete && finishedAt ? finishedAt : Date.now();
  els.timer.textContent = formatTime(Math.max(0, Math.round((now - startedAt) / 1000)));
}

function startTimer() {
  stopTimer();
  updateTimerDisplay();
  timerHandle = window.setInterval(updateTimerDisplay, 1000);
}

function stopTimer() {
  if (timerHandle) {
    window.clearInterval(timerHandle);
    timerHandle = null;
  }
  updateTimerDisplay();
}

// ---------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------

function saveProgress() {
  if (mode !== "daily") return;
  dayStore.saveDay({
    puzzleIndex: currentPuzzleIndex,
    core: state,
    startedAt,
    finishedAt,
  });
}

// ---------------------------------------------------------------------
// Puzzle lifecycle
// ---------------------------------------------------------------------

function loadPuzzle(idx, coreState, started, finished) {
  currentPuzzleIndex = idx;
  puzzle = bank.puzzles[idx];
  state = coreState;
  startedAt = started;
  finishedAt = finished;
  completionHandled = Boolean(state.complete);
  activeChain = [];
  cursor = [0, 0];

  updateFoundCells();
  renderGrid();
  renderAll();

  if (state.complete) {
    els.complete.hidden = false;
    const elapsed = finishedAt ? Math.max(0, Math.round((finishedAt - startedAt) / 1000)) : 0;
    els.completeSummary.textContent = summaryText(elapsed);
    els.practice.hidden = mode !== "daily";
    stopTimer();
  } else {
    els.complete.hidden = true;
    els.practice.hidden = true;
    startTimer();
  }
}

function handleComplete() {
  if (completionHandled) return;
  completionHandled = true;
  finishedAt = Date.now();
  saveProgress();
  stopTimer();

  els.complete.hidden = false;
  const elapsed = Math.max(0, Math.round((finishedAt - startedAt) / 1000));
  els.completeSummary.textContent = summaryText(elapsed);
  confettiBurst();

  if (mode === "daily") {
    recordResult(GAME_ID, true);
    els.practice.hidden = false;
  }
}

function startPractice() {
  const total = bank.puzzles.length;
  let idx = dailyIndex;
  if (total > 1) {
    while (idx === dailyIndex) idx = Math.floor(Math.random() * total);
  }
  mode = "practice";
  loadPuzzle(idx, createState(), Date.now(), null);
}

// ---------------------------------------------------------------------
// Chain building
// ---------------------------------------------------------------------

function applyOutcome(outcome) {
  state = outcome.state;
  activeChain = [];
  updateFoundCells();
  saveProgress();
  renderAll();

  const { status, word } = outcome.result;
  if (status === "spangram") {
    toast(`Spangram found: ${word}`);
  } else if (status === "theme") {
    toast(`Found: ${word}`);
  } else if (status === "bonus") {
    toast(`Bonus word: ${word}`);
  } else if (status === "hint") {
    toast("Hint used: a word is revealed");
  }

  if (state.complete) handleComplete();
}

function tryLiveMatch() {
  if (activeChain.length === 0) {
    paintGrid();
    renderChainUI();
    return;
  }
  const outcome = submitChain(puzzle, state, activeChain);
  if (["spangram", "theme", "bonus"].includes(outcome.result.status)) {
    applyOutcome(outcome);
  } else {
    paintGrid();
    renderChainUI();
  }
}

function finalizeChain() {
  if (activeChain.length === 0) return;
  const outcome = submitChain(puzzle, state, activeChain);
  if (["spangram", "theme", "bonus"].includes(outcome.result.status)) {
    applyOutcome(outcome);
    return;
  }
  if (outcome.result.status === "already-found") toast("Already found");
  activeChain = [];
  paintGrid();
  renderChainUI();
}

function tapCell(r, c) {
  if (foundCells.has(cellKey(r, c))) return;
  if (activeChain.length === 0) {
    activeChain = [[r, c]];
    paintGrid();
    renderChainUI();
    return;
  }
  const last = activeChain[activeChain.length - 1];
  if (last[0] === r && last[1] === c) {
    finalizeChain();
    return;
  }
  const idx = activeChain.findIndex(([cr, cc]) => cr === r && cc === c);
  if (idx !== -1) {
    activeChain = activeChain.slice(0, idx + 1);
    paintGrid();
    renderChainUI();
    return;
  }
  if (cellsAdjacent(last, [r, c])) {
    activeChain.push([r, c]);
    tryLiveMatch();
  } else {
    activeChain = [[r, c]];
    paintGrid();
    renderChainUI();
  }
}

// ---------------------------------------------------------------------
// Pointer / touch / keyboard wiring
// ---------------------------------------------------------------------

function tileFromPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  const btn = el && el.closest ? el.closest(".ww-tile") : null;
  if (!btn || !els.grid.contains(btn)) return null;
  return [Number(btn.dataset.r), Number(btn.dataset.c)];
}

function onPointerDown(e) {
  const btn = e.target.closest(".ww-tile");
  if (!btn) return;
  gestureActive = true;
  movedDuringGesture = false;
  const r = Number(btn.dataset.r);
  const c = Number(btn.dataset.c);
  lastHoverKey = cellKey(r, c);
  tapCell(r, c);
}

function onPointerMove(e) {
  if (!gestureActive) return;
  const cell = tileFromPoint(e.clientX, e.clientY);
  if (!cell) return;
  const key = cellKey(cell[0], cell[1]);
  if (key === lastHoverKey) return;
  movedDuringGesture = true;
  lastHoverKey = key;
  if (e.cancelable) e.preventDefault();
  tapCell(cell[0], cell[1]);
}

function onPointerUp() {
  if (!gestureActive) return;
  gestureActive = false;
  if (movedDuringGesture) finalizeChain();
  movedDuringGesture = false;
  lastHoverKey = null;
}

function focusCursor() {
  for (const btn of tileEls.values()) btn.tabIndex = -1;
  const btn = tileEls.get(cellKey(cursor[0], cursor[1]));
  if (btn) {
    btn.tabIndex = 0;
    btn.focus();
  }
}

function moveCursor(dr, dc) {
  const rows = puzzle.grid.length;
  const cols = puzzle.grid[0].length;
  const r = Math.min(rows - 1, Math.max(0, cursor[0] + dr));
  const c = Math.min(cols - 1, Math.max(0, cursor[1] + dc));
  cursor = [r, c];
  focusCursor();
}

function onGridFocusIn(e) {
  const btn = e.target.closest(".ww-tile");
  if (!btn) return;
  cursor = [Number(btn.dataset.r), Number(btn.dataset.c)];
}

function onGridKeydown(e) {
  switch (e.key) {
    case "ArrowUp":
      e.preventDefault();
      moveCursor(-1, 0);
      break;
    case "ArrowDown":
      e.preventDefault();
      moveCursor(1, 0);
      break;
    case "ArrowLeft":
      e.preventDefault();
      moveCursor(0, -1);
      break;
    case "ArrowRight":
      e.preventDefault();
      moveCursor(0, 1);
      break;
    case " ":
    case "Enter":
      e.preventDefault();
      tapCell(cursor[0], cursor[1]);
      break;
    case "Backspace":
      if (activeChain.length > 0) {
        e.preventDefault();
        activeChain = activeChain.slice(0, -1);
        paintGrid();
        renderChainUI();
      }
      break;
    case "Escape":
      if (activeChain.length > 0) {
        e.preventDefault();
        activeChain = [];
        paintGrid();
        renderChainUI();
      }
      break;
    default:
      break;
  }
}

function onHintClick() {
  const outcome = useHint(puzzle, state);
  if (outcome.result.status === "hint") {
    applyOutcome(outcome);
  } else {
    toast("No hint ready yet");
  }
}

async function onShareClick() {
  const elapsed = finishedAt ? Math.max(0, Math.round((finishedAt - startedAt) / 1000)) : 0;
  await share(shareText(puzzle, state, dayNumber, elapsed));
}

// ---------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------

async function main() {
  cacheEls();
  initChrome({ id: GAME_ID, name: "Wordweave", helpHTML: HELP_HTML });

  try {
    const res = await fetch("../../data/wordweave.json");
    if (!res.ok) throw new Error(`bank fetch failed: ${res.status}`);
    bank = await res.json();
  } catch (err) {
    els.banner.textContent = "Could not load today's puzzle. Try reloading the page.";
    return;
  }

  if (!bank.puzzles || bank.puzzles.length === 0) {
    els.banner.textContent = "No puzzles available.";
    return;
  }

  dailyIndex = wrappedDayIndex(bank.puzzles.length);
  dayNumber = Math.max(1, dayIndex(EPOCH) + 1);

  const saved = dayStore.loadDay();
  if (saved && saved.puzzleIndex === dailyIndex && saved.core) {
    loadPuzzle(dailyIndex, saved.core, saved.startedAt || Date.now(), saved.finishedAt || null);
  } else {
    loadPuzzle(dailyIndex, createState(), Date.now(), null);
  }

  window.addEventListener("pointermove", onPointerMove, { passive: false });
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  els.grid.addEventListener("pointerdown", onPointerDown);
  els.grid.addEventListener("keydown", onGridKeydown);
  els.grid.addEventListener("focusin", onGridFocusIn);
  els.hintBtn.addEventListener("click", onHintClick);
  els.practiceBtn.addEventListener("click", startPractice);
  els.shareBtn.addEventListener("click", onShareClick);
}

main();
