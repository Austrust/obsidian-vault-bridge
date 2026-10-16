const { test } = require("node:test");
const assert = require("node:assert/strict");
const { NoteEngine } = require("../src/domain/note-engine");
const { lineDiff, diffContext } = require("../src/domain/diff");
test("line diff reconstructs both exact versions including terminal newline changes", () => {
  for (const [a, b] of [
    ["", "x\n"],
    ["a\nb\n", "a\nc\n"],
    ["x", "x\n"],
    ["a\n\nb", "a\nq\nb"],
    ["\n", ""],
    ["same", "same"],
  ]) {
    const rows = lineDiff(a, b);
    assert.equal(
      rows
        .filter((r) => r.kind !== "add")
        .map((r) => r.text)
        .join(""),
      a,
    );
    assert.equal(
      rows
        .filter((r) => r.kind !== "remove")
        .map((r) => r.text)
        .join(""),
      b,
    );
  }
});
test("large diffs use bounded fallback and collapse unchanged context", () => {
  const a = "a\n".repeat(1100),
    b = "b\n".repeat(1100);
  assert.equal(lineDiff(a, b).length, 2200);
  const base = Array.from({ length: 30 }, (_, i) => i + "\n");
  const rows = lineDiff(
    base.join(""),
    base.map((t, i) => (i === 15 ? "changed\n" : t)).join(""),
  );
  assert(diffContext(rows).filter((r) => r.kind === "skip").length === 2);
});
function setup() {
  const notes = new Map(),
    journal = [],
    saved = [];
  const engine = new NoteEngine(
    {
      read: async (p) => notes.get(p),
      create: async (p, t, g) => {
        g();
        assert(
          saved.at(-1).some((e) => e.path === p && e.status === "pending"),
        );
        if (notes.has(p)) throw Error("exists");
        notes.set(p, t);
      },
      removeCreated: async (p, expected, g) => {
        g();
        if (notes.get(p) !== expected) throw Error("conflict");
        notes.delete(p);
      },
    },
    journal,
    async () => saved.push(JSON.parse(JSON.stringify(journal))),
  );
  engine.start("run");
  return { engine, notes, journal, saved };
}
test("new notes are recorded before writing and can be undone after stopping", async () => {
  const { engine, notes, journal } = setup();
  const r = await engine.create("new.md", "text", "run");
  assert.equal(r.changeId, journal[0].id);
  assert.equal(journal[0].kind, "create");
  assert.equal(journal[0].status, "applied");
  await assert.rejects(engine.undo(r.changeId), /停止/);
  engine.stop();
  await engine.undo(r.changeId);
  assert(!notes.has("new.md"));
  assert.equal(journal[0].status, "undone");
});
test("new-note rollback refuses subsequent user edits and failed creation", async () => {
  const { engine, notes, journal } = setup();
  const r = await engine.create("new.md", "text", "run");
  notes.set("new.md", "user content");
  await assert.rejects(engine.create("new.md", "overwrite", "run"), /exists/);
  engine.stop();
  await assert.rejects(engine.undo(r.changeId), /后续修改/);
  await assert.rejects(engine.undo(journal[1].id), /没有可撤销/);
  assert.equal(notes.get("new.md"), "user content");
});
test("snapshot persistence failure prevents new note creation", async () => {
  const { engine, notes } = setup();
  engine.changed = async () => {
    throw Error("disk full");
  };
  await assert.rejects(engine.create("new.md", "text", "run"), /disk full/);
  assert(!notes.has("new.md"));
});
