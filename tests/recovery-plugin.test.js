const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const vm = require("node:vm");
const path = require("node:path");
const os = require("node:os");

test("built plugin runs and undoes a turn with no Git and no whole-vault enumeration", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vb-recovery-plugin-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let saved;
  const blank = class {};
  class Plugin {
    async loadData() {
      return { settings: { gitExecutable: "missing-git" } };
    }
    async saveData(data) {
      saved = data;
    }
    registerView() {}
    addRibbonIcon() {}
    addCommand() {}
    addSettingTab() {}
    registerEvent() {}
  }
  const obsidian = {
    Plugin,
    Modal: blank,
    ItemView: blank,
    PluginSettingTab: blank,
    FuzzySuggestModal: blank,
  };
  const sandbox = {
    require: (id) => (id === "obsidian" ? obsidian : require(id)),
    module: { exports: {} },
    process,
    Buffer,
    setTimeout,
    clearTimeout,
    console,
  };
  vm.runInNewContext(
    await fs.readFile(path.join(__dirname, "../main.js"), "utf8"),
    sandbox,
  );
  const p = new sandbox.module.exports();
  const files = new Map([["a.md", "original"]]);
  p.manifest = { id: "test", dir: ".obsidian/plugins/test" };
  p.app = {
    vault: {
      adapter: { getBasePath: () => root },
      getFiles: () => {
        throw Error("whole vault scan forbidden (large attachments)");
      },
      getAbstractFileByPath: (name) =>
        files.has(name) ? { path: name } : null,
      read: async (file) => files.get(file.path),
      process: async (file, fn) =>
        files.set(file.path, fn(files.get(file.path))),
    },
    workspace: { getLeavesOfType: () => [], on: () => ({}) },
  };
  await p.onload();
  p.gitHistory.checkpoint = async () => {
    throw Error("Git must not be used");
  };
  let sent = false;
  p.conversations.harness = {
    connect: async () => {},
    createSession: async () => ({ id: "s" }),
    beginRun: async () => {},
    endRun: async () => {},
    setTitle: async () => {},
    submit: async () => {
      const note = await p.engine.read("a.md");
      await p.engine.patch(
        "a.md",
        note.revision,
        "original",
        "wrong",
        p.engine.runID,
      );
      sent = true;
    },
    messages: async () =>
      sent
        ? [
            {
              id: "a",
              role: "assistant",
              completed: true,
              finish: "stop",
              view: { role: "assistant", text: "done" },
            },
          ]
        : [],
    isIdle: async () => true,
  };
  await p.send("edit");
  assert.equal(files.get("a.md"), "wrong");
  assert.equal(saved.journal[0].status, "applied");
  await p.undoOperation(saved.journal[0].runId, true);
  assert.equal(files.get("a.md"), "original");
  assert.equal(saved.journal[0].status, "undone");
  await assert.rejects(
    fs.stat(path.join(root, p.manifest.dir, "history.git")),
    { code: "ENOENT" },
  );
});
