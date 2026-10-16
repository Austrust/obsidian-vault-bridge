const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const { createRequire } = require("node:module");
const path = require("node:path");
const file = path.resolve(__dirname, "../src/plugin.js");
const localRequire = createRequire(file);
const sandbox = {
  module: { exports: {} },
  require: (name) =>
    name === "obsidian"
      ? { Plugin: class {} }
      : name.startsWith("./ui/")
        ? {}
        : localRequire(name),
};
vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox);
const Plugin = sandbox.module.exports;
function setup() {
  const p = new Plugin();
  p.settings = { autoConnect: true };
  p.refresh = () => {};
  p.fail = (e) => (p.error = e.message);
  let calls = 0;
  p.backend = {
    connect: async () => {
      calls++;
      return "client";
    },
    disconnect: async () => {},
  };
  p.conversations = { stop: async () => {} };
  return { p, count: () => calls };
}
test("opening a sidebar can connect automatically and clear an old connection error", async () => {
  const { p, count } = setup();
  p.error = "old";
  await p.autoConnect();
  assert.equal(count(), 1);
  assert.equal(p.error, "");
});
test("automatic connection respects preference, manual disconnect and unloading", async () => {
  const { p, count } = setup();
  p.settings.autoConnect = false;
  await p.autoConnect();
  p.settings.autoConnect = true;
  await p.disconnect();
  await p.autoConnect();
  assert.equal(count(), 0);
  await p.connect();
  assert.equal(count(), 1);
  p.unloading = true;
  await p.autoConnect();
  assert.equal(count(), 1);
});
test("failed automatic startup exposes an error and manual retry recovers", async () => {
  const { p } = setup();
  p.backend.connect = async () => {
    throw Error("missing executable");
  };
  await p.autoConnect();
  assert.equal(p.error, "missing executable");
  p.backend.connect = async () => ({});
  await p.connect();
  assert.equal(p.error, "");
});
test("disconnect still cleans up when abort fails", async () => {
  const { p } = setup();
  let closed = false;
  p.conversations.stop = async () => {
    throw Error("abort failed");
  };
  p.backend.disconnect = async () => {
    closed = true;
  };
  await assert.rejects(p.disconnect(), /abort failed/);
  assert(closed);
  assert(p.autoConnectPaused);
});

test("plugin reload barrier waits for old persistence and turn drain", async () => {
  const { p } = setup();
  p.app = {};
  let release;
  const drain = new Promise((r) => (release = r));
  let disposed = false;
  p.conversations = { dispose: () => drain };
  p.store = { dispose: () => (disposed = true), tail: Promise.resolve() };
  p.engine = { stop() {}, serial: { tail: Promise.resolve() } };
  p.onunload();
  assert(disposed);
  let finished = false;
  const barrier = p.app[Symbol.for("vaultbridge.lifecycle")].then(
    () => (finished = true),
  );
  await new Promise((r) => setImmediate(r));
  assert(!finished);
  release();
  await barrier;
  assert(finished);
});

const { ConversationService } = require("../src/backend/conversation-service");
test("model configuration reserves the workspace through disconnect and prevents mixed-model turns", async () => {
  const { p } = setup();
  p.settings = {
    executable: "opencode",
    provider: "demo",
    model: "old",
    baseURL: "http://127.0.0.1:1234/v1",
  };
  p.apiKey = "old-session-key";
  p.persist = async () => {};
  p.turnQueue = { pause() {} };
  let release;
  p.backend.disconnect = () =>
    new Promise((r) => {
      release = r;
    });
  p.conversations = new ConversationService({
    runtime: p.backend,
    engine: {},
    state: p,
    persist: p.persist,
    refresh: p.refresh,
  });
  const changing = p.configureConnection(
    { model: "new" },
    { connect: false, apiKey: "new-session-key" },
  );
  assert(p.preparing);
  await assert.rejects(p.conversations.send("must not start"), /停止/);
  assert.equal(p.settings.model, "old");
  release();
  await changing;
  assert.equal(p.settings.model, "new");
  assert.equal(p.apiKey, "new-session-key");
  assert(!p.preparing);
});
test("invalid connection settings are rejected before disconnect and failed persistence restores settings", async () => {
  const { p } = setup();
  p.settings = {
    executable: "opencode",
    provider: "demo",
    model: "old",
    baseURL: "https://example.test/v1",
  };
  p.apiKey = "old";
  p.persist = async () => {
    throw Error("disk full");
  };
  p.turnQueue = { pause() {} };
  let disconnected = 0;
  p.backend.disconnect = async () => {
    disconnected++;
  };
  p.conversations = new ConversationService({
    runtime: p.backend,
    engine: {},
    state: p,
    persist: p.persist,
    refresh: p.refresh,
  });
  await assert.rejects(p.configureConnection({ baseURL: "not-a-url" }), /API/);
  assert.equal(disconnected, 0);
  await assert.rejects(
    p.configureConnection({ model: "new" }, { apiKey: "new", connect: false }),
    /disk full/,
  );
  assert.equal(p.settings.model, "old");
  assert.equal(p.apiKey, "old");
  assert(!p.preparing);
});
