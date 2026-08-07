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
