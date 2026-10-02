import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../sw.js", import.meta.url), "utf8");

function loadWorker({ cached = undefined, online = false } = {}) {
  const listeners = {};
  const matchCalls = [];
  const putCalls = [];
  const context = vm.createContext({
    URL,
    Response,
    self: { addEventListener: (type, fn) => (listeners[type] = fn) },
    caches: {
      match: (request, options) => {
        matchCalls.push({ url: request.url, options });
        return Promise.resolve(cached);
      },
      open: () => Promise.resolve({ put: (request) => putCalls.push(request.url) }),
    },
    fetch: () =>
      online ? Promise.resolve({ ok: true, type: "basic", clone() { return this; } }) : Promise.reject(new Error("offline")),
  });
  vm.runInContext(source, context);

  async function dispatch(url, mode) {
    let responded;
    listeners.fetch({
      request: { url, mode, method: "GET" },
      respondWith: (p) => (responded = p),
    });
    return responded;
  }
  return { dispatch, matchCalls, putCalls, settle: () => new Promise((r) => setTimeout(r, 0)) };
}

test("a navigation to an archive day matches the cached page without its query", async () => {
  const page = new Response("page");
  const sw = loadWorker({ cached: page });
  const response = await sw.dispatch("https://x/games/wordrow/index.html?date=2026-09-01", "navigate");
  assert.equal(response, page);
  assert.equal(sw.matchCalls.length, 1);
  assert.equal(sw.matchCalls[0].options?.ignoreSearch, true);
});

test("other requests still match their exact URL", async () => {
  const sw = loadWorker();
  await sw.dispatch("https://x/data/wordrow.json?v=1", "cors");
  assert.equal(sw.matchCalls.length, 1);
  assert.ok(!sw.matchCalls[0].options?.ignoreSearch);
});

test("an uncached page offline still gets the 503 fallback", async () => {
  const sw = loadWorker();
  const response = await sw.dispatch("https://x/games/wordrow/index.html?date=2026-09-01", "navigate");
  assert.equal(response.status, 503);
});

test("a fetched page is cached by its plain URL only, never once per ?date=", async () => {
  const sw = loadWorker({ online: true });
  await sw.dispatch("https://x/games/wordrow/index.html?date=2026-09-01", "navigate");
  await sw.dispatch("https://x/games/wordrow/index.html", "navigate");
  await sw.settle();
  assert.deepEqual(sw.putCalls, ["https://x/games/wordrow/index.html"]);
});
