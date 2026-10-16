const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Resources } = require("../src/domain/resources");
const { ExternalWorkspace } = require("../src/domain/external-workspace");
const { NoteEngine, hash } = require("../src/domain/note-engine");
const { TurnQueue } = require("../src/domain/turn-queue");
const { ConversationService } = require("../src/backend/conversation-service");
const { WorkspaceStore } = require("../src/domain/workspace-store");
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vb-workspace-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
test("external read rejects traversal, symlinks, binary, oversized and revoked roots", async (t) => {
  const root = await fixture(t);
  const settings = { externalFolders: [root] };
  const r = new Resources(() => settings);
  const id = r.roots()[0].id;
  await fs.writeFile(path.join(root, "a.md"), "hello");
  assert.equal((await r.read(id, "a.md")).revision, hash("hello"));
  await assert.rejects(r.read(id, "../a.md"));
  await fs.symlink(root, path.join(root, "linked"), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(r.read(id, "linked/a.md"), /符号链接/);
  await fs.writeFile(path.join(root, "binary.txt"), Buffer.from([0, 1, 2]));
  await assert.rejects(r.read(id, "binary.txt"), /文本/);
  await fs.writeFile(path.join(root, "large.txt"), "a".repeat(256001));
  await assert.rejects(r.read(id, "large.txt"), /256/);
  settings.externalFolders = [];
  await assert.rejects(r.read(id, "a.md"), /授权/);
});
test("skill discovery is explicit and bounded to repository", async (t) => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, "review"));
  await fs.writeFile(path.join(root, "review", "SKILL.md"), "Review carefully");
  const r = new Resources(() => ({ skillFolder: root }));
  assert.equal((await r.skills())[0].name, "review");
  assert.equal(
    (await r.skill("review/SKILL.md")).instructions,
    "Review carefully",
  );
  await assert.rejects(r.skill("../SKILL.md"));
});

test("external text edits and creates undo without Git, preserve originals and honor revocation", async (t) => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, "a.txt"), "old");
  const journal = [];
  const engine = new NoteEngine({}, journal);
  let allowed = true;
  const w = new ExternalWorkspace({
    root,
    resources: new Resources(() => ({ externalFolders: [root] })),
    directory: path.join(root, "unused.git"),
    engine,
    journal,
    persist: async () => {},
    executable: () => "nonexistent-git",
    guard: () => {
      if (!allowed) throw Error("revoked");
    },
  });
  engine.storageForUndo = () => w;
  w.snapshot = () => {
    throw Error("must not scan");
  };
  engine.start("run", "session");
  await w.mutate(
    { path: "a.txt", revision: hash("old"), oldText: "old", newText: "wrong" },
    "run",
    "session",
  );
  await w.mutate({ path: "new.txt", text: "created" }, "run", "session", true);
  engine.stop();
  allowed = false;
  await assert.rejects(engine.undoRun("run"), /revoked/);
  allowed = true;
  await engine.undoRun("run");
  assert.equal(await fs.readFile(path.join(root, "a.txt"), "utf8"), "old");
  assert.equal(await w.readOptional("new.txt"), undefined);
  assert.equal(
    (await fs.readdir(path.join(root, "VaultBridge Recovery"))).length,
    3,
  );
  await assert.rejects(fs.stat(path.join(root, "unused.git")), {
    code: "ENOENT",
  });
});
test("external edit keeps independent Git rescue history and refuses stale edits", async (t) => {
  const root = await fixture(t);
  const project = path.join(root, "project");
  await fs.mkdir(project);
  await fs.writeFile(path.join(project, "a.md"), "old");
  const resources = new Resources(() => ({ externalFolders: [project] }));
  const journal = [];
  const engine = new NoteEngine({}, journal);
  engine.start("run", "session");
  let allowed = true;
  const w = new ExternalWorkspace({
    root: project,
    resources,
    directory: path.join(root, "history.git"),
    engine,
    journal,
    persist: async () => {},
    guard: () => {
      if (!allowed) throw Error("revoked");
    },
  });
  const before = await w.history.checkpoint("before");
  await w.mutate(
    { path: "a.md", revision: hash("old"), oldText: "old", newText: "new" },
    "run",
    "session",
  );
  assert.equal(await fs.readFile(path.join(project, "a.md"), "utf8"), "new");
  assert.equal(journal[0].workspace, project);
  await assert.rejects(
    w.mutate(
      { path: "a.md", revision: hash("old"), oldText: "old", newText: "bad" },
      "run",
      "session",
    ),
    /变化/,
  );
  await w.history.checkpoint("after");
  assert.equal((await w.history.list()).length, 2);
  const plan = await w.history.preview(before);
  await w.history.restore(plan);
  assert.equal(await fs.readFile(path.join(project, "a.md"), "utf8"), "old");
  allowed = false;
  await assert.rejects(
    w.mutate({ path: "b.md", text: "x" }, "run", "session", true),
    /revoked/,
  );
});
test("queue isolates sessions, pauses on failure and survives restart without auto delivery", async () => {
  const state = {
    sessionId: "a",
    queue: [{ id: "b", sessionId: "b", text: "other" }],
  };
  const sent = [];
  const service = { pending: true, send: async (text) => sent.push(text) };
  const q = new TurnQueue({
    state,
    service,
    persist: async () => {},
    refresh: () => {},
  });
  await q.add("one");
  await q.add("two");
  service.pending = false;
  await q.drain();
  assert.deepEqual(sent, ["one", "two"]);
  assert.equal(state.queue.length, 1);
  state.queue.push({ id: "x", sessionId: "a", text: "fail" });
  service.send = async () => {
    throw Error("offline");
  };
  await q.resume();
  assert.equal(q.paused, true);
  assert.equal(state.queue.length, 2);
  const restarted = new TurnQueue({
    state,
    service,
    persist: async () => {},
    refresh: () => {},
  });
  assert.equal(restarted.paused, true);
});
test("fork creates a separate session and preserves original ownership", async () => {
  const store = new WorkspaceStore({
    sessionId: "a",
    sessionTitles: { a: "original" },
  });
  let request;
  const service = new ConversationService({
    state: store.state,
    engine: {},
    persist: () => store.save(),
    refresh: () => {},
    harness: {
      fork: async (...x) => {
        request = x;
        return { id: "b" };
      },
      messages: async () => [],
    },
  });
  await service.forkAt("m1");
  assert.deepEqual(request, ["a", "m1"]);
  assert.equal(store.state.sessionId, "b");
  assert.equal(store.state.sessionMeta.b.parent, "a");
  assert.equal(store.state.sessionTitles.a, "original");
});
test("queue freezes selected context and keeps item when persistence fails before delivery", async () => {
  const state = { sessionId: "a", queue: [] };
  let context = "first";
  let fail = false;
  let delivered;
  const service = {
    pending: true,
    send: async (text, snapshot) => {
      delivered = snapshot;
    },
  };
  const q = new TurnQueue({
    state,
    service,
    context: async () => ({ value: context }),
    persist: async () => {
      if (fail) throw Error("disk full");
    },
    refresh: () => {},
  });
  await q.add("test");
  context = "later";
  fail = true;
  await assert.rejects(q.drain(), /disk full/);
  assert.equal(state.queue.length, 1);
  assert.equal(delivered, undefined);
  fail = false;
  await q.resume();
  assert.deepEqual(delivered, { value: "first" });
});
test("error reports redact API credentials and retain useful reason", () => {
  const { readableError } = require("../src/domain/errors");
  const msg = readableError(Error("401 sk-example-secret Bearer secret-token"));
  assert(!msg.includes("sk-example"));
  assert(!msg.includes("secret-token"));
  assert(msg.includes("认证"));
});
test("skill referenced files stay inside selected skill directory", async (t) => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, "review"));
  await fs.writeFile(path.join(root, "review", "SKILL.md"), "Read guide.txt");
  await fs.writeFile(path.join(root, "review", "guide.txt"), "guide");
  const resources = new Resources(() => ({ skillFolder: root }));
  assert.equal(
    (await resources.skillFile("review/SKILL.md", "guide.txt")).text,
    "guide",
  );
  await assert.rejects(
    resources.skillFile("review/SKILL.md", "../outside.txt"),
    /越界/,
  );
});
test("external cancellation after reading cannot perform a late write", async (t) => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, "a.md"), "old");
  const resources = new Resources(() => ({ externalFolders: [root] }));
  const engine = new NoteEngine({}, []);
  engine.start("run");
  const original = resources.readAt.bind(resources);
  let reads = 0;
  resources.readAt = async (...args) => {
    const result = await original(...args);
    if (++reads === 2) engine.stop();
    return result;
  };
  const w = new ExternalWorkspace({
    root,
    resources,
    directory: path.join(root, ".history"),
    engine,
    journal: [],
    persist: async () => {},
    guard: () => {},
  });
  await assert.rejects(
    w.mutate(
      { path: "a.md", revision: hash("old"), oldText: "old", newText: "new" },
      "run",
      "s",
    ),
    /停止/,
  );
  assert.equal(await fs.readFile(path.join(root, "a.md"), "utf8"), "old");
});
