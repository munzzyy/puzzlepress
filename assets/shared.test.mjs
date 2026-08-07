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
}

globalThis.localStorage = new MemoryStorage();

const { dayIndex, todayKey, pickDaily, store, recordResult, statsHTML } = await import(
  "./shared.js"
);

test("dayIndex is 0 on the epoch date itself", () => {
  assert.equal(dayIndex("2026-08-10", new Date("2026-08-10T00:00:00Z")), 0);
});

test("dayIndex counts whole UTC days forward", () => {
  assert.equal(dayIndex("2026-08-10", new Date("2026-08-11T00:00:00Z")), 1);
  assert.equal(dayIndex("2026-08-10", new Date("2026-08-11T23:59:59Z")), 1);
  assert.equal(dayIndex("2026-08-10", new Date("2026-09-09T00:00:00Z")), 30);
});

test("dayIndex is negative before the epoch", () => {
  assert.equal(dayIndex("2026-08-10", new Date("2026-08-09T00:00:00Z")), -1);
});

test("dayIndex ignores time-of-day, only the UTC calendar date matters", () => {
  assert.equal(dayIndex("2026-08-10", new Date("2026-08-15T03:00:00Z")), 5);
  assert.equal(dayIndex("2026-08-10", new Date("2026-08-15T23:59:59Z")), 5);
});

test("todayKey formats local date as YYYY-MM-DD, zero-padded", () => {
  assert.equal(todayKey(new Date(2026, 0, 5, 10)), "2026-01-05");
  assert.equal(todayKey(new Date(2026, 10, 30, 23)), "2026-11-30");
});

test("pickDaily is stable forever for a given date and wraps by length", () => {
  const bank = { puzzles: ["a", "b", "c", "d", "e"] };
  const d0 = new Date("2026-08-10T00:00:00Z");
  assert.equal(pickDaily(bank, "2026-08-10", d0), "a");
  assert.equal(pickDaily(bank, "2026-08-10", new Date("2026-08-11T00:00:00Z")), "b");
  assert.equal(pickDaily(bank, "2026-08-10", new Date("2026-08-15T00:00:00Z")), "a");
  assert.equal(pickDaily(bank, "2026-08-10", new Date("2026-08-16T00:00:00Z")), "b");
});

test("pickDaily accepts a plain array too", () => {
  const bank = ["x", "y", "z"];
  assert.equal(pickDaily(bank, "2026-08-10", new Date("2026-08-10T00:00:00Z")), "x");
});

test("pickDaily is stable for dates before the epoch (wraps negative indices)", () => {
  const bank = { puzzles: ["a", "b", "c"] };
  const before = new Date("2026-08-09T00:00:00Z");
  assert.equal(pickDaily(bank, "2026-08-10", before), "c");
});

test("pickDaily throws on an empty bank", () => {
  assert.throws(() => pickDaily({ puzzles: [] }, "2026-08-10"));
});

test("store round-trips day state and meta under namespaced keys", () => {
  globalThis.localStorage.clear();
  const s = store("wordrow");
  assert.equal(s.loadDay(), null);

  s.saveDay({ guesses: ["crane"] });
  const today = todayKey();
  assert.deepEqual(s.loadDay(), { guesses: ["crane"] });
  assert.equal(
    globalThis.localStorage.getItem(`pp.wordrow.day.${today}`),
    JSON.stringify({ guesses: ["crane"] })
  );

  assert.deepEqual(s.loadMeta(), {
    played: 0,
    wins: 0,
    streak: 0,
    maxStreak: 0,
    last: null,
  });

  s.saveMeta({ played: 2, wins: 1, streak: 1, maxStreak: 1, last: today });
  assert.deepEqual(s.loadMeta(), {
    played: 2,
    wins: 1,
    streak: 1,
    maxStreak: 1,
    last: today,
  });
});

test("store namespaces keys per gameId so games never collide", () => {
  globalThis.localStorage.clear();
  store("wordrow").saveDay({ a: 1 });
  store("heptagram").saveDay({ b: 2 });
  assert.deepEqual(store("wordrow").loadDay(), { a: 1 });
  assert.deepEqual(store("heptagram").loadDay(), { b: 2 });
});

test("store survives corrupted JSON in localStorage", () => {
  globalThis.localStorage.clear();
  const today = todayKey();
  globalThis.localStorage.setItem(`pp.wordrow.day.${today}`, "{not json");
  assert.equal(store("wordrow").loadDay(), null);
});

test("recordResult: first ever win starts a streak of 1", () => {
  globalThis.localStorage.clear();
  const meta = recordResult("wordrow", true, new Date(2026, 7, 10));
  assert.deepEqual(meta, {
    played: 1,
    wins: 1,
    streak: 1,
    maxStreak: 1,
    last: "2026-08-10",
  });
});

test("recordResult: a loss resets streak but still counts played", () => {
  globalThis.localStorage.clear();
  recordResult("wordrow", true, new Date(2026, 7, 10));
  const meta = recordResult("wordrow", false, new Date(2026, 7, 11));
  assert.equal(meta.played, 2);
  assert.equal(meta.wins, 1);
  assert.equal(meta.streak, 0);
  assert.equal(meta.maxStreak, 1);
});

test("recordResult: consecutive local days extend the streak", () => {
  globalThis.localStorage.clear();
  recordResult("wordrow", true, new Date(2026, 7, 10));
  recordResult("wordrow", true, new Date(2026, 7, 11));
  const meta = recordResult("wordrow", true, new Date(2026, 7, 12));
  assert.equal(meta.streak, 3);
  assert.equal(meta.maxStreak, 3);
});

test("recordResult: a gap of more than one day breaks the streak", () => {
  globalThis.localStorage.clear();
  recordResult("wordrow", true, new Date(2026, 7, 10));
  const meta = recordResult("wordrow", true, new Date(2026, 7, 13));
  assert.equal(meta.streak, 1);
  assert.equal(meta.maxStreak, 1);
});

test("recordResult is idempotent for the same local day", () => {
  globalThis.localStorage.clear();
  recordResult("wordrow", true, new Date(2026, 7, 10));
  const again = recordResult("wordrow", false, new Date(2026, 7, 10));
  const meta = store("wordrow").loadMeta();
  assert.equal(again.played, 1);
  assert.equal(meta.played, 1);
  assert.equal(meta.wins, 1);
  assert.equal(meta.streak, 1);
});

test("recordResult keeps maxStreak once a streak later drops", () => {
  globalThis.localStorage.clear();
  recordResult("wordrow", true, new Date(2026, 7, 10));
  recordResult("wordrow", true, new Date(2026, 7, 11));
  recordResult("wordrow", false, new Date(2026, 7, 12));
  const meta = recordResult("wordrow", true, new Date(2026, 7, 13));
  assert.equal(meta.streak, 1);
  assert.equal(meta.maxStreak, 2);
});

test("statsHTML renders played/win rate/streak/best from meta", () => {
  globalThis.localStorage.clear();
  recordResult("wordrow", true, new Date(2026, 7, 10));
  recordResult("wordrow", false, new Date(2026, 7, 11));
  const html = statsHTML("wordrow");
  assert.match(html, /pp-stats/);
  assert.match(html, />2<\/div>\s*<div class="pp-stat__label">Played</);
  assert.match(html, />50%<\/div>/);
});
