const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
function plugin() {
  const blank = class {};
  const sandbox = {
    module: { exports: {} },
    require: (id) =>
      id === "obsidian"
        ? {
            Plugin: blank,
            Notice: blank,
            Modal: blank,
            ItemView: blank,
            PluginSettingTab: blank,
            FuzzySuggestModal: blank,
          }
        : require(id),
    process,
    Buffer,
    URL,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "../main.js"), "utf8"),
    sandbox,
  );
  return new sandbox.module.exports();
}
test("selection-only context excludes the rest of the note; whole-note mode explicitly restores it", async () => {
  const p = plugin();
  let reads = 0;
  Object.assign(p, {
    mentions: new Set(["sample.md"]),
    selection: null,
    active: () => ({
      path: "sample.md",
      selection: "selected",
      text: "selected\nnot selected",
    }),
    refresh() {},
    persist: async () => {},
    settings: { agentMode: "plan" },
    artifacts: [],
    externalReferences: [],
    selectedSkills: new Set(),
    resources: { roots: () => [] },
    engine: {
      read: async (path) => {
        reads++;
        return { path, text: "selected\nnot selected" };
      },
    },
  });
  p.attachActive("selection");
  const only = await p.contextFor("explain");
  assert.equal(only.notes.length, 0);
  assert.equal(reads, 0);
  assert.equal(only.selection.text, "selected");
  p.attachActive("note");
  const full = await p.contextFor("explain");
  assert.equal(full.selection, null);
  assert.equal(full.notes[0].text, "selected\nnot selected");
  p.active = () => ({ path: "sample.md", selection: "", text: "sample" });
  p.attachActive("selection");
  assert.equal(p.mentions.size, 1);
  assert.equal(p.selection, null);
});

test("remembered credentials use the authenticated local API and clear the volatile key only after success", async () => {
  const p = plugin(),
    calls = [];
  Object.assign(p, {
    settings: {
      executable: "opencode",
      provider: "demo",
      model: "demo",
      baseURL: "https://example.test/v1",
    },
    apiKey: "",
    conversations: { switchSession: async (fn) => fn() },
    turnQueue: { pause() {} },
    backend: { disconnect: async () => {} },
    refresh() {},
    persist: async () => {
      assert(!JSON.stringify(p.settings).includes("fixture-key"));
    },
    connect: async () => ({
      request: async (route, method, body) => {
        calls.push({ route, method, body });
        return route.startsWith("/auth/") ? true : { all: [] };
      },
    }),
  });
  await p.configureConnection(
    {},
    { apiKey: "fixture-key", rememberKey: true, connect: false },
  );
  assert.equal(calls[0].route, "/auth/demo");
  assert.equal(calls[0].method, "PUT");
  assert.equal(calls[0].body.key, "fixture-key");
  assert.equal(p.apiKey, "");
  p.connect = async () => ({
    request: async () => {
      throw Error("fixture-key echoed by a broken server");
    },
  });
  await assert.rejects(
    p.configureConnection({}, { apiKey: "fixture-key", rememberKey: true }),
    (e) => !e.message.includes("fixture-key") && e.message.includes("保存失败"),
  );
  assert.equal(p.apiKey, "fixture-key");
});
