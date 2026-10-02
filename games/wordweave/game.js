import {
  dayIndex,
  store,
  recordDaily,
  resolveArchiveDay,
  share,
  toast,
  confettiBurst,
  initChrome,
  diffTabs,
  watchDayRollover,
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
  withoutBlocked,
} from "./core.js";
import { BLOCKED_WORDS } from "../../assets/blocklist.js";

const GAME_ID = "wordweave";
const EPOCH = "2026-08-10";
const DIFFICULTIES = ["easy", "medium", "hard"];
const LABELS = { easy: "Easy", medium: "Medium", hard: "Hard" };
const DEFAULT_DIFFICULTY = "medium";
const HELP_HTML =
  "<p>Drag or tap through adjacent letters, in any of eight directions, to spell one of the hidden theme words. Found words lock in place.</p>" +
  "<p>One word touches two opposite edges of the grid. Find that spanning word and the theme is revealed. On Easy, the theme is shown from the start.</p>" +
  "<p>Any other real word you spell earns hint progress; three of them buy a hint that reveals a theme word for you.</p>" +
  "<p>Solve every word to finish. Every letter in the grid belongs to exactly one word, so nothing is wasted.</p>" +
  "<p>Easy, Medium, and Hard each carry their own puzzle, streak, and stats for the day.</p>" +
  "<p>On a keyboard: arrow keys move, space or enter selects, backspace undoes, escape clears.</p>";

const els = {};

let bank = null; // { easy: {puzzles}, medium: {puzzles}, hard: {puzzles} }
let activeDifficulty = DEFAULT_DIFFICULTY;
let dayNumber = 1;
let archive = null; // resolveArchiveDay(EPOCH, ...): the day, real or archived, we're playing

// Per-difficulty runtime data for today's puzzles.
const puzzles = {}; // difficulty -> puzzle
const dailyIndexes = {}; // difficulty -> index into that difficulty's bank
const states = {}; // difficulty -> core state
const startedAts = {}; // difficulty -> timestamp
const finishedAts = {}; // difficulty -> timestamp|null
const completionHandled = {}; // difficulty -> bool

let freePlay = null; // { difficulty, puzzleIndex, puzzle, state, startedAt, finishedAt } or null

let tileEls = new Map();
let foundCells = new Set();
let activeChain = [];
let cursor = [0, 0];
let gestureActive = false;
let movedDuringGesture = false;
let lastHoverKey = null;
let timerHandle = null;

function qs(id) {
  return document.getElementById(id);
}

function cacheEls() {
  els.difftabs = qs("ww-difftabs");
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
  els.completeTitle = qs("ww-complete-title");
  els.completeSummary = qs("ww-complete-summary");
  els.shareBtn = qs("ww-share-btn");
}

function cellKey(r, c) {
  return `${r},${c}`;
}

function wrappedIndex(length) {
  const idx = dayIndex(EPOCH, archive.now);
  return ((idx % length) + length) % length;
}

function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function summaryText(elapsed) {
  const state = currentState();
  const hints = state.hintsUsedCount;
  const hintNote = hints > 0 ? ` with ${hints} hint${hints === 1 ? "" : "s"}` : "";
  return `You wove every word in ${formatTime(elapsed)}${hintNote}.`;
}

// ---------------------------------------------------------------------
// Current puzzle/state (daily per difficulty, or free play)
// ---------------------------------------------------------------------

function currentPuzzle() {
  return freePlay ? freePlay.puzzle : puzzles[activeDifficulty];
}

function currentState() {
  return freePlay ? freePlay.state : states[activeDifficulty];
}

function setCurrentState(next) {
  if (freePlay) freePlay.state = next;
  else states[activeDifficulty] = next;
}

function currentStartedAt() {
  return freePlay ? freePlay.startedAt : startedAts[activeDifficulty];
}

function currentFinishedAt() {
  return freePlay ? freePlay.finishedAt : finishedAts[activeDifficulty];
}

function setCurrentFinishedAt(ts) {
  if (freePlay) freePlay.finishedAt = ts;
  else finishedAts[activeDifficulty] = ts;
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------

function renderGrid() {
  const puzzle = currentPuzzle();
  els.grid.innerHTML = "";
  tileEls = new Map();
  const rows = puzzle.grid.length;
  const cols = puzzle.grid[0].length;
  els.grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  els.grid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
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
  const state = currentState();
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
  const state = currentState();
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
  const puzzle = currentPuzzle();
  els.current.textContent = activeChain.map(([r, c]) => puzzle.grid[r][c]).join("");
  els.current.dataset.active = "true";
}

function renderProgress() {
  const puzzle = currentPuzzle();
  const state = currentState();
  const total = allTargetWords(puzzle).length;
  const found = total - remainingWords(puzzle, state).length;
  els.progress.textContent = `${found} / ${total} words`;
}

function renderFoundList() {
  const puzzle = currentPuzzle();
  const state = currentState();
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
  const state = currentState();
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
  const puzzle = currentPuzzle();
  const state = currentState();
  const diff = freePlay ? freePlay.difficulty : activeDifficulty;
  const revealed = diff === "easy" || Boolean(state.found[puzzle.spangram]);
  if (revealed) {
    els.banner.textContent = `Theme: ${puzzle.theme}`;
    els.banner.dataset.revealed = "true";
  } else {
    els.banner.textContent = freePlay
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
  const state = currentState();
  const finishedAt = currentFinishedAt();
  const now = state.complete && finishedAt ? finishedAt : Date.now();
  els.timer.textContent = formatTime(Math.max(0, Math.round((now - currentStartedAt()) / 1000)));
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
}

// ---------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------

function saveProgress() {
  if (freePlay) return;
  store(GAME_ID, activeDifficulty).saveDay(
    {
      puzzleIndex: dailyIndexes[activeDifficulty],
      core: states[activeDifficulty],
      startedAt: startedAts[activeDifficulty],
      finishedAt: finishedAts[activeDifficulty],
    },
    archive.dateKey
  );
}

// ---------------------------------------------------------------------
// Puzzle lifecycle
// ---------------------------------------------------------------------

function refreshDisplay() {
  activeChain = [];
  cursor = [0, 0];
  updateFoundCells();
  renderGrid();
  renderAll();

  const state = currentState();
  if (state.complete) {
    const finishedAt = currentFinishedAt();
    const elapsed = finishedAt ? Math.max(0, Math.round((finishedAt - currentStartedAt()) / 1000)) : 0;
    showComplete(elapsed);
  } else {
    els.complete.hidden = true;
    els.practice.hidden = true;
  }
  startTimer();
}

function showComplete(elapsed) {
  els.complete.hidden = false;
  els.completeTitle.textContent = freePlay ? "Random puzzle solved" : `${LABELS[activeDifficulty]} solved`;
  els.completeSummary.textContent = summaryText(elapsed);
  els.practice.hidden = Boolean(freePlay);
}

function handleComplete() {
  const diff = activeDifficulty;
  if (freePlay) {
    setCurrentFinishedAt(Date.now());
    stopTimer();
    updateTimerDisplay();
    const elapsed = Math.max(0, Math.round((freePlay.finishedAt - freePlay.startedAt) / 1000));
    confettiBurst();
    showComplete(elapsed);
    return;
  }

  if (completionHandled[diff]) return;
  completionHandled[diff] = true;
  finishedAts[diff] = Date.now();
  saveProgress();
  stopTimer();
  updateTimerDisplay();

  const elapsed = Math.max(0, Math.round((finishedAts[diff] - startedAts[diff]) / 1000));
  confettiBurst();
  showComplete(elapsed);
  if (!archive.isArchive) {
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const time = `${mins}:${String(secs).padStart(2, "0")}`;
    const hints = states[diff].hintsUsedCount;
    const hintNote = hints > 0 ? ` (${hints} hint${hints === 1 ? "" : "s"})` : "";
    recordDaily(GAME_ID, true, diff, archive, `${time}${hintNote}`);
  }
}

function startPractice() {
  const diff = activeDifficulty;
  const list = bank[diff].puzzles;
  const todaysIndex = dailyIndexes[diff];
  let idx = todaysIndex;
  if (list.length > 1) {
    while (idx === todaysIndex) idx = Math.floor(Math.random() * list.length);
  }
  freePlay = {
    difficulty: diff,
    puzzleIndex: idx,
    puzzle: withoutBlocked(list[idx], BLOCKED_WORDS),
    state: createState(),
    startedAt: Date.now(),
    finishedAt: null,
  };
  refreshDisplay();
}

function exitFreePlay() {
  freePlay = null;
}

// ---------------------------------------------------------------------
// Chain building
// ---------------------------------------------------------------------

function applyOutcome(outcome) {
  setCurrentState(outcome.state);
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

  if (currentState().complete) handleComplete();
}

function tryLiveMatch() {
  if (activeChain.length === 0) {
    paintGrid();
    renderChainUI();
    return;
  }
  const outcome = submitChain(currentPuzzle(), currentState(), activeChain);
  if (["spangram", "theme", "bonus"].includes(outcome.result.status)) {
    applyOutcome(outcome);
  } else {
    paintGrid();
    renderChainUI();
  }
}

function finalizeChain() {
  if (activeChain.length === 0) return;
  const outcome = submitChain(currentPuzzle(), currentState(), activeChain);
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
  const puzzle = currentPuzzle();
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
  const outcome = useHint(currentPuzzle(), currentState());
  if (outcome.result.status === "hint") {
    applyOutcome(outcome);
  } else {
    toast("No hint ready yet");
  }
}

async function onShareClick() {
  const finishedAt = currentFinishedAt();
  const elapsed = finishedAt ? Math.max(0, Math.round((finishedAt - currentStartedAt()) / 1000)) : 0;
  const diff = freePlay ? freePlay.difficulty : activeDifficulty;
  await share(shareText(currentPuzzle(), currentState(), dayNumber, elapsed, diff));
}

// ---------------------------------------------------------------------
// Difficulty tabs
// ---------------------------------------------------------------------

function switchDifficulty(next) {
  if (freePlay) exitFreePlay();
  activeDifficulty = next;
  refreshDisplay();
}

function loadToday(diff) {
  const list = bank[diff].puzzles;
  const idx = wrappedIndex(list.length);
  dailyIndexes[diff] = idx;
  puzzles[diff] = withoutBlocked(list[idx], BLOCKED_WORDS);

  const saved = store(GAME_ID, diff).loadDay(archive.dateKey);
  if (saved && saved.puzzleIndex === idx && saved.core) {
    states[diff] = saved.core;
    startedAts[diff] = saved.startedAt || Date.now();
    finishedAts[diff] = saved.finishedAt || null;
  } else {
    states[diff] = createState();
    startedAts[diff] = Date.now();
    finishedAts[diff] = null;
  }
  completionHandled[diff] = Boolean(states[diff].complete);
}

// ---------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------

async function main() {
  cacheEls();
  archive = resolveArchiveDay(EPOCH, new URLSearchParams(location.search).get("date"));
  initChrome({
    id: GAME_ID,
    name: "Wordweave",
    helpHTML: HELP_HTML,
    archiveDate: archive.isArchive ? archive.dateKey : null,
  });
  watchDayRollover(archive);

  try {
    const res = await fetch("../../data/wordweave.json");
    if (!res.ok) throw new Error(`bank fetch failed: ${res.status}`);
    bank = await res.json();
  } catch (err) {
    els.banner.textContent = "Could not load today's puzzle. Try reloading the page.";
    return;
  }

  for (const diff of DIFFICULTIES) {
    if (!bank[diff] || !bank[diff].puzzles || bank[diff].puzzles.length === 0) {
      els.banner.textContent = "No puzzles available.";
      return;
    }
  }

  dayNumber = archive.dayNumber;

  for (const diff of DIFFICULTIES) loadToday(diff);

  els.grid.addEventListener("pointerdown", onPointerDown);
  els.grid.addEventListener("keydown", onGridKeydown);
  els.grid.addEventListener("focusin", onGridFocusIn);
  window.addEventListener("pointermove", onPointerMove, { passive: false });
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  els.hintBtn.addEventListener("click", onHintClick);
  els.practiceBtn.addEventListener("click", startPractice);
  els.shareBtn.addEventListener("click", onShareClick);

  activeDifficulty = diffTabs(els.difftabs, GAME_ID, switchDifficulty, DEFAULT_DIFFICULTY);
  refreshDisplay();
}

main();
