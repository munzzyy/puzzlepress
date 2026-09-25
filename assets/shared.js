/*
  Puzzle Press shared runtime. Every game imports from here instead of
  reimplementing storage, modals, sharing, or the top bar.
  No DOM work happens at import time except inside initChrome, which a page
  calls explicitly once its own markup is ready.
*/

const DAY_MS = 86400000;
const THEME_KEY = "pp.theme";

function safeParse(raw, fallback) {
  if (raw == null) return fallback;
  try {
    const value = JSON.parse(raw);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

function readStorage(key) {
  try {
    return globalThis.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    globalThis.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeStorage(key) {
  try {
    globalThis.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function storageLength() {
  try {
    return globalThis.localStorage.length;
  } catch {
    return 0;
  }
}

function storageKeyAt(i) {
  try {
    return globalThis.localStorage.key(i);
  } catch {
    return null;
  }
}

function localMidnightUTC(d) {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

/** The local-calendar Date for a "YYYY-MM-DD" key, at local midnight. */
export function localDateFromKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * Local-calendar-date index: whole days between `epoch` ("YYYY-MM-DD") and
 * now, counted in the visitor's local calendar. Deliberately the same
 * calendar as todayKey, so the daily puzzle and the day-keyed storage roll
 * over together at local midnight. Mapping the local Y/M/D through Date.UTC
 * keeps the difference an exact multiple of DAY_MS across DST changes.
 * `now` defaults to the real current time; tests may pass a fixed Date.
 */
export function dayIndex(epoch, now = new Date()) {
  const [y, m, d] = epoch.split("-").map(Number);
  return Math.floor((localMidnightUTC(now) - Date.UTC(y, m - 1, d)) / DAY_MS);
}

/** "YYYY-MM-DD" in the visitor's local calendar. */
export function todayKey(now = new Date()) {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/**
 * Deterministic daily pick. Accepts a bank shaped { puzzles: [...] } (per
 * contract) or a plain array. Stable forever: same epoch + same date always
 * resolves to the same index, wrapping once the bank outgrows the run.
 */
export function pickDaily(bank, epoch, now = new Date()) {
  const list = Array.isArray(bank) ? bank : bank.puzzles;
  if (!list || list.length === 0) {
    throw new Error("pickDaily: bank has no puzzles");
  }
  const idx = dayIndex(epoch, now);
  const wrapped = ((idx % list.length) + list.length) % list.length;
  return list[wrapped];
}

/** Local-calendar dateKey for the day `idx` days after `epoch`. Inverse of dayIndex. */
export function dateKeyForIndex(epoch, idx) {
  const [y, m, d] = epoch.split("-").map(Number);
  return todayKey(new Date(y, m - 1, d + idx));
}

/**
 * Validates a requested archive date (a "YYYY-MM-DD" string, normally read
 * from a page's `?date=` query param) against a game's epoch and the real
 * current time: it has to be a real calendar date, on or after the epoch,
 * and not after today. Anything else quietly falls back to today, the same
 * as opening the game with no date at all, so a bad or stale archive link
 * can never do worse than that.
 *
 * Returns the `now` to hand to pickDaily/dayIndex, the storage key to load
 * and save that day's progress under, its 1-based day number, and whether
 * this is an archived day rather than the live daily.
 */
export function resolveArchiveDay(epoch, requestedDateKey, now = new Date()) {
  const todayIdx = dayIndex(epoch, now);

  if (requestedDateKey && /^\d{4}-\d{2}-\d{2}$/.test(requestedDateKey)) {
    const candidate = localDateFromKey(requestedDateKey);
    if (todayKey(candidate) === requestedDateKey) {
      const idx = dayIndex(epoch, candidate);
      if (idx >= 0 && idx <= todayIdx) {
        return { now: candidate, dateKey: requestedDateKey, dayNumber: idx + 1, isArchive: idx !== todayIdx };
      }
    }
  }

  return { now, dateKey: todayKey(now), dayNumber: todayIdx + 1, isArchive: false };
}

/** Human label for a dateKey, e.g. "Aug 10, 2026". */
export function formatDateLabel(dateKey) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
    localDateFromKey(dateKey)
  );
}

const DEFAULT_META = { played: 0, wins: 0, streak: 0, maxStreak: 0, last: null, lastWon: null };
const DIFFICULTIES = ["easy", "medium", "hard"];
const DIFF_LABELS = { easy: "Easy", medium: "Medium", hard: "Hard" };

/**
 * Moves a game's pre-v2 flat keys (pp.<id>.day.<date>, pp.<id>.meta) under
 * the "medium" difficulty namespace, once. Runs lazily the first time
 * `store()` is called for a gameId; a `pp.<id>.migrated` flag makes every
 * later call a cheap no-op instead of re-scanning localStorage.
 *
 * Sudoku is exempted: its pre-v2 save shape is a single day-key holding all
 * three difficulties plus one meta shared across them, not the flat
 * single-difficulty shape this function expects. The sudoku game owns
 * translating that bespoke shape onto the new per-difficulty keys itself.
 */
function migrateLegacy(gameId) {
  if (gameId === "sudoku") return;

  const flagKey = `pp.${gameId}.migrated`;
  if (readStorage(flagKey) === "1") return;

  const legacyMetaKey = `pp.${gameId}.meta`;
  const legacyMeta = readStorage(legacyMetaKey);
  if (legacyMeta != null) {
    const mediumMetaKey = `pp.${gameId}.medium.meta`;
    if (readStorage(mediumMetaKey) == null) {
      writeStorage(mediumMetaKey, legacyMeta);
    }
    removeStorage(legacyMetaKey);
  }

  const dayPrefix = `pp.${gameId}.day.`;
  const newDayPrefix = `pp.${gameId}.medium.day.`;
  const legacyDayKeys = [];
  for (let i = 0; i < storageLength(); i++) {
    const key = storageKeyAt(i);
    if (key && key.startsWith(dayPrefix)) legacyDayKeys.push(key);
  }
  for (const key of legacyDayKeys) {
    const dateKey = key.slice(dayPrefix.length);
    const newKey = newDayPrefix + dateKey;
    if (readStorage(newKey) == null) {
      writeStorage(newKey, readStorage(key));
    }
    removeStorage(key);
  }

  writeStorage(flagKey, "1");
}

function diffKey(gameId) {
  return `pp.${gameId}.diff`;
}

/** The player's last-used difficulty for a game, persisted by diffTabs. */
export function lastDiff(gameId, defaultDiff = "medium") {
  const stored = readStorage(diffKey(gameId));
  return DIFFICULTIES.includes(stored) ? stored : defaultDiff;
}

/** Day-keyed progress + meta (stats), namespaced pp.<gameId>.<diff>.* in localStorage. */
export function store(gameId, diff = "medium") {
  migrateLegacy(gameId);

  const dayKeyFor = (key) => `pp.${gameId}.${diff}.day.${key}`;
  const metaKey = `pp.${gameId}.${diff}.meta`;

  return {
    loadDay(key = todayKey()) {
      return safeParse(readStorage(dayKeyFor(key)), null);
    },
    saveDay(state, key = todayKey()) {
      writeStorage(dayKeyFor(key), JSON.stringify(state));
    },
    loadMeta() {
      return { ...DEFAULT_META, ...safeParse(readStorage(metaKey), {}) };
    },
    saveMeta(meta) {
      writeStorage(metaKey, JSON.stringify(meta));
    },
  };
}

/**
 * Updates {played, wins, streak, maxStreak, last, lastWon} for one
 * difficulty. Idempotent per local day: calling this twice on the same day
 * (e.g. a stats-page revisit) leaves the meta untouched the second time, so
 * a game does not need its own guard. `lastWon` lets the hub tell a solved
 * day from a lost day.
 */
export function recordResult(gameId, won, diff = "medium", now = new Date()) {
  const s = store(gameId, diff);
  const meta = s.loadMeta();
  const today = todayKey(now);

  if (meta.last === today) {
    return meta;
  }

  const wasYesterday = meta.last
    ? Math.round((localDateFromKey(today) - localDateFromKey(meta.last)) / DAY_MS) === 1
    : false;

  const next = {
    played: meta.played + 1,
    wins: meta.wins + (won ? 1 : 0),
    streak: won ? (wasYesterday ? meta.streak + 1 : 1) : 0,
    maxStreak: meta.maxStreak,
    last: today,
    lastWon: won,
  };
  next.maxStreak = Math.max(next.maxStreak, next.streak);

  s.saveMeta(next);
  return next;
}

function shareLineKey(gameId, dateKey) {
  return `pp.shareline.${gameId}.${dateKey}`;
}

/**
 * A game calls this right where it calls recordResult, with the same
 * one-line result its own share button would show. The hub reads these
 * back to build a same-day "share today" summary without re-deriving any
 * game's scoring or re-fetching its bank.
 */
export function setShareLine(gameId, dateKey, line) {
  writeStorage(shareLineKey(gameId, dateKey), line);
}

/** The line a game recorded for that date, or null if it wasn't played. */
export function getShareLine(gameId, dateKey) {
  return readStorage(shareLineKey(gameId, dateKey));
}

/** Small stats block markup for one difficulty, styled by .pp-stats in site.css. */
export function statsHTML(gameId, diff = "medium") {
  const meta = store(gameId, diff).loadMeta();
  const winPct = meta.played > 0 ? Math.round((meta.wins / meta.played) * 100) : 0;
  const stat = (value, label) =>
    `<div class="pp-stat"><div class="pp-stat__value">${value}</div>` +
    `<div class="pp-stat__label">${label}</div></div>`;

  return (
    `<p class="pp-stats-diff pp-muted">${DIFF_LABELS[diff] || DIFF_LABELS.medium} difficulty</p>` +
    `<div class="pp-stats">` +
    stat(meta.played, "Played") +
    stat(`${winPct}%`, "Win rate") +
    stat(meta.streak, "Streak") +
    stat(meta.maxStreak, "Best") +
    `</div>`
  );
}

/**
 * Segmented Easy/Medium/Hard control mounted into `container`. Persists the
 * last-used tab in pp.<id>.diff and restores it on the next visit. Returns
 * the initial difficulty synchronously; `onChange(diff)` fires only on a
 * later user-driven switch, not for the initial paint, so callers can load
 * their starting state from the return value without a redundant reload.
 * Arrow-left/right move focus and selection between tabs.
 */
export function diffTabs(container, gameId, onChange, defaultDiff = "medium") {
  let current = lastDiff(gameId, defaultDiff);

  container.innerHTML = "";
  container.classList.add("pp-difftabs");
  container.setAttribute("role", "tablist");
  container.setAttribute("aria-label", "Difficulty");

  const buttons = {};
  DIFFICULTIES.forEach((d, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pp-difftabs__tab";
    btn.setAttribute("role", "tab");
    btn.dataset.difficulty = d;
    btn.textContent = DIFF_LABELS[d];
    btn.addEventListener("click", () => {
      if (d !== current) select(d);
      btn.focus();
    });
    buttons[d] = btn;
    container.appendChild(btn);
  });

  container.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const i = DIFFICULTIES.indexOf(current);
    const nextIndex =
      e.key === "ArrowRight" ? (i + 1) % DIFFICULTIES.length : (i - 1 + DIFFICULTIES.length) % DIFFICULTIES.length;
    const next = DIFFICULTIES[nextIndex];
    select(next);
    buttons[next].focus();
  });

  function select(next, silent = false) {
    current = next;
    writeStorage(diffKey(gameId), next);
    for (const d of DIFFICULTIES) {
      const isActive = d === next;
      buttons[d].setAttribute("aria-selected", String(isActive));
      buttons[d].tabIndex = isActive ? 0 : -1;
    }
    if (!silent) onChange(next);
  }

  select(current, true);
  return current;
}

let toastRegion = null;

function getToastRegion() {
  if (toastRegion && document.body.contains(toastRegion)) return toastRegion;
  toastRegion = document.createElement("div");
  toastRegion.className = "pp-toast-region";
  toastRegion.setAttribute("aria-live", "polite");
  toastRegion.setAttribute("role", "status");
  document.body.appendChild(toastRegion);
  return toastRegion;
}

/** Brief, non-blocking status message. */
export function toast(msg) {
  const region = getToastRegion();
  const el = document.createElement("div");
  el.className = "pp-toast";
  el.textContent = msg;
  region.appendChild(el);

  requestAnimationFrame(() => el.classList.add("pp-toast--visible"));

  window.setTimeout(() => {
    el.classList.remove("pp-toast--visible");
    window.setTimeout(() => el.remove(), 220);
  }, 2200);
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    return true;
  } catch {
    return false;
  }
}

/**
 * navigator.share on mobile when available, otherwise clipboard + toast.
 * The Android wrapper injects window.NativeApp on its own bundled origin
 * only; when it's there, hand the share off to it instead, since a WebView
 * has no navigator.share and would otherwise silently fall back to a copy
 * the player never asked for.
 */
export async function share(text) {
  if (globalThis.NativeApp && typeof globalThis.NativeApp.postMessage === "function") {
    try {
      globalThis.NativeApp.postMessage(JSON.stringify({ type: "share", text }));
      return;
    } catch {
      /* fall through to the web path below */
    }
  }
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (err) {
      if (err && err.name === "AbortError") return;
      /* share failed or unsupported target: fall back to clipboard below */
    }
  }
  const ok = await copyToClipboard(text);
  toast(ok ? "Copied to clipboard" : "Could not copy");
}

let activeModal = null;

function focusableIn(root) {
  return Array.from(
    root.querySelectorAll(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
    )
  );
}

/** Accessible dialog: Escape closes, focus is trapped and restored. */
export function modal(title, bodyHTML) {
  closeModal();

  const previouslyFocused = document.activeElement;
  const backdrop = document.createElement("div");
  backdrop.className = "pp-modal-backdrop";

  const titleId = `pp-modal-title-${Date.now()}`;
  const dialog = document.createElement("div");
  dialog.className = "pp-modal";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", titleId);

  dialog.innerHTML =
    `<div class="pp-modal__head">` +
    `<h2 class="pp-modal__title" id="${titleId}">${title}</h2>` +
    `<button type="button" class="pp-icon-btn pp-modal__close" aria-label="Close">` +
    `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round">` +
    `<path d="M6 6l12 12M18 6L6 18"/></svg></button></div>` +
    `<div class="pp-modal__body">${bodyHTML}</div>`;

  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  function onKeydown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeModal();
      return;
    }
    if (e.key === "Tab") {
      const focusables = focusableIn(dialog);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  function onBackdropClick(e) {
    if (e.target === backdrop) closeModal();
  }

  dialog.querySelector(".pp-modal__close").addEventListener("click", closeModal);
  backdrop.addEventListener("click", onBackdropClick);
  document.addEventListener("keydown", onKeydown);

  const firstFocusable = focusableIn(dialog)[0];
  (firstFocusable || dialog).focus?.();
  dialog.tabIndex = -1;
  if (!firstFocusable) dialog.focus();

  activeModal = { backdrop, onKeydown, previouslyFocused };

  return closeModal;
}

function closeModal() {
  if (!activeModal) return;
  const { backdrop, onKeydown, previouslyFocused } = activeModal;
  document.removeEventListener("keydown", onKeydown);
  backdrop.remove();
  activeModal = null;
  if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
}

/** Small canvas celebration. No-op under prefers-reduced-motion. */
export function confettiBurst() {
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.className = "pp-confetti-canvas";
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  document.body.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    return;
  }
  ctx.scale(dpr, dpr);

  const styles = getComputedStyle(document.documentElement);
  const colors = [
    styles.getPropertyValue("--tile-ink").trim() || "#1e3a5f",
    styles.getPropertyValue("--tile-mark").trim() || "#b8791a",
    styles.getPropertyValue("--accent-2").trim() || "#8a2e22",
    styles.getPropertyValue("--good").trim() || "#35633f",
  ];

  const count = 90;
  const originX = w / 2;
  const originY = h * 0.35;
  const particles = Array.from({ length: count }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 3 + Math.random() * 6;
    return {
      x: originX,
      y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2,
      size: 4 + Math.random() * 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      spin: Math.random() * Math.PI,
      spinSpeed: (Math.random() - 0.5) * 0.4,
    };
  });

  const duration = 1100;
  const start = performance.now();

  function frame(now) {
    const t = now - start;
    ctx.clearRect(0, 0, w, h);
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.18;
      p.spin += p.spinSpeed;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.spin);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, 1 - t / duration);
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();
    }
    if (t < duration) {
      requestAnimationFrame(frame);
    } else {
      canvas.remove();
    }
  }

  requestAnimationFrame(frame);
}

function applyTheme(theme) {
  if (theme) {
    document.documentElement.setAttribute("data-theme", theme);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

function currentTheme() {
  const stored = readStorage(THEME_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function themeToggleSVG(theme) {
  return theme === "dark"
    ? `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
        `<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
        `<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`;
}

/**
 * Tells the Android wrapper which theme is in effect, so its status bar can
 * match. Posted on load and on every change, including a live system
 * change while the player hasn't picked an explicit theme. No-op on the
 * web, where window.NativeApp is never defined.
 */
function notifyNativeTheme(theme) {
  if (globalThis.NativeApp && typeof globalThis.NativeApp.postMessage === "function") {
    try {
      globalThis.NativeApp.postMessage(JSON.stringify({ type: "theme", theme }));
    } catch {
      /* wrapper listener gone or misbehaving: nothing to do here */
    }
  }
}

function wireThemeToggle(btn) {
  applyTheme(readStorage(THEME_KEY));
  const initial = currentTheme();
  btn.innerHTML = themeToggleSVG(initial);
  notifyNativeTheme(initial);

  if (globalThis.matchMedia) {
    globalThis.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
      if (readStorage(THEME_KEY)) return; // explicit choice on record: system changes don't apply
      const theme = e.matches ? "dark" : "light";
      btn.innerHTML = themeToggleSVG(theme);
      notifyNativeTheme(theme);
    });
  }

  btn.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    writeStorage(THEME_KEY, next);
    applyTheme(next);
    btn.innerHTML = themeToggleSVG(next);
    notifyNativeTheme(next);
  });
}

/**
 * Builds the shared top bar (wordmark, game name, help, stats, theme toggle)
 * into a `#pp-chrome` mount point, creating one at the top of <body> if the
 * page did not provide one. gameMeta: { id, name, hubHref, helpHTML,
 * archiveDate }. archiveDate, when set to a resolved "YYYY-MM-DD" key, adds
 * a small banner below the top bar saying which past day is loaded, with a
 * link back to today's puzzle (every game page lives at
 * games/<id>/index.html, so a plain relative link drops the ?date= param).
 */
export function initChrome(gameMeta) {
  const { id, name, hubHref = "../../index.html", helpHTML = "", archiveDate = null } = gameMeta;

  document.documentElement.dataset.game = id;

  let mount = document.getElementById("pp-chrome");
  if (!mount) {
    mount = document.createElement("div");
    mount.id = "pp-chrome";
    document.body.insertBefore(mount, document.body.firstChild);
  }

  const archiveHTML = archiveDate
    ? `<div class="pp-archive-banner"><div class="pp-archive-banner__inner">` +
      `<span>Playing ${formatDateLabel(archiveDate)}, not today's puzzle.</span>` +
      `<a href="index.html">Back to today</a></div></div>`
    : "";

  mount.innerHTML =
    `<div class="pp-topbar"><div class="pp-topbar__inner">` +
    `<a class="pp-topbar__wordmark" href="${hubHref}">Puzzle Press</a>` +
    `<span class="pp-topbar__divider" aria-hidden="true"></span>` +
    `<span class="pp-topbar__title"><h1 class="pp-topbar__game">${name}</h1>` +
    `<span class="pp-topbar__underline" aria-hidden="true"></span></span>` +
    `<div class="pp-topbar__actions">` +
    `<button type="button" class="pp-icon-btn" data-action="help" aria-label="How to play">` +
    `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    `<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.9.4-1.5 1-1.5 2.2"/>` +
    `<circle cx="12" cy="17.2" r="0.6" fill="currentColor" stroke="none"/></svg></button>` +
    `<button type="button" class="pp-icon-btn" data-action="stats" aria-label="Statistics">` +
    `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M5 20V10M12 20V4M19 20v-7"/></svg></button>` +
    `<button type="button" class="pp-theme-toggle" data-action="theme" aria-label="Toggle color theme"></button>` +
    `</div></div></div>` +
    archiveHTML;

  const openHelp = () => modal("How to play", helpHTML || "<p>Rules coming soon.</p>");

  mount.querySelector('[data-action="help"]').addEventListener("click", openHelp);
  mount.querySelector('[data-action="stats"]').addEventListener("click", () => {
    modal("Statistics", statsHTML(id, lastDiff(id)));
  });
  wireThemeToggle(mount.querySelector('[data-action="theme"]'));

  const seenHelpKey = `pp.${id}.seenHelp`;
  if (readStorage(seenHelpKey) !== "1") {
    writeStorage(seenHelpKey, "1");
    openHelp();
  }
}
