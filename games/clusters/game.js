import {
  initChrome,
  store,
  dayIndex,
  recordResult,
  share,
  toast,
  confettiBurst,
} from "../../assets/shared.js";
import * as core from "./core.js";

const GAME_ID = "clusters";
const EPOCH = "2026-08-10";
const BANK_URL = new URL("../../data/clusters.json", import.meta.url);

const HELP_HTML =
  "<p>Sixteen tiles hide four groups of four. Pick four tiles that share a connection, then submit.</p>" +
  "<p>A correct guess locks in a colored row, ordered easiest (sand) to trickiest (plum).</p>" +
  "<p>You get four mistakes before the round ends and the remaining groups are revealed.</p>" +
  "<p>Watch for tiles that could plausibly belong to more than one group. That overlap is the trap.</p>";

const els = {};
let puzzle = null;
let state = null;
let mode = "daily"; // "daily" | "random"
let bankRef = null;
let dailyIndex = 0;
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
  els.banner = q("cl-banner");
  els.solved = q("cl-solved");
  els.grid = q("cl-grid");
  els.mistakes = q("cl-mistakes");
  els.deselect = q("cl-deselect");
  els.shuffle = q("cl-shuffle");
  els.submit = q("cl-submit");
  els.endgame = q("cl-endgame");
  els.endgameText = q("cl-endgame-text");
  els.shareBtn = q("cl-share");
  els.randomBtn = q("cl-random");
}

function puzzleLabel() {
  return mode === "daily" ? `Clusters #${dailyIndex + 1}` : "Clusters, random puzzle";
}

function persist() {
  if (mode !== "daily") return;
  store(GAME_ID).saveDay({
    order: state.order,
    solvedGroups: state.solvedGroups,
    mistakes: state.mistakes,
    status: state.status,
  });
}

function persistStatsIfDone() {
  if (mode !== "daily") return;
  if (!core.isOver(state)) return;
  recordResult(GAME_ID, state.status === "won");
}

function showBanner(msg) {
  if (!msg) return;
  els.banner.textContent = msg;
  els.banner.classList.add("cl-banner--visible");
  window.clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => {
    els.banner.classList.remove("cl-banner--visible");
  }, 1800);
}

function bannerMessage(lastResult) {
  if (!lastResult) return "";
  if (lastResult.type === "oneAway") return "One away.";
  if (lastResult.type === "wrong") return "Not a group.";
  return "";
}

function tileWord(flatIndex) {
  return core.flattenPuzzle(puzzle)[flatIndex].word;
}

function renderSolved() {
  els.solved.innerHTML = state.solvedGroups
    .map((g) => {
      const words = g.words.join(", ");
      return (
        `<li class="cl-solved__row" data-tier="${g.tier}" data-revealed="${g.revealed ? "true" : "false"}">` +
        `<span class="cl-solved__name">${esc(g.name)}</span>` +
        `<span class="cl-solved__words">${esc(words)}</span>` +
        `</li>`
      );
    })
    .join("");
}

function renderMistakes() {
  const used = state.mistakes;
  const dots = Array.from({ length: core.MAX_MISTAKES }, (_, i) =>
    `<span class="cl-mistakes__dot" data-used="${i < used ? "true" : "false"}"></span>`
  ).join("");
  els.mistakes.innerHTML = `<span class="cl-mistakes__label">Mistakes</span>${dots}`;
}

function renderGrid() {
  els.grid.innerHTML = state.order
    .map((flatIndex) => {
      const word = tileWord(flatIndex);
      const selected = state.selected.includes(flatIndex);
      return (
        `<button type="button" class="pp-tile cl-tile" data-flat="${flatIndex}" ` +
        `data-selected="${selected ? "true" : "false"}" aria-pressed="${selected ? "true" : "false"}">` +
        `${esc(word)}</button>`
      );
    })
    .join("");

  els.grid.querySelectorAll(".cl-tile").forEach((btn) => {
    btn.addEventListener("click", onTileClick);
  });
}

function renderControls() {
  const over = core.isOver(state);
  els.submit.disabled = over || state.selected.length !== core.GROUP_SIZE;
  els.deselect.disabled = over || state.selected.length === 0;
  els.shuffle.disabled = over;
}

function renderEndgame() {
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
  renderMistakes();
  renderControls();
  renderEndgame();
}

function onTileClick(e) {
  const flatIndex = Number(e.currentTarget.dataset.flat);
  state = core.toggleTile(state, flatIndex);
  const btn = e.currentTarget;
  const selected = state.selected.includes(flatIndex);
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
  const prevStatus = state.status;
  state = core.submitGuess(puzzle, state);
  showBanner(bannerMessage(state.lastResult));
  renderAll();
  persist();
  persistStatsIfDone();
  if (state.status === "won" && prevStatus === "playing") confettiBurst();
}

function onDeselect() {
  state = core.deselectAll(state);
  renderGrid();
  renderControls();
}

function onShuffle() {
  state = core.shuffleBoard(state);
  renderGrid();
  persist();
}

function onRandom() {
  const puzzles = bankRef.puzzles;
  let idx = dailyIndex;
  if (puzzles.length > 1) {
    while (idx === dailyIndex) idx = Math.floor(Math.random() * puzzles.length);
  } else {
    idx = 0;
  }
  puzzle = puzzles[idx];
  mode = "random";
  state = core.createState(core.shuffle(core.initialOrder(puzzle)));
  els.banner.classList.remove("cl-banner--visible");
  renderAll();
}

async function onShare() {
  await share(core.formatShare(puzzleLabel(), state));
}

function restoreOrCreate(bank) {
  dailyIndex = ((dayIndex(EPOCH) % bank.puzzles.length) + bank.puzzles.length) % bank.puzzles.length;
  puzzle = bank.puzzles[dailyIndex];

  const saved = store(GAME_ID).loadDay();
  if (saved && Array.isArray(saved.order) && Array.isArray(saved.solvedGroups)) {
    state = {
      order: saved.order,
      selected: [],
      solvedGroups: saved.solvedGroups,
      mistakes: saved.mistakes || 0,
      status: saved.status || "playing",
      lastResult: null,
    };
  } else {
    state = core.createState(core.shuffle(core.initialOrder(puzzle)));
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

  try {
    const res = await fetch(BANK_URL);
    const bank = await res.json();
    bankRef = bank;
    restoreOrCreate(bank);
    renderAll();
    persistStatsIfDone();
  } catch (err) {
    toast("Could not load today's puzzle.");
  }
}

init();
