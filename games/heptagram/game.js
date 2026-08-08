import {
  todayKey,
  pickDaily,
  store,
  diffTabs,
  recordResult,
  share,
  confettiBurst,
  initChrome,
} from "../../assets/shared.js";
import {
  WIN_RANK,
  createState,
  submitGuess,
  sortedFound,
  isComplete,
  finish,
  didWin,
  totalScore,
  rankForScore,
  nextRank,
  isPangram,
  shareText,
} from "./core.js";

const GAME_ID = "heptagram";
const EPOCH = "2026-08-10";
const BANK_URL = "../../data/heptagram.json";
const DIFFICULTIES = ["easy", "medium", "hard"];
const LABELS = { easy: "Easy", medium: "Medium", hard: "Hard" };
const DEFAULT_DIFFICULTY = "medium";

const HELP_HTML =
  "<p>Seven letters sit on the wheel, and every word must include the one " +
  "with the colored ring.</p>" +
  "<p>Words need four or more letters, only the seven shown letters are in " +
  "play, and letters can repeat.</p>" +
  "<p>Four-letter words score one point, longer words score their length, " +
  "and a word using all seven letters is a pangram worth a seven point " +
  "bonus.</p>" +
  `<p>Reach ${WIN_RANK} rank to close out the day, or finish anytime to lock ` +
  "in your score.</p>" +
  "<p>Easy, Medium, and Hard each carry their own puzzle, streak, and stats " +
  "for the day.</p>";

const els = {};

let bank = null; // { easy: { puzzles }, medium: { puzzles }, hard: { puzzles } }
let dayStores = null; // difficulty -> store(GAME_ID, difficulty)
let activeDifficulty = DEFAULT_DIFFICULTY;

// Per-difficulty daily puzzle + progress, kept alive across tab switches.
const sessions = {}; // difficulty -> { puzzle, state }

let freePlay = null; // { puzzle, state } or null; never counts toward streaks
let guess = "";
let wheelOrder = [];

function $(id) {
  return document.getElementById(id);
}

function cacheEls() {
  [
    "diff-tabs",
    "hg-status",
    "hg-board",
    "hg-rank",
    "hg-score",
    "hg-progress-fill",
    "hg-message",
    "hg-guess",
    "hg-wheel",
    "hg-delete",
    "hg-shuffle",
    "hg-enter",
    "hg-finish",
    "hg-found-list",
    "hg-summary",
    "hg-summary-rank",
    "hg-summary-line",
    "hg-share",
    "hg-random",
  ].forEach((id) => {
    els[id] = $(id);
  });
}

async function loadBank() {
  const res = await fetch(BANK_URL);
  if (!res.ok) throw new Error(`failed to load puzzle bank: ${res.status}`);
  return res.json();
}

function shuffledOuterOrder(letters) {
  const arr = letters.split("");
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ---------- current-view helpers ---------- */

function currentPuzzle() {
  return freePlay ? freePlay.puzzle : sessions[activeDifficulty].puzzle;
}

function currentState() {
  return freePlay ? freePlay.state : sessions[activeDifficulty].state;
}

function setCurrentState(next) {
  if (freePlay) freePlay.state = next;
  else sessions[activeDifficulty].state = next;
}

function isDailyView() {
  return !freePlay;
}

function updateFinishLabel() {
  els["hg-finish"].textContent = isDailyView() ? "Finish for today" : "Finish this puzzle";
}

function loadPuzzle(puzzle) {
  guess = "";
  wheelOrder = shuffledOuterOrder(puzzle.letters);
}

function persistCurrent() {
  if (!isDailyView()) return;
  const { puzzle, state } = sessions[activeDifficulty];
  // The letters tag ties the payload to today's puzzle so a stale save is
  // never restored against a different wheel.
  dayStores[activeDifficulty].saveDay({ ...state, letters: puzzle.letters });
}

/* ---------- rendering ---------- */

function renderAll() {
  const finishedNow = currentState().finished;

  els["hg-board"].hidden = finishedNow;
  els["hg-summary"].hidden = !finishedNow;

  if (finishedNow) {
    renderSummary();
    return;
  }

  renderScore();
  renderGuess();
  renderWheel();
  renderFound();
}

function renderScore() {
  const puzzle = currentPuzzle();
  const state = currentState();
  const score = totalScore(state.found, puzzle.letters);
  const rank = rankForScore(score, puzzle.maxScore);
  const next = nextRank(score, puzzle.maxScore);

  els["hg-rank"].textContent = rank.name;
  els["hg-score"].textContent = `${score} point${score === 1 ? "" : "s"}`;
  els["hg-status"].textContent = `${state.found.length}/${puzzle.words.length} words`;

  const floor = rank.pct * puzzle.maxScore;
  const ceiling = next ? next.pct * puzzle.maxScore : puzzle.maxScore;
  const span = Math.max(ceiling - floor, 1);
  const pct = Math.min(100, Math.round(((score - floor) / span) * 100));
  els["hg-progress-fill"].style.width = `${Math.max(0, pct)}%`;
}

function renderGuess() {
  const text = guess.toUpperCase();
  els["hg-guess"].textContent = text;
  const caret = document.createElement("span");
  caret.className = "hg-guess__caret";
  els["hg-guess"].appendChild(caret);
}

function renderWheel() {
  const wheel = els["hg-wheel"];
  wheel.innerHTML = "";
  const letters = wheelOrder;
  const center = currentPuzzle().center;
  const count = letters.length;
  const radiusPct = 37;

  const svgNS = "http://www.w3.org/2000/svg";
  const star = document.createElementNS(svgNS, "svg");
  star.setAttribute("viewBox", "0 0 100 100");
  star.setAttribute("class", "hg-wheel__star");
  star.setAttribute("aria-hidden", "true");

  const points = letters.map((_, i) => {
    const angle = (i / count) * 2 * Math.PI - Math.PI / 2;
    const x = 50 + radiusPct * Math.cos(angle);
    const y = 50 + radiusPct * Math.sin(angle);
    return { x, y };
  });

  const step = 2;
  const order = [];
  for (let i = 0; i < count; i++) order.push((i * step) % count);
  const polygon = document.createElementNS(svgNS, "polygon");
  polygon.setAttribute("points", order.map((i) => `${points[i].x},${points[i].y}`).join(" "));
  star.appendChild(polygon);
  wheel.appendChild(star);

  letters.forEach((letter, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hg-wheel__btn";
    btn.textContent = letter;
    btn.style.left = `${points[i].x}%`;
    btn.style.top = `${points[i].y}%`;
    const isCenter = letter === center;
    if (isCenter) {
      btn.dataset.center = "true";
      btn.setAttribute("aria-label", `${letter}, required letter`);
    } else {
      btn.setAttribute("aria-label", letter);
    }
    btn.addEventListener("click", () => appendLetter(letter));
    wheel.appendChild(btn);
  });
}

function renderFound() {
  const list = els["hg-found-list"];
  const words = sortedFound(currentState());
  if (words.length === 0) {
    list.innerHTML = '<li class="hg-found__empty">Nothing yet. Start typing.</li>';
    return;
  }
  const letters = currentPuzzle().letters;
  list.innerHTML = words
    .map((w) => {
      const pangram = isPangram(w, letters);
      return `<li data-pangram="${pangram}">${w}</li>`;
    })
    .join("");
}

function renderSummary() {
  const puzzle = currentPuzzle();
  const state = currentState();
  const score = totalScore(state.found, puzzle.letters);
  const rank = rankForScore(score, puzzle.maxScore);
  els["hg-summary-rank"].textContent = rank.name;
  els["hg-summary-line"].textContent =
    `${score} point${score === 1 ? "" : "s"} - ${state.found.length} of ${puzzle.words.length} words found`;
  els["hg-random"].textContent = isDailyView() ? "Play a random puzzle" : "Another random puzzle";
}

/* ---------- messaging ---------- */

function setMessage(text, kind) {
  const el = els["hg-message"];
  el.textContent = text || " ";
  if (kind) {
    el.dataset.kind = kind;
  } else {
    delete el.dataset.kind;
  }
}

function shakeGuess() {
  const el = els["hg-guess"];
  el.classList.remove("hg-guess--shake");
  void el.offsetWidth;
  el.classList.add("hg-guess--shake");
}

function popGuess() {
  const el = els["hg-guess"];
  el.classList.remove("hg-guess--pop");
  void el.offsetWidth;
  el.classList.add("hg-guess--pop");
}

/* ---------- input ---------- */

function appendLetter(letter) {
  if (currentState().finished) return;
  guess += letter.toLowerCase();
  renderGuess();
}

function deleteLetter() {
  if (currentState().finished) return;
  guess = guess.slice(0, -1);
  renderGuess();
}

function clearGuess() {
  guess = "";
  renderGuess();
}

const REASON_TEXT = {
  "too-short": "Need at least four letters.",
  "bad-letters": "Only the seven puzzle letters are in play.",
  "missing-center": (puzzle) => `Every word needs the letter ${puzzle.center}.`,
  "already-found": "Already found that one.",
  "not-in-list": "Not in today's word list.",
};

function submitCurrentGuess() {
  if (currentState().finished) return;
  const raw = guess;
  if (!raw) return;

  const puzzle = currentPuzzle();
  const { state, result } = submitGuess(puzzle, currentState(), raw);

  if (!result.ok) {
    const text = REASON_TEXT[result.reason];
    setMessage(typeof text === "function" ? text(puzzle) : text, "bad");
    shakeGuess();
    clearGuess();
    return;
  }

  setCurrentState(state);
  clearGuess();
  popGuess();

  if (result.pangram) {
    setMessage(`Pangram! +${result.score} points`, "pangram");
  } else {
    setMessage(`Nice - +${result.score} point${result.score === 1 ? "" : "s"}`, "good");
  }

  persistCurrent();
  renderScore();
  renderFound();

  if (isComplete(puzzle, currentState())) {
    setMessage("Every word found. Amazing.", "pangram");
  }
}

function finishCurrent() {
  const state = currentState();
  if (state.finished) return;
  const puzzle = currentPuzzle();
  const won = didWin(puzzle, state);
  setCurrentState(finish(state));

  if (isDailyView()) {
    recordResult(GAME_ID, won, activeDifficulty);
    persistCurrent();
  }
  if (won) confettiBurst();
  renderAll();
}

function startRandomPuzzle() {
  const list = bank && bank[activeDifficulty] ? bank[activeDifficulty].puzzles : null;
  if (!list || list.length === 0) return;
  const currentLetters = currentPuzzle() ? currentPuzzle().letters : null;
  let idx = Math.floor(Math.random() * list.length);
  let attempts = 0;
  while (list.length > 1 && list[idx].letters === currentLetters && attempts < 20) {
    idx = Math.floor(Math.random() * list.length);
    attempts++;
  }
  freePlay = { puzzle: list[idx], state: createState() };
  loadPuzzle(freePlay.puzzle);
  updateFinishLabel();
  renderAll();
  setMessage("Random puzzle. Doesn't count toward your streak.", null);
}

function handleShare() {
  const puzzle = currentPuzzle();
  const state = currentState();
  const diffLabel = LABELS[activeDifficulty];
  const dateLabel = isDailyView()
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date())
    : "Free play";
  share(shareText(puzzle, state, dateLabel, diffLabel));
}

/* ---------- tab switching ---------- */

function switchDifficulty(difficulty) {
  freePlay = null;
  activeDifficulty = difficulty;
  const session = sessions[difficulty];
  loadPuzzle(session.puzzle);
  updateFinishLabel();
  renderAll();
  setMessage(session.state.found.length === 0 && !session.state.finished ? "Find words using the required letter." : null, null);
}

/* ---------- wiring ---------- */

function wireEvents() {
  els["hg-delete"].addEventListener("click", deleteLetter);
  els["hg-enter"].addEventListener("click", submitCurrentGuess);
  els["hg-shuffle"].addEventListener("click", () => {
    wheelOrder = shuffledOuterOrder(wheelOrder.join(""));
    renderWheel();
  });
  els["hg-finish"].addEventListener("click", finishCurrent);
  els["hg-share"].addEventListener("click", handleShare);
  els["hg-random"].addEventListener("click", startRandomPuzzle);

  document.addEventListener("keydown", (e) => {
    if (currentState().finished) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector(".pp-modal-backdrop")) return;
    const key = e.key;
    if (key === "Enter") {
      e.preventDefault();
      submitCurrentGuess();
      return;
    }
    if (key === "Backspace") {
      e.preventDefault();
      deleteLetter();
      return;
    }
    if (key === "Escape") {
      clearGuess();
      return;
    }
    if (/^[a-zA-Z]$/.test(key)) {
      const upper = key.toUpperCase();
      if (currentPuzzle().letters.includes(upper)) {
        appendLetter(upper);
      }
    }
  });
}

async function init() {
  cacheEls();
  wireEvents();

  initChrome({ id: GAME_ID, name: "Heptagram", helpHTML: HELP_HTML });

  dayStores = Object.fromEntries(DIFFICULTIES.map((d) => [d, store(GAME_ID, d)]));

  try {
    bank = await loadBank();
  } catch {
    setMessage("Could not load today's puzzle. Try reloading.", "bad");
    return;
  }

  for (const diff of DIFFICULTIES) {
    const puzzle = pickDaily(bank[diff], EPOCH);
    const saved = dayStores[diff].loadDay(todayKey());
    let state = createState();
    if (saved && saved.letters === puzzle.letters) {
      const { letters, ...rest } = saved;
      state = rest;
    }
    sessions[diff] = { puzzle, state };
  }

  activeDifficulty = diffTabs(els["diff-tabs"], GAME_ID, switchDifficulty, DEFAULT_DIFFICULTY);
  loadPuzzle(sessions[activeDifficulty].puzzle);
  updateFinishLabel();
  renderAll();

  const state = sessions[activeDifficulty].state;
  if (state.found.length === 0 && !state.finished) {
    setMessage("Find words using the required letter.", null);
  }
}

init();
