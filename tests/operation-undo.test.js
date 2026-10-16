const test = require("node:test");
const assert = require("node:assert/strict");
const { NoteEngine, hash } = require("../src/domain/note-engine");
const { recentRuns } = require("../src/domain/operation-undo");

function fixture(initial = { "a.md": "original", "b.md": "second" }) {
  const files = new Map(Object.entries(initial)),
    recovery = [],
    saved = [],
    hooks = {};
  const storage = {
    read: async (p) => {
      if (!files.has(p)) throw Error("missing");
      return files.get(p);
    },
    readOptional: async (p) => files.get(p),
    compareWrite: async (p, before, after, guard) => {
      await hooks.write?.(p);
      guard();
      if (files.get(p) !== before) throw Error("conflict");
      files.set(p, after);
    },
    create: async (p, text, guard) => {
      guard();
      if (files.has(p)) throw Error("occupied");
      files.set(p, text);
    },
    relocate: async (p, d, expected, guard) => {
      guard();
      if (files.get(p) !== expected || files.has(d)) throw Error("conflict");
      files.set(d, files.get(p));
      files.delete(p);
    },
    removeCreated: async (p, expected, guard) => {
      guard();
      if (files.get(p) !== expected) throw Error("conflict");
      recovery.push({ p, text: files.get(p) });
      files.delete(p);
      return "VaultBridge Recovery/" + recovery.length + "/" + p;
    },
  };
  const journal = [];
  const engine = new NoteEngine(storage, journal, async () => {
    await hooks.persist?.();
    saved.push(structuredClone(journal));
  });
  engine.start("run", "session");
  return { engine, files, journal, recovery, saved, storage, hooks };
}

test("whole turn reverses dependent edits, move, rename, delete and creation after reload", async () => {
  const f = fixture();
  await f.engine.patch("a.md", hash("original"), "original", "wrong", "run");
  await f.engine.relocate("a.md", "folder/c.md", hash("wrong"), "run");
  await f.engine.relocate(
    "folder/c.md",
    "folder/d.md",
    hash("wrong"),
    "run",
    true,
  );
  await f.engine.deleteNote("folder/d.md", hash("wrong"), "run");
  await f.engine.create("new.md", "created", "run");
  await f.engine.patch("new.md", hash("created"), "created", "changed", "run");
  f.engine.stop();
  const restored = new NoteEngine(f.storage, structuredClone(f.saved.at(-1)));
  const preview = await restored.previewUndo("run");
  assert.equal(preview.length, 6);
  assert.equal(f.files.get("new.md"), "changed");
  assert.deepEqual(await restored.undoRun("run"), { count: 6 });
  assert.deepEqual(Object.fromEntries(f.files), {
    "a.md": "original",
    "b.md": "second",
  });
  assert(restored.journal.every((e) => e.status === "undone"));
  assert(f.recovery.some((x) => x.p === "new.md" && x.text === "created"));
  await assert.rejects(restored.undoRun("run"), /没有可撤销/);
});

test("batch preflight checks every file before any undo and does not touch unrelated files", async () => {
  const f = fixture();
  await f.engine.patch("a.md", hash("original"), "original", "wrong-a", "run");
  await f.engine.patch("b.md", hash("second"), "second", "wrong-b", "run");
  f.engine.stop();
  f.files.set("a.md", "my later edit");
  f.files.set("unrelated.md", "my new file");
  await assert.rejects(f.engine.undoRun("run"), /后续修改/);
  assert.equal(f.files.get("b.md"), "wrong-b");
  assert.equal(f.files.get("a.md"), "my later edit");
  assert.equal(f.files.get("unrelated.md"), "my new file");
  assert(f.journal.every((e) => e.status === "applied"));
});

test("confirmation rechecks edits since preview and occupied move/delete destinations", async () => {
  const f = fixture();
  await f.engine.relocate("a.md", "moved.md", hash("original"), "run");
  f.engine.stop();
  await f.engine.previewUndo("run");
  f.files.set("a.md", "new user file");
  await assert.rejects(f.engine.undoRun("run"), /占用/);
  assert.equal(f.files.get("moved.md"), "original");
  f.files.delete("a.md");
  await f.engine.undoRun("run");
  f.engine.start("delete");
  await f.engine.deleteNote("b.md", hash("second"), "delete");
  f.engine.stop();
  f.files.set("b.md", "user replacement");
  await assert.rejects(f.engine.undoRun("delete"), /占用/);
});

test("late conflict reports partial completion and never overwrites a new manual edit", async () => {
  const f = fixture();
  await f.engine.patch("a.md", hash("original"), "original", "wrong-a", "run");
  await f.engine.patch("b.md", hash("second"), "second", "wrong-b", "run");
  f.engine.stop();
  f.hooks.write = async (p) => {
    if (p === "a.md") f.files.set(p, "concurrent user");
  };
  await assert.rejects(f.engine.undoRun("run"), /已撤销 1 项/);
  assert.equal(f.files.get("a.md"), "concurrent user");
  assert.equal(f.files.get("b.md"), "second");
  assert.deepEqual(
    f.journal.map((e) => e.status),
    ["undoing", "undone"],
  );
  const restored = new NoteEngine(f.storage, structuredClone(f.saved.at(-1)));
  await assert.rejects(restored.undoRun("run"), /未确认/);
});

test("failed persistence before undo leaves files unchanged; after edit stops future writes", async () => {
  const f = fixture();
  await f.engine.patch("a.md", hash("original"), "original", "wrong-a", "run");
  f.engine.stop();
  f.hooks.persist = async () => {
    throw Error("disk full");
  };
  await assert.rejects(f.engine.undoRun("run"), /保存失败/);
  assert.equal(f.files.get("a.md"), "wrong-a");
  assert.equal(f.journal[0].status, "applied");
  f.hooks.persist = null;
  await f.engine.prepareRecovery();
  f.engine.start("next");
  f.hooks.persist = async () => {
    if (f.journal.at(-1).status === "applied") throw Error("disk full");
  };
  await assert.rejects(
    f.engine.patch("b.md", hash("second"), "second", "wrong-b", "next"),
    /disk full/,
  );
  assert.equal(f.files.get("b.md"), "wrong-b");
  assert.equal(f.engine.runID, null);
  await assert.rejects(
    f.engine.create("later.md", "must not write", "next"),
    /恢复记录保存失败/,
  );
  assert(!f.files.has("later.md"));
  assert.equal(f.saved.at(-1).at(-1).status, "pending");
  const restored = new NoteEngine(f.storage, structuredClone(f.saved.at(-1)));
  await assert.rejects(restored.undoRun("next"), /未确认/);
});

test("pending creation is never removed after restart even when contents match", async () => {
  const f = fixture({ "new.md": "same" });
  f.engine.stop();
  f.journal.push({
    id: "uncertain",
    runId: "interrupted",
    kind: "create",
    path: "new.md",
    before: "",
    after: "same",
    status: "pending",
  });
  await assert.rejects(f.engine.undo("uncertain"), /没有可撤销/);
  await assert.rejects(f.engine.undoRun("interrupted"), /未确认/);
  assert.equal(f.files.get("new.md"), "same");
});

test("recent turns and archival retain complete recent and unresolved rounds", async (t) => {
  const fs = require("node:fs/promises");
  const path = require("node:path");
  const os = require("node:os");
  const { archiveJournal } = require("../src/domain/journal-archive");
  const entries = Array.from({ length: 25 }, (_, i) => ({
    runId: String(i),
    sessionId: "a",
    time: i,
    status: "applied",
  }));
  entries.push({ runId: "24", sessionId: "a", time: 25, status: "applied" });
  const runs = recentRuns(entries);
  assert.equal(runs.length, 20);
  assert.equal(runs[0].entries.length, 2);
  assert.equal(runs.at(-1).id, "5");
  entries.forEach((entry, i) => {
    entry.id = "entry-" + i;
  });
  entries.unshift({ id: "uncertain", runId: "1", status: "pending" });
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "vb-undo-archive-"),
  );
  t.after(async () => {
    assert(
      path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep),
    );
    await fs.rm(directory, { recursive: true, force: true });
  });
  const archived = await archiveJournal({
    journal: entries,
    directory,
    keep: 1,
    persist: async () => {},
    guard: () => {},
  });
  assert.equal(archived.count, 4);
  assert.equal(entries.filter((e) => e.runId === "1").length, 2);
  assert.equal(entries.filter((e) => e.runId === "24").length, 2);
  assert.equal(
    JSON.parse(await fs.readFile(archived.file, "utf8")).entries.length,
    4,
  );
});
