const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { VaultAdapter, RECOVERY } = require("../src/adapters/vault-adapter");
const { NoteEngine, hash } = require("../src/domain/note-engine");
const { NoteTools } = require("../src/backend/note-tools");
const { PermissionGate } = require("../src/domain/permissions");
const { ConversationService } = require("../src/backend/conversation-service");
const { WorkspaceStore } = require("../src/domain/workspace-store");
const { GitHistory } = require("../src/backend/git-history");
const { Diagnostics } = require("../src/backend/diagnostics");
const { archiveJournal } = require("../src/domain/journal-archive");
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vb-adapter-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const entries = new Map(),
    hooks = {},
    editors = new Map();
  const vault = {
    getAbstractFileByPath: (p) => entries.get(p),
    getFiles: () => [...entries.values()].filter((f) => !f.children),
    read: (f) => fs.readFile(path.join(root, f.path), "utf8"),
    readBinary: (f) => fs.readFile(path.join(root, f.path)),
    createFolder: async (p) => {
      await fs.mkdir(path.join(root, p));
      entries.set(p, { path: p, children: [] });
    },
    createBinary: async (p, data) => {
      await hooks.create?.(p);
      await fs.writeFile(path.join(root, p), Buffer.from(data), { flag: "wx" });
      const f = { path: p, extension: path.extname(p).slice(1) };
      entries.set(p, f);
      return f;
    },
    create: async (p, text) => vault.createBinary(p, Buffer.from(text)),
    process: async (f, fn) => {
      await hooks.process?.(f);
      const before = await vault.read(f);
      const after = fn(before);
      await fs.writeFile(path.join(root, f.path), after);
    },
    rename: async (f, d) => {
      await hooks.rename?.(f, d);
      const from = f.path;
      await fs.rename(path.join(root, from), path.join(root, d));
      entries.delete(from);
      f.path = d;
      entries.set(d, f);
    },
  };
  const adapter = new VaultAdapter({
    root,
    vault,
    editor: (p) => editors.get(p),
  });
  return { root, vault, adapter, hooks, entries, editors };
}
test("Git Markdown restore uses atomic content comparison and retains concurrent text", async (t) => {
  const f = await fixture(t);
  await f.vault.create("a.md", "old");
  f.hooks.process = async (file) =>
    fs.writeFile(path.join(f.root, file.path), "user-new");
  await assert.rejects(
    f.adapter.apply("a.md", Buffer.from("old"), Buffer.from("target")),
    /变化/,
  );
  assert.equal(await f.adapter.read("a.md"), "user-new");
});

test("operation undo restores moved and deleted notes through the real vault adapter without Git", async (t) => {
  const f = await fixture(t);
  await f.vault.create("a.md", "original");
  const journal = [];
  const engine = new NoteEngine(f.adapter, journal);
  engine.start("run", "session");
  await engine.patch("a.md", hash("original"), "original", "wrong", "run");
  await engine.relocate("a.md", "folder/moved.md", hash("wrong"), "run");
  await engine.deleteNote("folder/moved.md", hash("wrong"), "run");
  await engine.create("new.md", "new file", "run");
  engine.stop();
  assert(journal[2].recoveryPath.startsWith(RECOVERY));
  f.adapter.snapshot = () => {
    throw Error("must not scan the vault");
  };
  await engine.undoRun("run");
  assert.equal(await f.adapter.read("a.md"), "original");
  assert.equal(await f.adapter.readOptional("folder/moved.md"), undefined);
  assert.equal(await f.adapter.readOptional("new.md"), undefined);
  assert.equal(
    f.vault.getFiles().filter((x) => x.path.startsWith(RECOVERY)).length,
    2,
  );
});

test("operation undo validates the live editor buffer and leaves later edits intact", async (t) => {
  const f = await fixture(t);
  await f.vault.create("a.md", "disk");
  let value = "buffer";
  f.editors.set("a.md", {
    getValue: () => value,
    offsetToPos: (n) => ({ line: 0, ch: n }),
    replaceRange: (s) => (value = s),
  });
  const engine = new NoteEngine(f.adapter, []);
  engine.start("run");
  await engine.patch("a.md", hash("buffer"), "buffer", "agent", "run");
  engine.stop();
  value = "manual";
  await assert.rejects(engine.undoRun("run"), /后续修改/);
  assert.equal(value, "manual");
  value = "agent";
  await engine.undoRun("run");
  assert.equal(value, "buffer");
  assert.equal(await f.vault.read(f.entries.get("a.md")), "disk");
});
test("Git restore updates an open editor without replacing newer content", async (t) => {
  const f = await fixture(t);
  await f.vault.create("a.md", "disk");
  let value = "buffer";
  f.editors.set("a.md", {
    getValue: () => value,
    offsetToPos: (n) => ({ line: 0, ch: n }),
    replaceRange: (s) => (value = s),
  });
  await assert.rejects(
    f.adapter.apply("a.md", Buffer.from("disk"), Buffer.from("target")),
    /变化/,
  );
  await f.adapter.apply("a.md", Buffer.from("buffer"), Buffer.from("target"));
  assert.equal(value, "target");
  assert.equal(await f.vault.read(f.entries.get("a.md")), "disk");
});
test("binary recovery preserves a write between initial comparison and rename", async (t) => {
  const f = await fixture(t);
  await f.vault.createBinary("image.bin", Buffer.from("old"));
  f.hooks.rename = async (file) =>
    fs.writeFile(path.join(f.root, file.path), "late-user");
  await assert.rejects(
    f.adapter.apply("image.bin", Buffer.from("old"), Buffer.from("target")),
    /并发修改/,
  );
  const recovery = f.vault
    .getFiles()
    .find((x) => x.path.startsWith(RECOVERY + "/"));
  assert.equal((await f.vault.readBinary(recovery)).toString(), "late-user");
  assert.equal((await f.adapter.snapshot()).size, 0);
});
test("binary replacement refuses a concurrently recreated destination and retains original", async (t) => {
  const f = await fixture(t);
  await f.vault.create("image.bin", "old");
  f.hooks.create = async (p) => {
    if (p === "image.bin")
      await fs.writeFile(path.join(f.root, p), "concurrent", { flag: "wx" });
  };
  await assert.rejects(
    f.adapter.apply("image.bin", Buffer.from("old"), Buffer.from("target")),
    /原文件保存在/,
  );
  assert.equal(
    await fs.readFile(path.join(f.root, "image.bin"), "utf8"),
    "concurrent",
  );
  const backup = f.vault
    .getFiles()
    .find((x) => x.path.startsWith(RECOVERY + "/"));
  assert.equal(await f.vault.read(backup), "old");
});
test("production adapter restores binary and deletion with recovery copies", async (t) => {
  const f = await fixture(t);
  await f.vault.create("a.md", "first");
  await f.vault.createBinary("x.bin", Buffer.from([0, 255]));
  const git = new GitHistory({
    directory: path.join(f.root, ".history.git"),
    snapshot: () => f.adapter.snapshot(),
    apply: (...a) => f.adapter.apply(...a),
  });
  const first = await git.checkpoint("first");
  await fs.writeFile(path.join(f.root, "x.bin"), Buffer.from([9, 8]));
  await f.vault.create("new.md", "new");
  const plan = await git.preview(first);
  assert(
    [...plan.current.values()].every(
      (x) => typeof x === "string" && x.length === 40,
    ),
  );
  assert(
    [...plan.target.values()].every(
      (x) => typeof x === "string" && x.length === 40,
    ),
  );
  await git.restore(plan);
  assert.deepEqual(
    [...(await fs.readFile(path.join(f.root, "x.bin")))],
    [0, 255],
  );
  assert(!f.entries.has("new.md"));
  assert.equal(
    f.vault.getFiles().filter((x) => x.path.startsWith(RECOVERY + "/")).length,
    2,
  );
  await assert.rejects(f.adapter.read(RECOVERY + "/x.md"), /恢复副本/);
});
test("old or missing run context cannot be attributed to the next run", async () => {
  let value = "old";
  const journal = [];
  const engine = new NoteEngine(
    {
      read: async () => value,
      compareWrite: async (p, b, a, g) => {
        g();
        value = a;
      },
    },
    journal,
  );
  const tools = new NoteTools({
    engine,
    permissions: new PermissionGate(() => ({ patch_note: "allow" })),
  });
  engine.start("B");
  const args = {
    path: "a.md",
    revision: hash(value),
    oldText: "old",
    newText: "new",
  };
  await assert.rejects(tools.call("patch_note", args, "A"), /停止/);
  await assert.rejects(tools.call("patch_note", args), /停止/);
  assert.equal(value, "old");
  await tools.call("patch_note", args, "B");
  assert.equal(journal[0].runId, "B");
});
test("dispose waits for pending turn and suppresses post-checkpoint, persistence and UI", async () => {
  let release, entered;
  const ready = new Promise((r) => (entered = r)),
    hold = new Promise((r) => (release = r));
  let saved = 0,
    post = 0,
    rendered = 0,
    ended = 0;
  const store = new WorkspaceStore({ sessionId: "s" });
  const engine = new NoteEngine({}, []);
  const service = new ConversationService({
    harness: {
      connect: async () => {},
      beginRun: async () => {},
      revokeRun: () => {},
      endRun: async () => ended++,
    },
    engine,
    state: store.state,
    persist: async () => saved++,
    refresh: () => rendered++,
    context: async () => {
      entered();
      return hold;
    },
    model: () => ({}),
    afterRun: async () => post++,
  });
  const run = service.send("test");
  await ready;
  await assert.rejects(service.send("parallel"), /停止/);
  const before = rendered;
  const drain = service.dispose();
  release({});
  await drain;
  await run;
  assert.equal(saved, 0);
  assert.equal(post, 0);
  assert.equal(rendered, before);
  assert.equal(ended, 1);
  await assert.rejects(service.send("again"), /卸载/);
});
test("store drops queued snapshots after disposal", async () => {
  const writes = [];
  let release;
  const store = new WorkspaceStore({}, {}, async (data) => {
    writes.push(data);
    await new Promise((r) => (release = r));
  });
  const first = store.save();
  await new Promise((r) => setImmediate(r));
  const second = store.save();
  store.dispose();
  release();
  await Promise.all([first, second]);
  assert.equal(writes.length, 1);
});
test("diagnostics emit only known categories, never provider data or keys", () => {
  const d = new Diagnostics();
  d.ingest("sk-test-secret note: private content EADDR");
  d.ingest("INUSE\n");
  assert.equal(d.summary(), "本机端口被占用");
  d.ingest("x".repeat(10000));
  assert(d.pending.length <= 4096);
  assert(!d.summary().includes("private"));
  d.clear();
  assert.equal(d.summary(), "");
});
test("journal archival preserves pending entries and restores memory on save failure", async (t) => {
  const f = await fixture(t);
  const journal = [
    { id: "one", status: "applied", before: "old", after: "new" },
    { id: "pending", status: "pending" },
    { id: "last", status: "applied" },
  ];
  const directory = path.join(f.root, "archive");
  await assert.rejects(
    archiveJournal({
      journal,
      directory,
      keep: 1,
      guard: () => {},
      persist: async () => {
        throw Error("disk");
      },
    }),
    /disk/,
  );
  assert.equal(journal.length, 3);
  const result = await archiveJournal({
    journal,
    directory,
    keep: 1,
    guard: () => {},
    persist: async () => {},
  });
  assert.equal(result.count, 1);
  assert.deepEqual(
    journal.map((e) => e.id),
    ["pending", "last"],
  );
  assert.equal(
    JSON.parse(await fs.readFile(result.file, "utf8")).entries[0].before,
    "old",
  );
});

test("conversation accepts a normalized harness without OpenCode routes", async () => {
  const store = new WorkspaceStore();
  const engine = new NoteEngine({}, []);
  const events = [];
  let sent = false;
  const harness = {
    connect: async () => {},
    createSession: async () => ({ id: "s" }),
    beginRun: async () => events.push("begin"),
    revokeRun: () => {},
    endRun: async () => events.push("end"),
    setTitle: async () => {},
    submit: async () => {
      sent = true;
      events.push("submit");
    },
    messages: async () =>
      sent
        ? [
            {
              id: "a",
              role: "assistant",
              completed: true,
              finish: "stop",
              error: null,
              view: {
                id: "a",
                role: "assistant",
                text: "normalized",
                kind: "answer",
              },
            },
          ]
        : [],
    isIdle: async () => true,
  };
  const service = new ConversationService({
    harness,
    engine,
    state: store.state,
    model: () => ({}),
    context: async () => ({}),
    persist: async () => {},
    refresh: () => {},
  });
  await service.send("hello");
  assert.deepEqual(events, ["begin", "submit", "end"]);
  assert.equal(store.state.transcript[0].text, "normalized");
});
test("runtime cleanup waits and escalates a child ignoring SIGTERM", async () => {
  const { spawn } = require("node:child_process");
  const { OpenCodeRuntime } = require("../src/backend/opencode-runtime");
  const proc = spawn(
    process.execPath,
    [
      "-e",
      "process.on('SIGTERM',()=>{});setInterval(()=>{},1000);console.log('ready');",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  try {
    await new Promise((resolve, reject) => {
      proc.once("error", reject);
      proc.stdout.once("data", resolve);
    });
    const runtime = new OpenCodeRuntime({
      directory: "/unused",
      execute: () => {},
      settings: () => ({}),
    });
    let closed = false;
    runtime.resources = {
      proc,
      bridge: { close: async () => (closed = true) },
    };
    await runtime.cleanup();
    assert(closed);
    assert.equal(proc.signalCode, process.platform === 'win32' ? 'SIGTERM' : 'SIGKILL');
    assert(proc.exitCode !== null || proc.signalCode !== null, 'cleanup must await actual termination');
    assert.equal(runtime.resources, null);
  } finally {
    if (proc.exitCode === null && proc.signalCode === null)
      proc.kill("SIGKILL");
  }
});
