import {
  pickDaily,
  store,
  diffTabs,
  recordResult,
  resolveArchiveDay,
  statsHTML,
  share,
  toast,
  confettiBurst,
  initChrome,
} from "../../assets/shared.js";

import { WORD_LENGTH, keyboardStates, createGame, submitGuess, isGameOver, shareText } from "./core.js";

const GAME_ID = "wordrow";
const EPOCH = "2026-08-10";
const HARDMODE_PREF_KEY = "pp.wordrow.hardmode";
const DIFFICULTIES = ["easy", "medium", "hard"];
const DIFF_LABELS = { easy: "Easy", medium: "Medium", hard: "Hard" };
const DEFAULT_DIFFICULTY = "medium";

// Per V2-CONTRACT.md: easy gets an extra guess and the most familiar
// answers, hard keeps six guesses but forces hard mode on the whole time.
const DIFF_CONFIG = {
  easy: { maxGuesses: 7, forcedHardMode: false },
  medium: { maxGuesses: 6, forcedHardMode: false },
  hard: { maxGuesses: 6, forcedHardMode: true },
};

const HELP_HTML =
  "<p>Guess the day's five-letter word.</p>" +
  "<p>After each guess, the tiles tell you how close you got: a filled ink-blue " +
  "tile with a ring means that letter is correct and in the right spot, an amber " +
  "tile with a dot means it's in the word but in the wrong spot, and gray means " +
  "it isn't in the word at all. The on-screen keyboard remembers what you've " +
  "learned as you go.</p>" +
  "<p>Easy gives you seven tries and sticks to the most familiar words. Medium " +
  "is the classic six tries. Hard also gives six tries but draws from a tougher " +
  "word pool and keeps hard mode on the whole time: any hint you reveal must be " +
  "reused in your next guess. Each difficulty keeps its own puzzle, streak, and " +
  "stats for the day.</p>" +
  "<p>Come back tomorrow for new words, or try a random puzzle for extra " +
  "practice once today's is done.</p>";

const KEY_ROWS = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["enter", "z", "x", "c", "v", "b", "n", "m", "back"],
];

const els = {
  diffTabsMount: document.getElementById("wr-diff-tabs"),
  status: document.getElementById("wr-status"),
  board: document.getElementById("wr-board"),
  keyboard: document.getElementById("wr-keyboard"),
  hardmode: document.getElementById("wr-hardmode"),
  random: document.getElementById("wr-random"),
  result: document.getElementById("wr-result"),
  resultHeadline: document.getElementById("wr-result-headline"),
  resultSub: document.getElementById("wr-result-sub"),
  resultStats: document.getElementById("wr-result-stats"),
  share: document.getElementById("wr-share"),
};

let bank = null;
let allowedSet = null;
let dayNumber = 0;
let archive = null; // resolveArchiveDay(EPOCH, ...): the day, real or archived, we're playing

let dayStores = null; // difficulty -> store(GAME_ID, difficulty)
const dailyAnswers = {}; // difficulty -> today's answer
const dailyStates = {}; // difficulty -> game state
const randomStates = {}; // difficulty -> game state or null

let activeDifficulty = DEFAULT_DIFFICULTY;
let mode = "daily"; // "daily" | "random"
let input = "";
let busy = false; // true while a reveal animation is in flight

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function loadHardModePref() {
  try {
    return localStorage.getItem(HARDMODE_PREF_KEY) === "1";
  } catch {
    return false;
  }
}

function saveHardModePref(on) {
  try {
    localStorage.setItem(HARDMODE_PREF_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function activeState() {
  return mode === "daily" ? dailyStates[activeDifficulty] : randomStates[activeDifficulty];
}

function setActiveState(next) {
  if (mode === "daily") {
    dailyStates[activeDifficulty] = next;
    dayStores[activeDifficulty].saveDay(next, archive.dateKey);
  } else {
    randomStates[activeDifficulty] = next;
    dayStores[activeDifficulty].saveDay(next, "random");
  }
}

function persistedStateMatchesAnswer(saved, answer) {
  return saved && saved.answer === answer && Array.isArray(saved.guesses);
}

function initGames() {
  const hardModePref = loadHardModePref();

  for (const diff of DIFFICULTIES) {
    const config = DIFF_CONFIG[diff];
    const answer = pickDaily(bank[diff].answers, EPOCH, archive.now);
    dailyAnswers[diff] = answer;

    const s = dayStores[diff];
    const savedDaily = s.loadDay(archive.dateKey);
    dailyStates[diff] = persistedStateMatchesAnswer(savedDaily, answer)
      ? savedDaily
      : createGame(answer, {
          hardMode: config.forcedHardMode || hardModePref,
          maxGuesses: config.maxGuesses,
        });

    const savedRandom = s.loadDay("random");
    randomStates[diff] = savedRandom && Array.isArray(savedRandom.guesses) ? savedRandom : null;
  }
}

function pickRandomAnswer(diff) {
  const pool = bank[diff].answers;
  const today = dailyAnswers[diff];
  let candidate = pool[Math.floor(Math.random() * pool.length)];
  if (pool.length > 1) {
    while (candidate === today) {
      candidate = pool[Math.floor(Math.random() * pool.length)];
    }
  }
  return candidate;
}

function startRandomGame() {
  const config = DIFF_CONFIG[activeDifficulty];
  mode = "random";
  const carriedHardMode = config.forcedHardMode || activeState()?.hardMode || false;
  randomStates[activeDifficulty] = createGame(pickRandomAnswer(activeDifficulty), {
    hardMode: carriedHardMode,
    maxGuesses: config.maxGuesses,
  });
  dayStores[activeDifficulty].saveDay(randomStates[activeDifficulty], "random");
  input = "";
  renderAll();
}

// ---------- rendering ----------

function tileHTML(letter, state) {
  const attr = state ? ` data-state="${state}"` : "";
  return `<div class="pp-tile"${attr}>${letter ? letter.toUpperCase() : ""}</div>`;
}

function renderBoard() {
  const state = activeState();
  const maxGuesses = state.maxGuesses;
  const rows = [];

  for (let r = 0; r < maxGuesses; r++) {
    const guess = state.guesses[r];
    const evaluation = state.evaluations[r];
    let cells = "";

    if (guess) {
      for (let c = 0; c < WORD_LENGTH; c++) {
        cells += tileHTML(guess[c], evaluation[c]);
      }
    } else if (r === state.guesses.length && state.status === "playing") {
      for (let c = 0; c < WORD_LENGTH; c++) {
        cells += tileHTML(input[c] || "");
      }
    } else {
      for (let c = 0; c < WORD_LENGTH; c++) cells += tileHTML("");
    }

    rows.push(`<div class="wr-row" data-row="${r}">${cells}</div>`);
  }

  els.board.innerHTML = rows.join("");
  els.board.dataset.rows = String(maxGuesses);
}

function keyLabel(key) {
  if (key === "enter") return "Enter";
  if (key === "back") {
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true"><path d="M21 4H8l-6 8 6 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/>' +
      '<path d="M18 9l-6 6M12 9l6 6"/></svg>'
    );
  }
  return key.toUpperCase();
}

function renderKeyboard() {
  const state = activeState();
  const states = keyboardStates(state.guesses, state.evaluations);

  const rowsHTML = KEY_ROWS.map((row) => {
    const keys = row
      .map((key) => {
        const wide = key === "enter" || key === "back" ? " wr-key--wide" : "";
        const st = states[key] ? ` data-state="${states[key]}"` : "";
        const label = key === "enter" ? "Enter" : key === "back" ? "Backspace" : key.toUpperCase();
        return (
          `<button type="button" class="wr-key${wide}" data-key="${key}"${st} aria-label="${label}">` +
          `${keyLabel(key)}</button>`
        );
      })
      .join("");
    return `<div class="wr-keyboard__row">${keys}</div>`;
  }).join("");

  els.keyboard.innerHTML = rowsHTML;
  els.keyboard.querySelectorAll("[data-key]").forEach((btn) => {
    btn.addEventListener("click", () => handleKey(btn.dataset.key));
  });
}

function renderToolbar() {
  const state = activeState();
  const forced = DIFF_CONFIG[activeDifficulty].forcedHardMode;
  const locked = forced || state.guesses.length > 0;
  els.hardmode.setAttribute("aria-pressed", String(state.hardMode));
  els.hardmode.dataset.state = state.hardMode ? "progress" : "";
  els.hardmode.disabled = locked;
  els.hardmode.title = forced
    ? "Hard mode is always on for Hard difficulty"
    : locked
      ? "Hard mode can only change before your first guess"
      : "";

  const dailyOver = dailyStates[activeDifficulty].status !== "playing";
  els.random.hidden = !dailyOver;
  els.random.textContent = mode === "random" ? "New random puzzle" : "Random puzzle";
}

function renderStatus() {
  const state = activeState();
  if (mode === "random") {
    els.status.textContent = state.status === "playing" ? "Free play" : "";
    return;
  }
  if (state.status === "playing") {
    els.status.textContent = `Guess ${state.guesses.length + 1} of ${state.maxGuesses}`;
  } else {
    els.status.textContent = "";
  }
}

function renderResult() {
  const state = activeState();
  if (!isGameOver(state)) {
    els.result.hidden = true;
    return;
  }

  els.result.hidden = false;
  els.resultHeadline.textContent =
    state.status === "won"
      ? state.guesses.length === 1
        ? "Got it in one!"
        : `Solved in ${state.guesses.length} of ${state.maxGuesses}.`
      : `Not this time. The word was ${state.answer.toUpperCase()}.`;

  els.resultSub.textContent =
    mode === "random" ? "Free play, your streak is untouched." : "";

  if (mode === "daily") {
    els.resultStats.hidden = false;
    els.resultStats.innerHTML = statsHTML(GAME_ID, activeDifficulty);
  } else {
    els.resultStats.hidden = true;
    els.resultStats.innerHTML = "";
  }
}

function renderAll() {
  renderBoard();
  renderKeyboard();
  renderToolbar();
  renderStatus();
  renderResult();
}

// ---------- input handling ----------

function handleKey(key) {
  if (busy) return;
  const state = activeState();
  if (state.status !== "playing") return;

  if (key === "enter") {
    submitCurrent();
    return;
  }
  if (key === "back") {
    input = input.slice(0, -1);
    renderBoard();
    return;
  }
  if (/^[a-z]$/.test(key) && input.length < WORD_LENGTH) {
    input += key;
    renderBoard();
  }
}

function shakeActiveRow() {
  const state = activeState();
  const row = els.board.querySelector(`[data-row="${state.guesses.length}"]`);
  if (!row) return;
  row.classList.remove("wr-row--shake");
  row.offsetWidth; // force reflow so the animation replays on repeat errors
  row.classList.add("wr-row--shake");
}

function submitCurrent() {
  const state = activeState();
  const { state: next, error } = submitGuess(state, input, { allowed: allowedSet });

  if (error) {
    toast(error);
    shakeActiveRow();
    return;
  }

  const rowIndex = state.guesses.length;
  const evaluation = next.evaluations[rowIndex];
  input = "";
  revealRow(rowIndex, evaluation, () => finishSubmit(next));
}

function revealRow(rowIndex, evaluation, done) {
  const row = els.board.querySelector(`[data-row="${rowIndex}"]`);
  const tiles = row ? Array.from(row.children) : [];
  const reduced = prefersReducedMotion();
  const stagger = reduced ? 0 : 90;
  const flipMs = reduced ? 0 : 420;

  if (!row || reduced) {
    tiles.forEach((tile, i) => tile.setAttribute("data-state", evaluation[i]));
    done();
    return;
  }

  busy = true;
  tiles.forEach((tile, i) => {
    tile.style.animationDelay = `${i * stagger}ms`;
    tile.classList.add("pp-tile--flip");
    window.setTimeout(() => tile.setAttribute("data-state", evaluation[i]), i * stagger + flipMs / 2);
  });

  window.setTimeout(() => {
    busy = false;
    done();
  }, (tiles.length - 1) * stagger + flipMs);
}

function finishSubmit(next) {
  setActiveState(next);

  if (isGameOver(next) && mode === "daily" && !archive.isArchive) {
    recordResult(GAME_ID, next.status === "won", activeDifficulty);
  }

  renderAll();

  if (isGameOver(next) && next.status === "won") {
    confettiBurst();
  }
}

function toggleHardMode() {
  if (DIFF_CONFIG[activeDifficulty].forcedHardMode) return;
  const state = activeState();
  if (state.guesses.length > 0) {
    toast("Hard mode can only change before your first guess");
    return;
  }
  const next = { ...state, hardMode: !state.hardMode };
  setActiveState(next);
  if (mode === "daily") saveHardModePref(next.hardMode);
  renderToolbar();
}

function isModalOpen() {
  return Boolean(document.querySelector(".pp-modal-backdrop"));
}

function onPhysicalKeydown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (isModalOpen()) return;
  const active = document.activeElement;
  if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;

  if (e.key === "Enter") {
    e.preventDefault();
    handleKey("enter");
  } else if (e.key === "Backspace") {
    e.preventDefault();
    handleKey("back");
  } else if (/^[a-zA-Z]$/.test(e.key)) {
    handleKey(e.key.toLowerCase());
  }
}

async function onShare() {
  const state = activeState();
  const text = shareText(state, {
    dayNumber: mode === "daily" ? dayNumber : "R",
    diffLabel: DIFF_LABELS[activeDifficulty],
  });
  await share(text);
}

// ---------- difficulty switching ----------

function switchDifficulty(diff) {
  activeDifficulty = diff;
  mode = "daily";
  input = "";
  renderAll();
}

// ---------- boot ----------

async function boot() {
  archive = resolveArchiveDay(EPOCH, new URLSearchParams(location.search).get("date"));
  initChrome({
    id: GAME_ID,
    name: "Wordrow",
    hubHref: "../../index.html",
    helpHTML: HELP_HTML,
    archiveDate: archive.isArchive ? archive.dateKey : null,
  });

  try {
    const res = await fetch("../../data/wordrow.json");
    bank = await res.json();
  } catch {
    els.status.textContent = "Could not load today's puzzle. Try reloading.";
    return;
  }

  // Every difficulty ships the identical allowed pool (see gen_wordrow.py),
  // so any one section's list works as the shared guess dictionary.
  allowedSet = new Set(bank[DEFAULT_DIFFICULTY].allowed);
  dayNumber = archive.dayNumber;
  dayStores = Object.fromEntries(DIFFICULTIES.map((d) => [d, store(GAME_ID, d)]));

  initGames();

  activeDifficulty = diffTabs(els.diffTabsMount, GAME_ID, switchDifficulty, DEFAULT_DIFFICULTY);
  renderAll();

  document.addEventListener("keydown", onPhysicalKeydown);
  els.hardmode.addEventListener("click", toggleHardMode);
  els.random.addEventListener("click", startRandomGame);
  els.share.addEventListener("click", onShare);
}

boot();
