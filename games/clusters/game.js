import {
  initChrome,
  store,
  dayIndex,
  recordResult,
  share,
  toast,
  confettiBurst,
  diffTabs,
} from "../../assets/shared.js";
import * as core from "./core.js";

const GAME_ID = "clusters";
const EPOCH = "2026-08-10";
const BANK_URL = new URL("../../data/clusters.json", import.meta.url);
const DIFFICULTIES = ["easy", "medium", "hard"];
const LABELS = { easy: "Easy", medium: "Medium", hard: "Hard" };

const HELP_HTML =
  "<p>Sixteen tiles hide four groups of four. Pick four tiles that share a connection, then submit.</p>" +
  "<p>A correct guess locks in a colored row, ordered easiest (sand) to trickiest (plum).</p>" +
  "<p>You get four mistakes before the round ends and the remaining groups are revealed.</p>" +
  "<p>Watch for tiles that could plausibly belong to more than one group. That overlap is the trap, " +
  "and Hard puzzles lean into it hardest.</p>" +
  "<p>Easy, Medium, and Hard each carry their own puzzle for the day and their own streak.</p>";

const els = {};
let bank = null; // { easy: {puzzles}, medium: {puzzles}, hard: {puzzles} }
let activeDifficulty = "medium";

// Per-difficulty runtime data for today's puzzles.
const puzzles = {}; // difficulty -> puzzle
const states = {}; // difficulty -> state
const dailyIndexes = {}; // difficulty -> index into that difficulty's bank

let freePlay = null; // { difficulty, puzzle, state } or null
let bannerTimer = null;

function q(id) {
  return document.getElementById(id);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function cacheEls() {
  els.difftabs = q("cl-difftabs");
  els.status = q("cl-status");
  els.banner = q("cl-banner");
  els.solved = q("cl-solved");
  els.grid = q("cl-grid");
  els.deselect = q("cl-deselect");
  els.shuffle = q("cl-shuffle");
  els.submit = q("cl-submit");
  els.endgame = q("cl-endgame");
  els.endgameText = q("cl-endgame-text");
  els.shareBtn = q("cl-share");
  els.randomBtn = q("cl-random");
}

// ---------- current puzzle/state (daily per difficulty, or free play) ----------

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

function puzzleLabel() {
  const label = LABELS[activeDifficulty];
  return freePlay
    ? `Clusters ${label}, random puzzle`
    : `Clusters ${label} #${dailyIndexes[activeDifficulty] + 1}`;
}

// ---------- persistence ----------

function persist() {
  if (freePlay) return;
  const state = states[activeDifficulty];
  store(GAME_ID, activeDifficulty).saveDay({
    puzzleIndex: dailyIndexes[activeDifficulty],
    order: state.order,
    solvedGroups: state.solvedGroups,
    mistakes: state.mistakes,
    status: state.status,
  });
}

function persistStatsIfDone(difficulty) {
  if (freePlay) return;
  const state = states[difficulty];
  if (!core.isOver(state)) return;
  recordResult(GAME_ID, state.status === "won", difficulty);
}

// ---------- rendering ----------

function showBanner(msg) {
  if (!msg) return;
  els.banner.textContent = msg;
  els.banner.classList.add("cl-banner--visible");
  window.clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => {
    els.banner.classList.remove("cl-banner--visible");
  }, 1800);
}

function hideBanner() {
  window.clearTimeout(bannerTimer);
  els.banner.classList.remove("cl-banner--visible");
}

function bannerMessage(lastResult) {
  if (!lastResult) return "";
  if (lastResult.type === "oneAway") return "One away.";
  if (lastResult.type === "wrong") return "Not a group.";
  return "";
}

function tileWord(flatIndex) {
  return core.flattenPuzzle(currentPuzzle())[flatIndex].word;
}

function renderSolved() {
  const state = currentState();
  els.solved.innerHTML = state.solvedGroups
    .map((g) => {
      const words = g.words.join(", ");
      return (
        `<li class="cl-solved__row" data-tier="${esc(g.tier)}" data-revealed="${g.revealed ? "true" : "false"}">` +
        `<span class="cl-solved__name">${esc(g.name)}</span>` +
        `<span class="cl-solved__words">${esc(words)}</span>` +
        `</li>`
      );
    })
    .join("");
}

function renderStatus() {
  const state = currentState();
  const used = state.mistakes;
  const dots = Array.from({ length: core.MAX_MISTAKES }, (_, i) =>
    `<span class="cl-mistakes__dot" data-used="${i < used ? "true" : "false"}"></span>`
  ).join("");
  els.status.innerHTML = `<span class="cl-mistakes__label">Mistakes</span>${dots}`;
}

function renderGrid() {
  const state = currentState();
  els.grid.innerHTML = state.order
    .map((flatIndex) => {
      const word = tileWord(flatIndex);
      const selected = state.selected.includes(flatIndex);
      return (
        `<button type="button" class="pp-tile cl-tile" data-flat="${flatIndex}" ` +
        `data-selected="${selected ? "true" : "false"}" aria-pressed="${selected ? "true" : "false"}">` +
        `<span class="cl-tile__word">${esc(word)}</span></button>`
      );
    })
    .join("");

  els.grid.querySelectorAll(".cl-tile").forEach((btn) => {
    btn.addEventListener("click", onTileClick);
  });
  fitTileWords();
}

/*
  Long words (SCREWDRIVER, BACKGAMMON) outgrow a tile on narrow phones.
  Breaking them mid-word looks broken, so instead each word keeps its normal
  size when it fits and shrinks just enough when it does not. white-space:
  nowrap in style.css keeps the word on one line; the measurement has to be
  against the tile's content box, because an overflowing nowrap span grows
  to its own min-content width and never reports scrollWidth > clientWidth.
*/
function fitTileWords() {
  els.grid.querySelectorAll(".cl-tile").forEach((tile) => {
    const span = tile.querySelector(".cl-tile__word");
    if (!span) return;
    span.style.fontSize = "";
    const tileStyle = window.getComputedStyle(tile);
    const available =
      tile.clientWidth - parseFloat(tileStyle.paddingLeft) - parseFloat(tileStyle.paddingRight);
    if (available <= 0) return;
    // Text width does not scale perfectly linearly with font size (glyph
    // rounding), so converge in a few passes instead of trusting one ratio.
    // Target a pixel of slack so integer-rounded measurements stay inside
    // the tile too.
    let size = parseFloat(window.getComputedStyle(span).fontSize);
    for (let pass = 0; pass < 4; pass++) {
      const needed = span.getBoundingClientRect().width;
      if (needed <= available - 0.5 || size <= 7) break;
      size = Math.max(7, size * ((available - 1) / needed));
      span.style.fontSize = `${size.toFixed(2)}px`;
    }
  });
}

function renderControls() {
  const state = currentState();
  const over = core.isOver(state);
  els.submit.disabled = over || state.selected.length !== core.GROUP_SIZE;
  els.deselect.disabled = over || state.selected.length === 0;
  els.shuffle.disabled = over;
}

function renderEndgame() {
  const state = currentState();
  if (!core.isOver(state)) {
    els.endgame.hidden = true;
    return;
  }
  const solvedCount = state.solvedGroups.filter((g) => !g.revealed).length;
  els.endgameText.textContent =
    state.status === "won"
      ? state.mistakes === 0
        ? "Perfect solve."
        : `Solved with ${state.mistakes} mistake${state.mistakes === 1 ? "" : "s"}.`
      : `Out of guesses. You found ${solvedCount} of 4.`;
  els.endgame.hidden = false;
}

function renderAll() {
  renderSolved();
  renderGrid();
  renderStatus();
  renderControls();
  renderEndgame();
}

// ---------- gameplay actions ----------

function onTileClick(e) {
  const flatIndex = Number(e.currentTarget.dataset.flat);
  setCurrentState(core.toggleTile(currentState(), flatIndex));
  const btn = e.currentTarget;
  const selected = currentState().selected.includes(flatIndex);
  btn.dataset.selected = selected ? "true" : "false";
  btn.setAttribute("aria-pressed", selected ? "true" : "false");
  if (selected) {
    btn.classList.remove("pp-tile--pop");
    void btn.offsetWidth; // reflow so the animation replays on repeat selection
    btn.classList.add("pp-tile--pop");
  }
  renderControls();
}

function onGridKeydown(e) {
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
  const buttons = Array.from(els.grid.querySelectorAll(".cl-tile"));
  const current = buttons.indexOf(document.activeElement);
  if (current === -1) return;
  e.preventDefault();
  const cols = 4;
  let next = current;
  if (e.key === "ArrowRight") next = Math.min(buttons.length - 1, current + 1);
  if (e.key === "ArrowLeft") next = Math.max(0, current - 1);
  if (e.key === "ArrowDown") next = Math.min(buttons.length - 1, current + cols);
  if (e.key === "ArrowUp") next = Math.max(0, current - cols);
  buttons[next].focus();
}

function onSubmit() {
  const prevStatus = currentState().status;
  const next = core.submitGuess(currentPuzzle(), currentState());
  setCurrentState(next);
  showBanner(bannerMessage(next.lastResult));
  renderAll();
  persist();
  persistStatsIfDone(activeDifficulty);
  if (next.status === "won" && prevStatus === "playing") confettiBurst();
}

function onDeselect() {
  setCurrentState(core.deselectAll(currentState()));
  renderGrid();
  renderControls();
}

function onShuffle() {
  setCurrentState(core.shuffleBoard(currentState()));
  renderGrid();
  persist();
}

function onRandom() {
  const list = bank[activeDifficulty].puzzles;
  const todaysIndex = dailyIndexes[activeDifficulty];
  let idx = todaysIndex;
  if (list.length > 1) {
    while (idx === todaysIndex) idx = Math.floor(Math.random() * list.length);
  } else {
    idx = 0;
  }
  const puzzle = list[idx];
  freePlay = {
    difficulty: activeDifficulty,
    puzzle,
    state: core.createState(core.shuffle(core.initialOrder(puzzle))),
  };
  hideBanner();
  renderAll();
}

function exitFreePlay() {
  freePlay = null;
}

async function onShare() {
  await share(core.formatShare(puzzleLabel(), currentState()));
}

// ---------- difficulty tabs ----------

function switchDifficulty(difficulty) {
  if (freePlay) exitFreePlay();
  activeDifficulty = difficulty;
  hideBanner();
  renderAll();
}

// ---------- boot ----------

function restoreOrCreate(difficulty, section) {
  const list = section.puzzles;
  const idx = ((dayIndex(EPOCH) % list.length) + list.length) % list.length;
  dailyIndexes[difficulty] = idx;
  const puzzle = list[idx];
  puzzles[difficulty] = puzzle;

  // saved.puzzleIndex ties the payload to the puzzle it was played on, so a
  // bank or epoch change never restores another puzzle's groups here.
  const saved = store(GAME_ID, difficulty).loadDay();
  if (
    saved &&
    saved.puzzleIndex === idx &&
    Array.isArray(saved.order) &&
    Array.isArray(saved.solvedGroups)
  ) {
    states[difficulty] = {
      order: saved.order,
      selected: [],
      solvedGroups: saved.solvedGroups,
      mistakes: saved.mistakes || 0,
      status: saved.status || "playing",
      lastResult: null,
    };
  } else {
    states[difficulty] = core.createState(core.shuffle(core.initialOrder(puzzle)));
  }
}

async function init() {
  cacheEls();
  initChrome({ id: GAME_ID, name: "Clusters", hubHref: "../../index.html", helpHTML: HELP_HTML });

  els.submit.addEventListener("click", onSubmit);
  els.deselect.addEventListener("click", onDeselect);
  els.shuffle.addEventListener("click", onShuffle);
  els.shareBtn.addEventListener("click", onShare);
  els.randomBtn.addEventListener("click", onRandom);
  els.grid.addEventListener("keydown", onGridKeydown);

  // Refit whenever the grid's box actually changes: covers window resizes,
  // orientation flips, and the scrollbar appearing after first paint (which
  // narrows the layout without any window resize event).
  let fitRaf = 0;
  const queueFit = () => {
    window.cancelAnimationFrame(fitRaf);
    fitRaf = window.requestAnimationFrame(fitTileWords);
  };
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(queueFit).observe(els.grid);
  } else {
    window.addEventListener("resize", queueFit);
  }

  try {
    const res = await fetch(BANK_URL);
    bank = await res.json();

    for (const difficulty of DIFFICULTIES) {
      restoreOrCreate(difficulty, bank[difficulty]);
    }

    activeDifficulty = diffTabs(els.difftabs, GAME_ID, switchDifficulty, "medium");

    for (const difficulty of DIFFICULTIES) {
      persistStatsIfDone(difficulty);
    }

    renderAll();
  } catch (err) {
    toast("Could not load today's puzzle.");
  }
}

init();
