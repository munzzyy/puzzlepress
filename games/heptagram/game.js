import {
  todayKey,
  pickDaily,
  store,
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

const HELP_HTML =
  "<p>Seven letters sit on the wheel, and every word must include the one " +
  "with the colored ring.</p>" +
  "<p>Words need four or more letters, only the seven shown letters are in " +
  "play, and letters can repeat.</p>" +
  "<p>Four-letter words score one point, longer words score their length, " +
  "and a word using all seven letters is a pangram worth a seven point " +
  "bonus.</p>" +
  `<p>Reach ${WIN_RANK} rank to close out the day, or finish anytime to lock ` +
  "in your score.</p>";

const els = {};

/** Mutable session for whichever puzzle is currently on screen. */
const session = {
  puzzle: null,
  state: createState(),
  isDaily: true,
  guess: "",
  wheelOrder: [],
};

let bank = null;

function $(id) {
  return document.getElementById(id);
}

function cacheEls() {
  [
    "hg-board",
    "hg-rank",
    "hg-score",
    "hg-found-count",
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

function startSession(puzzle, isDaily, existingState) {
  session.puzzle = puzzle;
  session.state = existingState || createState();
  session.isDaily = isDaily;
  session.guess = "";
  session.wheelOrder = shuffledOuterOrder(puzzle.letters);
  els["hg-finish"].textContent = isDaily ? "Finish for today" : "Finish this puzzle";
  renderAll();
}

function persistIfDaily() {
  if (session.isDaily) {
    // The letters tag ties the payload to today's puzzle so a stale save is
    // never restored against a different wheel.
    store(GAME_ID).saveDay({ ...session.state, letters: session.puzzle.letters });
  }
}

/* ---------- rendering ---------- */

function renderAll() {
  const finishedNow = session.state.finished;

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
  const { puzzle, state } = session;
  const score = totalScore(state.found, puzzle.letters);
  const rank = rankForScore(score, puzzle.maxScore);
  const next = nextRank(score, puzzle.maxScore);

  els["hg-rank"].textContent = rank.name;
  els["hg-score"].textContent = `${score} point${score === 1 ? "" : "s"}`;
  els["hg-found-count"].textContent = `${state.found.length} word${
    state.found.length === 1 ? "" : "s"
  } found`;

  const floor = rank.pct * puzzle.maxScore;
  const ceiling = next ? next.pct * puzzle.maxScore : puzzle.maxScore;
  const span = Math.max(ceiling - floor, 1);
  const pct = Math.min(100, Math.round(((score - floor) / span) * 100));
  els["hg-progress-fill"].style.width = `${Math.max(0, pct)}%`;
}

function renderGuess() {
  const text = session.guess.toUpperCase();
  els["hg-guess"].textContent = text;
  const caret = document.createElement("span");
  caret.className = "hg-guess__caret";
  els["hg-guess"].appendChild(caret);
}

function renderWheel() {
  const wheel = els["hg-wheel"];
  wheel.innerHTML = "";
  const letters = session.wheelOrder;
  const center = session.puzzle.center;
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
  const words = sortedFound(session.state);
  if (words.length === 0) {
    list.innerHTML = '<li class="hg-found__empty">Nothing yet. Start typing.</li>';
    return;
  }
  list.innerHTML = words
    .map((w) => {
      const pangram = isPangram(w, session.puzzle.letters);
      return `<li data-pangram="${pangram}">${w}</li>`;
    })
    .join("");
}

function renderSummary() {
  const { puzzle, state, isDaily } = session;
  const score = totalScore(state.found, puzzle.letters);
  const rank = rankForScore(score, puzzle.maxScore);
  els["hg-summary-rank"].textContent = rank.name;
  els["hg-summary-line"].textContent =
    `${score} point${score === 1 ? "" : "s"} - ${state.found.length} of ${puzzle.words.length} words found`;
  els["hg-random"].textContent = isDaily ? "Play a random puzzle" : "Another random puzzle";
}

/* ---------- messaging ---------- */

function setMessage(text, kind) {
  const el = els["hg-message"];
  el.textContent = text || " ";
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
  if (session.state.finished) return;
  session.guess += letter.toLowerCase();
  renderGuess();
}

function deleteLetter() {
  if (session.state.finished) return;
  session.guess = session.guess.slice(0, -1);
  renderGuess();
}

function clearGuess() {
  session.guess = "";
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
  if (session.state.finished) return;
  const raw = session.guess;
  if (!raw) return;

  const { state, result } = submitGuess(session.puzzle, session.state, raw);

  if (!result.ok) {
    const text = REASON_TEXT[result.reason];
    setMessage(typeof text === "function" ? text(session.puzzle) : text, "bad");
    shakeGuess();
    clearGuess();
    return;
  }

  session.state = state;
  clearGuess();
  popGuess();

  if (result.pangram) {
    setMessage(`Pangram! +${result.score} points`, "pangram");
  } else {
    setMessage(`Nice - +${result.score} point${result.score === 1 ? "" : "s"}`, "good");
  }

  persistIfDaily();
  renderScore();
  renderFound();

  if (isComplete(session.puzzle, session.state)) {
    setMessage("Every word found. Amazing.", "pangram");
  }
}

function finishToday() {
  if (session.state.finished) return;
  const won = didWin(session.puzzle, session.state);
  session.state = finish(session.state);

  if (session.isDaily) {
    recordResult(GAME_ID, won);
    persistIfDaily();
  }
  if (won) confettiBurst();
  renderAll();
}

function startRandomPuzzle() {
  if (!bank || !bank.puzzles || bank.puzzles.length === 0) return;
  const currentLetters = session.puzzle ? session.puzzle.letters : null;
  let idx = Math.floor(Math.random() * bank.puzzles.length);
  let attempts = 0;
  while (bank.puzzles.length > 1 && bank.puzzles[idx].letters === currentLetters && attempts < 20) {
    idx = Math.floor(Math.random() * bank.puzzles.length);
    attempts++;
  }
  startSession(bank.puzzles[idx], false, null);
  setMessage("Random puzzle. Doesn't count toward your streak.", null);
}

function handleShare() {
  const { puzzle, state, isDaily } = session;
  const dateLabel = isDaily
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date())
    : "Free play";
  share(shareText(puzzle, state, dateLabel));
}

/* ---------- wiring ---------- */

function wireEvents() {
  els["hg-delete"].addEventListener("click", deleteLetter);
  els["hg-enter"].addEventListener("click", submitCurrentGuess);
  els["hg-shuffle"].addEventListener("click", () => {
    session.wheelOrder = shuffledOuterOrder(session.wheelOrder.join(""));
    renderWheel();
  });
  els["hg-finish"].addEventListener("click", finishToday);
  els["hg-share"].addEventListener("click", handleShare);
  els["hg-random"].addEventListener("click", startRandomPuzzle);

  document.addEventListener("keydown", (e) => {
    if (session.state.finished) return;
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
      if (session.puzzle.letters.includes(upper)) {
        appendLetter(upper);
      }
    }
  });
}

async function init() {
  cacheEls();
  wireEvents();

  initChrome({ id: GAME_ID, name: "Heptagram", helpHTML: HELP_HTML });

  try {
    bank = await loadBank();
  } catch {
    setMessage("Could not load today's puzzle. Try reloading.", "bad");
    return;
  }

  const puzzle = pickDaily(bank, EPOCH);
  const saved = store(GAME_ID).loadDay(todayKey());
  let restored = null;
  if (saved && saved.letters === puzzle.letters) {
    const { letters, ...rest } = saved;
    restored = rest;
  }
  startSession(puzzle, true, restored);
  if (!restored) {
    setMessage("Find words using the required letter.", null);
  }
}

init();
