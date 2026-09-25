import test from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.map.set(key, String(value));
  }
  removeItem(key) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
  key(i) {
    return Array.from(this.map.keys())[i] ?? null;
  }
  get length() {
    return this.map.size;
  }
}

globalThis.localStorage = new MemoryStorage();

const {
  dayIndex,
  todayKey,
  pickDaily,
  store,
  recordResult,
  statsHTML,
  lastDiff,
  dateKeyForIndex,
  resolveArchiveDay,
  formatDateLabel,
  localDateFromKey,
  setShareLine,
  getShareLine,
  share,
} = await import("./shared.js");

test("dayIndex is 0 on the epoch date itself", () => {
  assert.equal(dayIndex("2026-08-10", new Date(2026, 7, 10)), 0);
});

test("dayIndex counts whole local calendar days forward", () => {
  assert.equal(dayIndex("2026-08-10", new Date(2026, 7, 11)), 1);
  assert.equal(dayIndex("2026-08-10", new Date(2026, 7, 11, 23, 59, 59)), 1);
  assert.equal(dayIndex("2026-08-10", new Date(2026, 8, 9)), 30);
});

test("dayIndex is negative before the epoch", () => {
  assert.equal(dayIndex("2026-08-10", new Date(2026, 7, 9)), -1);
});

test("dayIndex ignores time-of-day, only the local calendar date matters", () => {
  assert.equal(dayIndex("2026-08-10", new Date(2026, 7, 15, 3)), 5);
  assert.equal(dayIndex("2026-08-10", new Date(2026, 7, 15, 23, 59, 59)), 5);
});

test("dayIndex rolls over at the same instant as todayKey (local midnight)", () => {
  const lateEvening = new Date(2026, 7, 14, 23, 59, 59);
  const justAfterMidnight = new Date(2026, 7, 15, 0, 0, 0);
  assert.equal(dayIndex("2026-08-10", justAfterMidnight) - dayIndex("2026-08-10", lateEvening), 1);
  assert.notEqual(todayKey(lateEvening), todayKey(justAfterMidnight));
  const sameKey = todayKey(lateEvening) === todayKey(new Date(2026, 7, 14, 12));
  const sameIdx =
    dayIndex("2026-08-10", lateEvening) === dayIndex("2026-08-10", new Date(2026, 7, 14, 12));
  assert.equal(sameKey, true);
  assert.equal(sameIdx, true);
});

test("dayIndex stays exact across a DST transition", () => {
  // 2026-03-08 is the US spring-forward date; the local day is 23 hours long
  // in most US zones. Whole-day counting must not drift.
  assert.equal(
    dayIndex("2026-03-01", new Date(2026, 2, 9)) - dayIndex("2026-03-01", new Date(2026, 2, 7)),
    2
  );
});

test("todayKey formats local date as YYYY-MM-DD, zero-padded", () => {
  assert.equal(todayKey(new Date(2026, 0, 5, 10)), "2026-01-05");
  assert.equal(todayKey(new Date(2026, 10, 30, 23)), "2026-11-30");
});

test("pickDaily is stable forever for a given date and wraps by length", () => {
  const bank = { puzzles: ["a", "b", "c", "d", "e"] };
  const d0 = new Date(2026, 7, 10);
  assert.equal(pickDaily(bank, "2026-08-10", d0), "a");
  assert.equal(pickDaily(bank, "2026-08-10", new Date(2026, 7, 11)), "b");
  assert.equal(pickDaily(bank, "2026-08-10", new Date(2026, 7, 15)), "a");
  assert.equal(pickDaily(bank, "2026-08-10", new Date(2026, 7, 16)), "b");
});

test("pickDaily accepts a plain array too", () => {
  const bank = ["x", "y", "z"];
  assert.equal(pickDaily(bank, "2026-08-10", new Date(2026, 7, 10)), "x");
});

test("pickDaily is stable for dates before the epoch (wraps negative indices)", () => {
  const bank = { puzzles: ["a", "b", "c"] };
  const before = new Date(2026, 7, 9);
  assert.equal(pickDaily(bank, "2026-08-10", before), "c");
});

test("pickDaily returns the same puzzle all local day, morning to midnight", () => {
  const bank = { puzzles: ["a", "b", "c", "d", "e"] };
  const morning = pickDaily(bank, "2026-08-10", new Date(2026, 7, 12, 8));
  const evening = pickDaily(bank, "2026-08-10", new Date(2026, 7, 12, 19, 30));
  const lastSecond = pickDaily(bank, "2026-08-10", new Date(2026, 7, 12, 23, 59, 59));
  assert.equal(morning, evening);
  assert.equal(morning, lastSecond);
});

test("pickDaily throws on an empty bank", () => {
  assert.throws(() => pickDaily({ puzzles: [] }, "2026-08-10"));
});

// ---------- archive (dateKeyForIndex, resolveArchiveDay, formatDateLabel) ----------

test("dateKeyForIndex is the exact inverse of dayIndex", () => {
  const epoch = "2026-08-10";
  for (const idx of [0, 1, 5, 30, 200]) {
    const key = dateKeyForIndex(epoch, idx);
    assert.equal(dayIndex(epoch, localDateFromKey(key)), idx);
  }
});

test("dateKeyForIndex rolls over months and years correctly", () => {
  assert.equal(dateKeyForIndex("2026-08-10", 21), "2026-08-31");
  assert.equal(dateKeyForIndex("2026-08-10", 22), "2026-09-01");
  assert.equal(dateKeyForIndex("2026-08-10", 143), "2026-12-31");
  assert.equal(dateKeyForIndex("2026-08-10", 144), "2027-01-01");
});

test("dateKeyForIndex stays exact across a DST transition", () => {
  // Same DST date used in the dayIndex DST test above, checked in reverse.
  assert.equal(dateKeyForIndex("2026-03-01", 6), "2026-03-07");
  assert.equal(dateKeyForIndex("2026-03-01", 8), "2026-03-09");
});

test("resolveArchiveDay falls back to today when no date is requested", () => {
  const now = new Date(2026, 7, 15);
  const r = resolveArchiveDay("2026-08-10", null, now);
  assert.equal(r.dateKey, "2026-08-15");
  assert.equal(r.dayNumber, 6);
  assert.equal(r.isArchive, false);
  assert.equal(r.now.getTime(), now.getTime());
});

test("resolveArchiveDay accepts a valid past date and marks it archived", () => {
  const now = new Date(2026, 7, 15);
  const r = resolveArchiveDay("2026-08-10", "2026-08-12", now);
  assert.equal(r.dateKey, "2026-08-12");
  assert.equal(r.dayNumber, 3);
  assert.equal(r.isArchive, true);
  assert.equal(todayKey(r.now), "2026-08-12");
});

test("resolveArchiveDay treats a request for today's own date as not archived", () => {
  const now = new Date(2026, 7, 15);
  const r = resolveArchiveDay("2026-08-10", "2026-08-15", now);
  assert.equal(r.isArchive, false);
  assert.equal(r.dateKey, "2026-08-15");
});

test("resolveArchiveDay rejects a date before the epoch", () => {
  const now = new Date(2026, 7, 15);
  const r = resolveArchiveDay("2026-08-10", "2026-08-01", now);
  assert.equal(r.isArchive, false);
  assert.equal(r.dateKey, "2026-08-15");
});

test("resolveArchiveDay rejects a date after today", () => {
  const now = new Date(2026, 7, 15);
  const r = resolveArchiveDay("2026-08-10", "2026-08-20", now);
  assert.equal(r.isArchive, false);
  assert.equal(r.dateKey, "2026-08-15");
});

test("resolveArchiveDay rejects garbage and malformed dates", () => {
  const now = new Date(2026, 7, 15);
  for (const bad of ["", "not-a-date", "2026-02-31", "2026-13-01", "08-12-2026"]) {
    const r = resolveArchiveDay("2026-08-10", bad, now);
    assert.equal(r.isArchive, false, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

test("formatDateLabel renders a human month/day/year label", () => {
  const label = formatDateLabel("2026-08-10");
  assert.match(label, /Aug/);
  assert.match(label, /10/);
  assert.match(label, /2026/);
});

test("store defaults to the medium difficulty and round-trips day state and meta", () => {
  globalThis.localStorage.clear();
  const s = store("wordrow");
  assert.equal(s.loadDay(), null);

  s.saveDay({ guesses: ["crane"] });
  const today = todayKey();
  assert.deepEqual(s.loadDay(), { guesses: ["crane"] });
  assert.equal(
    globalThis.localStorage.getItem(`pp.wordrow.medium.day.${today}`),
    JSON.stringify({ guesses: ["crane"] })
  );

  assert.deepEqual(s.loadMeta(), {
    played: 0,
    wins: 0,
    streak: 0,
    maxStreak: 0,
    last: null,
    lastWon: null,
  });

  s.saveMeta({ played: 2, wins: 1, streak: 1, maxStreak: 1, last: today, lastWon: true });
  assert.deepEqual(s.loadMeta(), {
    played: 2,
    wins: 1,
    streak: 1,
    maxStreak: 1,
    last: today,
    lastWon: true,
  });
});

test("store namespaces keys per gameId so games never collide", () => {
  globalThis.localStorage.clear();
  store("wordrow").saveDay({ a: 1 });
  store("heptagram").saveDay({ b: 2 });
  assert.deepEqual(store("wordrow").loadDay(), { a: 1 });
  assert.deepEqual(store("heptagram").loadDay(), { b: 2 });
});

test("store namespaces keys per difficulty so easy/medium/hard never collide", () => {
  globalThis.localStorage.clear();
  store("wordrow", "easy").saveDay({ tier: "easy" });
  store("wordrow", "medium").saveDay({ tier: "medium" });
  store("wordrow", "hard").saveDay({ tier: "hard" });
  assert.deepEqual(store("wordrow", "easy").loadDay(), { tier: "easy" });
  assert.deepEqual(store("wordrow", "medium").loadDay(), { tier: "medium" });
  assert.deepEqual(store("wordrow", "hard").loadDay(), { tier: "hard" });

  recordResult("wordrow", true, "easy", new Date(2026, 7, 10));
  recordResult("wordrow", false, "hard", new Date(2026, 7, 10));
  assert.equal(store("wordrow", "easy").loadMeta().streak, 1);
  assert.equal(store("wordrow", "hard").loadMeta().streak, 0);
  assert.equal(store("wordrow", "medium").loadMeta().played, 0);
});

test("store survives corrupted JSON in localStorage", () => {
  globalThis.localStorage.clear();
  const today = todayKey();
  globalThis.localStorage.setItem(`pp.wordrow.medium.day.${today}`, "{not json");
  assert.equal(store("wordrow").loadDay(), null);
});

test("recordResult: first ever win starts a streak of 1 and records lastWon", () => {
  globalThis.localStorage.clear();
  const meta = recordResult("wordrow", true, "medium", new Date(2026, 7, 10));
  assert.deepEqual(meta, {
    played: 1,
    wins: 1,
    streak: 1,
    maxStreak: 1,
    last: "2026-08-10",
    lastWon: true,
  });
});

test("recordResult: a loss resets streak, still counts played, and records lastWon false", () => {
  globalThis.localStorage.clear();
  recordResult("wordrow", true, "medium", new Date(2026, 7, 10));
  const meta = recordResult("wordrow", false, "medium", new Date(2026, 7, 11));
  assert.equal(meta.played, 2);
  assert.equal(meta.wins, 1);
  assert.equal(meta.streak, 0);
  assert.equal(meta.maxStreak, 1);
  assert.equal(meta.lastWon, false);
});

test("recordResult: consecutive local days extend the streak", () => {
  globalThis.localStorage.clear();
  recordResult("wordrow", true, "medium", new Date(2026, 7, 10));
  recordResult("wordrow", true, "medium", new Date(2026, 7, 11));
  const meta = recordResult("wordrow", true, "medium", new Date(2026, 7, 12));
  assert.equal(meta.streak, 3);
  assert.equal(meta.maxStreak, 3);
});

test("recordResult: a gap of more than one day breaks the streak", () => {
  globalThis.localStorage.clear();
  recordResult("wordrow", true, "medium", new Date(2026, 7, 10));
  const meta = recordResult("wordrow", true, "medium", new Date(2026, 7, 13));
  assert.equal(meta.streak, 1);
  assert.equal(meta.maxStreak, 1);
});

test("recordResult is idempotent for the same local day", () => {
  globalThis.localStorage.clear();
  recordResult("wordrow", true, "medium", new Date(2026, 7, 10));
  const again = recordResult("wordrow", false, "medium", new Date(2026, 7, 10));
  const meta = store("wordrow").loadMeta();
  assert.equal(again.played, 1);
  assert.equal(meta.played, 1);
  assert.equal(meta.wins, 1);
  assert.equal(meta.streak, 1);
  assert.equal(meta.lastWon, true);
});

test("recordResult keeps maxStreak once a streak later drops", () => {
  globalThis.localStorage.clear();
  recordResult("wordrow", true, "medium", new Date(2026, 7, 10));
  recordResult("wordrow", true, "medium", new Date(2026, 7, 11));
  recordResult("wordrow", false, "medium", new Date(2026, 7, 12));
  const meta = recordResult("wordrow", true, "medium", new Date(2026, 7, 13));
  assert.equal(meta.streak, 1);
  assert.equal(meta.maxStreak, 2);
});

test("statsHTML renders played/win rate/streak/best for the given difficulty", () => {
  globalThis.localStorage.clear();
  recordResult("wordrow", true, "hard", new Date(2026, 7, 10));
  recordResult("wordrow", false, "hard", new Date(2026, 7, 11));
  const html = statsHTML("wordrow", "hard");
  assert.match(html, /pp-stats/);
  assert.match(html, /Hard difficulty/);
  assert.match(html, />2<\/div>\s*<div class="pp-stat__label">Played</);
  assert.match(html, />50%<\/div>/);
});

test("statsHTML defaults to medium when no difficulty is given", () => {
  globalThis.localStorage.clear();
  recordResult("wordrow", true, "medium", new Date(2026, 7, 10));
  const html = statsHTML("wordrow");
  assert.match(html, /Medium difficulty/);
  assert.match(html, />1<\/div>\s*<div class="pp-stat__label">Played</);
});

// ---------- lastDiff + legacy migration ----------

test("lastDiff falls back to the given default when nothing is persisted yet", () => {
  globalThis.localStorage.clear();
  assert.equal(lastDiff("wordrow"), "medium");
  assert.equal(lastDiff("sudoku", "easy"), "easy");
});

test("lastDiff reads back a persisted, valid difficulty", () => {
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem("pp.wordrow.diff", "hard");
  assert.equal(lastDiff("wordrow"), "hard");
});

test("lastDiff ignores a corrupted difficulty value and falls back", () => {
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem("pp.wordrow.diff", "impossible");
  assert.equal(lastDiff("wordrow", "medium"), "medium");
});

test("legacy v1 keys migrate onto the medium difficulty exactly once, streak intact", () => {
  globalThis.localStorage.clear();
  const today = todayKey();
  // Simulate a pre-v2 save: flat pp.<id>.day.<date> and pp.<id>.meta.
  globalThis.localStorage.setItem(`pp.wordrow.day.${today}`, JSON.stringify({ guesses: ["crane"] }));
  globalThis.localStorage.setItem(
    "pp.wordrow.meta",
    JSON.stringify({ played: 5, wins: 4, streak: 3, maxStreak: 3, last: today })
  );

  const meta = store("wordrow", "medium").loadMeta();
  assert.equal(meta.played, 5);
  assert.equal(meta.streak, 3);
  assert.deepEqual(store("wordrow", "medium").loadDay(), { guesses: ["crane"] });

  // Legacy keys are gone; nothing is left for a second read to double-count.
  assert.equal(globalThis.localStorage.getItem("pp.wordrow.meta"), null);
  assert.equal(globalThis.localStorage.getItem(`pp.wordrow.day.${today}`), null);

  // Other difficulties start clean, not inheriting the migrated streak.
  assert.equal(store("wordrow", "easy").loadMeta().streak, 0);
  assert.equal(store("wordrow", "hard").loadMeta().streak, 0);
});

test("migration never overwrites medium data that already exists", () => {
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem(
    "pp.wordrow.medium.meta",
    JSON.stringify({ played: 9, wins: 9, streak: 9, maxStreak: 9, last: "2026-08-01", lastWon: true })
  );
  globalThis.localStorage.setItem(
    "pp.wordrow.meta",
    JSON.stringify({ played: 1, wins: 0, streak: 0, maxStreak: 0, last: null })
  );

  const meta = store("wordrow", "medium").loadMeta();
  assert.equal(meta.played, 9);
  assert.equal(meta.streak, 9);
});

test("migration is a no-op for sudoku: its bespoke legacy shape is left for its own agent", () => {
  globalThis.localStorage.clear();
  const today = todayKey();
  globalThis.localStorage.setItem(
    `pp.sudoku.day.${today}`,
    JSON.stringify({ easy: { done: true }, medium: { done: false }, hard: { done: false } })
  );
  globalThis.localStorage.setItem(
    "pp.sudoku.meta",
    JSON.stringify({ played: 2, wins: 2, streak: 2, maxStreak: 2, last: today })
  );

  store("sudoku", "medium").loadMeta();

  assert.notEqual(globalThis.localStorage.getItem(`pp.sudoku.day.${today}`), null);
  assert.notEqual(globalThis.localStorage.getItem("pp.sudoku.meta"), null);
  assert.equal(globalThis.localStorage.getItem("pp.sudoku.medium.meta"), null);
});

test("a game with no legacy data migrates cleanly to empty medium state", () => {
  globalThis.localStorage.clear();
  const meta = store("clusters", "medium").loadMeta();
  assert.deepEqual(meta, { played: 0, wins: 0, streak: 0, maxStreak: 0, last: null, lastWon: null });
});

test("getShareLine is null until a game records one for that date", () => {
  globalThis.localStorage.clear();
  assert.equal(getShareLine("wordrow", "2026-09-25"), null);
  setShareLine("wordrow", "2026-09-25", "4/6");
  assert.equal(getShareLine("wordrow", "2026-09-25"), "4/6");
});

test("share lines are namespaced by game and date", () => {
  globalThis.localStorage.clear();
  setShareLine("wordrow", "2026-09-25", "4/6");
  setShareLine("clusters", "2026-09-25", "Solved, 1 mistake");
  setShareLine("wordrow", "2026-09-24", "X/6");
  assert.equal(getShareLine("wordrow", "2026-09-25"), "4/6");
  assert.equal(getShareLine("clusters", "2026-09-25"), "Solved, 1 mistake");
  assert.equal(getShareLine("wordrow", "2026-09-24"), "X/6");
});

test("share hands off to window.NativeApp when the wrapper injects it", async () => {
  const calls = [];
  globalThis.NativeApp = { postMessage: (msg) => calls.push(msg) };
  await share("hello world");
  delete globalThis.NativeApp;
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0]), { type: "share", text: "hello world" });
});

test("share falls back to navigator.share when NativeApp is not present", async () => {
  delete globalThis.NativeApp;
  let sharedWith = null;
  const originalShare = navigator.share;
  navigator.share = async (opts) => {
    sharedWith = opts;
  };
  await share("plain web share");
  navigator.share = originalShare;
  assert.deepEqual(sharedWith, { text: "plain web share" });
});
