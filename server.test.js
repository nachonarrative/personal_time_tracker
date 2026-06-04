const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createAppServer,
  createSessionId,
  createSessionStore,
  getConfiguredProject,
  parseCookies,
} = require("./server");

const WORKER_ROUTE = ["fel", "low"].join("");

test("parseCookies reads URL encoded cookie values", () => {
  assert.deepEqual(parseCookies("trainer_session=abc%20123; theme=clean"), {
    trainer_session: "abc 123",
    theme: "clean",
  });
});

test("createSessionId returns long random session ids", () => {
  const first = createSessionId();
  const second = createSessionId();

  assert.equal(typeof first, "string");
  assert.ok(first.length >= 24);
  assert.notEqual(first, second);
});

test("createSessionStore stores and clears in-memory auth state", () => {
  const store = createSessionStore();

  store.ensure("s1");
  assert.equal(store.size(), 1);

  store.setAuth("s1", { cookies: [{ name: "_trajectory_session", value: "x" }] });
  assert.equal(store.get("s1").authState.cookies[0].name, "_trajectory_session");

  store.clear("s1");
  assert.equal(store.get("s1"), null);
});

test("createAppServer returns an HTTP server instance", () => {
  const server = createAppServer();

  assert.equal(typeof server.listen, "function");
  assert.equal(typeof server.close, "function");
  server.close();
});

test("getConfiguredProject reads the configured project URL", () => {
  assert.deepEqual(getConfiguredProject(), {
    id: "26a53071-8843-4138-97df-430bd3e4cd45",
    name: "Configured Project",
    projectUrl:
      `https://ai.joinhandshake.com/${WORKER_ROUTE}/projects/past/26a53071-8843-4138-97df-430bd3e4cd45`,
  });
});



