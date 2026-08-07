import {
  pickDaily,
  store,
  recordResult,
  share,
  toast,
  confettiBurst,
  initChrome,
  todayKey,
} from "../../assets/shared.js";

import {
  canAppendLetter,
  lettersUsed,
  submitWord,
  progressCount,
  requiredStartLetter,
  resultSummary,
  MIN_WORD_LENGTH,
} from "./core.js";

const EPOCH = "2026-08-10";
const GAME_ID = "edgeways";

const HELP_HTML = `
  <p>Twelve letters sit around a square, three to a side.</p>
  <p>Build a word by tapping letters in order, but you can never use two
  letters from the same side back to back.</p>
  <p>Each new word has to start with the last letter of the one before it.</p>
  <p>Get all twelve letters into your words and you have solved it.</p>
  <p>Words need at least three letters and have to be real ones.</p>
`;

const els = {
  progress: document.getElementById("ed-progress"),
  wordCount: document.getElementById("ed-word-count"),
  par: document.getElementById("ed-par"),
  board: document.getElementById("ed-board"),
  lines: document.getElementById("ed-lines"),
  current: document.getElementById("ed-current"),
  message: document.getElementById("ed-message"),
  controls: document.getElementById("ed-controls"),
  restart: document.getElementById("ed-restart"),
  backspace: document.getElementById("ed-backspace"),
  enter: document.getElementById("ed-enter"),
  foundList: document.getElementById("ed-found-list"),
  done: document.getElementById("ed-done"),
  doneHeadline: document.getElementById("ed-done-headline"),
  share: document.getElementById("ed-share"),
  practice: document.getElementById("ed-practice"),
  practiceNote: document.getElementById("ed-practice-note"),
};

const REASON_MESSAGES = {
  empty: "Type a word first.",
  short: `Words need at least ${MIN_WORD_LENGTH} letters.`,
  "off-board": "That letter isn't on the square.",
  "same-side": "Can't use two letters from the same side back to back.",
  "unknown-word": "Not a word we know.",
};

/** @type {{sides:string[], par:number, mode:"daily"|"random", words:string[], buffer:string[], solved:boolean}} */
let state = null;
let dictionary = null;
let bank = null;
let letterEls = new Map();

function seedBuffer(words) {
  const start = requiredStartLetter(words);
  return start ? [start] : [];
}

function boardStore() {
  return store(GAME_ID);
}

function loadDailyPuzzle() {
  return pickDaily(bank, EPOCH);
}

function sameSides(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((s, i) => s === b[i]);
}

function initDailyState() {
  const puzzle = loadDailyPuzzle();
  const saved = boardStore().loadDay();
  if (saved && sameSides(saved.sides, puzzle.sides)) {
    return {
      sides: puzzle.sides,
      par: puzzle.par,
      mode: "daily",
      words: saved.words || [],
      buffer: saved.buffer || seedBuffer(saved.words || []),
      solved: !!saved.solved,
    };
  }
  return {
    sides: puzzle.sides,
    par: puzzle.par,
    mode: "daily",
    words: [],
    buffer: [],
    solved: false,
  };
}

function randomPuzzle() {
  const list = bank.puzzles;
  const idx = Math.floor(Math.random() * list.length);
  return list[idx];
}

function persist() {
  if (state.mode !== "daily") return;
  boardStore().saveDay({
    sides: state.sides,
    words: state.words,
    buffer: state.buffer,
    solved: state.solved,
  });
}

/* ---------- rendering ---------- */

function buildBoard() {
  els.board.querySelectorAll(".ed-board__side").forEach((el) => (el.innerHTML = ""));
  letterEls = new Map();
  state.sides.forEach((side, sideIndex) => {
    const container = els.board.querySelector(`[data-side="${sideIndex}"]`);
    for (const letter of side) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ed-letter";
      btn.textContent = letter;
      btn.setAttribute("aria-label", `Letter ${letter}`);
      btn.dataset.letter = letter;
      btn.addEventListener("click", () => tapLetter(letter));
      container.appendChild(btn);
      letterEls.set(letter, btn);
    }
  });
}

function renderMeta() {
  const total = progressCount(state.words, state.sides);
  els.progress.textContent = `${total} / 12`;
  els.wordCount.textContent = String(state.words.length);
  els.par.textContent = String(state.par);
}

function renderLetters() {
  const used = lettersUsed(state.words);
  for (const [letter, btn] of letterEls) {
    const active = state.buffer.includes(letter);
    btn.dataset.active = active ? "true" : "false";
    btn.dataset.used = used.has(letter) ? "true" : "false";
    btn.disabled = state.solved || !canAppendLetter(state.buffer, letter, state.sides);
  }
}

function renderCurrent() {
  if (state.buffer.length) {
    els.current.textContent = state.buffer.join("");
    els.current.classList.remove("ed-current--hint");
  } else {
    els.current.textContent = "Tap a letter to start";
    els.current.classList.add("ed-current--hint");
  }
}

function renderFoundWords() {
  els.foundList.innerHTML = state.words
    .map((w) => `<li>${w}</li>`)
    .join("");
}

function renderControls() {
  els.controls.hidden = state.solved;
  els.current.hidden = state.solved;
  if (state.solved) return;
  const seedLen = state.words.length ? 1 : 0;
  els.backspace.disabled = state.buffer.length <= seedLen;
  els.enter.disabled = state.buffer.length < MIN_WORD_LENGTH;
}

function renderDone() {
  if (!state.solved) {
    els.done.hidden = true;
    return;
  }
  const summary = resultSummary(state.words, state.par);
  els.doneHeadline.textContent = summary.underPar
    ? `Solved in ${summary.count}, right at par.`
    : `Solved in ${summary.count} (par was ${summary.par}).`;
  els.done.hidden = false;
  els.practice.textContent =
    state.mode === "daily" ? "Play a random puzzle" : "Another random puzzle";
}

function drawLines() {
  if (!state.buffer.length) {
    els.lines.innerHTML = "";
    return;
  }
  const boardRect = els.board.getBoundingClientRect();
  const points = state.buffer
    .map((letter) => letterEls.get(letter))
    .filter(Boolean)
    .map((el) => {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2 - boardRect.left;
      const y = r.top + r.height / 2 - boardRect.top;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
  if (points.length < 2) {
    els.lines.innerHTML = "";
    return;
  }
  els.lines.innerHTML = `<path d="M${points.join(" L")}"></path>`;
}

function renderAll() {
  renderMeta();
  renderLetters();
  renderCurrent();
  renderFoundWords();
  renderControls();
  renderDone();
  requestAnimationFrame(drawLines);
}

function showMessage(text, tone = "bad") {
  els.message.textContent = text;
  els.message.dataset.tone = tone;
}

/* ---------- interaction ---------- */

function tapLetter(letter) {
  if (state.solved) return;
  if (!canAppendLetter(state.buffer, letter, state.sides)) return;
  state.buffer = [...state.buffer, letter];
  showMessage("");
  renderLetters();
  renderCurrent();
  renderControls();
  requestAnimationFrame(drawLines);
}

function backspace() {
  if (state.solved) return;
  const seedLen = state.words.length ? 1 : 0;
  if (state.buffer.length <= seedLen) return;
  state.buffer = state.buffer.slice(0, -1);
  showMessage("");
  renderLetters();
  renderCurrent();
  renderControls();
  requestAnimationFrame(drawLines);
}

function restart() {
  if (state.solved) return;
  state.words = [];
  state.buffer = [];
  state.solved = false;
  showMessage("");
  persist();
  renderAll();
}

function submitCurrent() {
  if (state.solved) return;
  const word = state.buffer.join("");
  const previousWordsSnapshot = state.words;
  const result = submitWord(state.words, word, state.sides, dictionary);
  if (!result.ok) {
    const message = result.reason === "chain"
      ? `Start with "${requiredStartLetter(previousWordsSnapshot)}."`
      : REASON_MESSAGES[result.reason] || "That doesn't work there.";
    showMessage(message, "bad");
    return;
  }
  state.words = result.words;
  state.buffer = seedBuffer(state.words);
  state.solved = result.solved;
  showMessage(`${result.word} added.`, "good");
  persist();
  renderAll();
  if (result.solved) onSolved();
}

function onSolved() {
  confettiBurst();
  if (state.mode === "daily") {
    recordResult(GAME_ID, true);
  }
}

/* ---------- share + practice ---------- */

function buildShareText() {
  const summary = resultSummary(state.words, state.par);
  const squares = state.words
    .map((_, i) => (i < summary.par ? "\u{1F7E6}" : "\u{1F7E7}"))
    .join("");
  const label = state.mode === "daily" ? todayKey() : "practice";
  return `Edgeways ${label}\n${squares} ${summary.count}/${summary.par}`;
}

function switchToRandomPuzzle() {
  const puzzle = randomPuzzle();
  state = {
    sides: puzzle.sides,
    par: puzzle.par,
    mode: "random",
    words: [],
    buffer: [],
    solved: false,
  };
  showMessage("");
  els.practiceNote.hidden = false;
  buildBoard();
  renderAll();
}

/* ---------- boot ---------- */

async function boot() {
  els.current.textContent = "Loading...";
  const [bankRes, dictRes] = await Promise.all([
    fetch("../../data/edgeways.json"),
    fetch("./words.json"),
  ]);
  bank = await bankRes.json();
  const words = await dictRes.json();
  dictionary = new Set(words);

  state = initDailyState();
  els.practiceNote.hidden = state.mode !== "random";

  buildBoard();
  renderAll();

  document.addEventListener("keydown", (e) => {
    if (document.querySelector(".pp-modal-backdrop")) return;
    if (e.key === "Enter") {
      e.preventDefault();
      submitCurrent();
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      backspace();
      return;
    }
    if (/^[a-zA-Z]$/.test(e.key)) {
      tapLetter(e.key.toUpperCase());
    }
  });

  els.enter.addEventListener("click", submitCurrent);
  els.backspace.addEventListener("click", backspace);
  els.restart.addEventListener("click", restart);
  els.share.addEventListener("click", () => share(buildShareText()));
  els.practice.addEventListener("click", switchToRandomPuzzle);

  let resizeFrame = null;
  window.addEventListener("resize", () => {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      drawLines();
    });
  });

  initChrome({ id: GAME_ID, name: "Edgeways", helpHTML: HELP_HTML });
}

boot().catch((err) => {
  els.current.textContent = "Could not load the puzzle.";
  toast("Something went wrong loading Edgeways.");
  console.error(err);
});
