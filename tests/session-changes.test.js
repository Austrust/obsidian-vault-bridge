const test = require("node:test");
const assert = require("node:assert/strict");
const { sessionChanges } = require("../src/domain/session-changes");
const { WorkspaceStore } = require("../src/domain/workspace-store");
const { ConversationService } = require("../src/backend/conversation-service");
const { NoteEngine, hash } = require("../src/domain/note-engine");
test("session changes exclude unrelated and legacy records without truncating", () => {
  const entries = Array.from({ length: 8 }, (_, i) => ({
    id: i,
    sessionId: "a",
    status: "applied",
  }));
  entries.push({ id: 8, sessionId: "b" }, { id: 9 });
  assert.equal(sessionChanges(entries, "a").length, 8);
  assert.equal(sessionChanges(entries, "a")[0].id, 7);
  assert.deepEqual(sessionChanges(entries, null), []);
});
test("rename and reversible archive persist across reload and block during a run", async () => {
  let saved;
  const store = new WorkspaceStore({ sessionId: "a" }, {}, async (data) => {
    saved = data;
  });
  const calls = [];
  const svc = new ConversationService({
    state: store.state,
    harness: { setTitle: async (...x) => calls.push(x) },
    persist: () => store.save(),
    refresh: () => {},
  });
  await svc.renameSession("a", " New name ");
  await svc.archiveSession("a", true);
  const restored = new WorkspaceStore(saved);
  assert.equal(restored.state.sessionTitle, "New name");
  assert.equal(restored.state.sessionMeta.a.archived, true);
  await svc.archiveSession("a", false);
  assert.equal(saved.sessionMeta.a.archived, false);
  assert.deepEqual(calls, [["a", "New name"]]);
  store.state.running = true;
  await assert.rejects(svc.renameSession("a", "oops"), /停止/);
});
test("mutations record owning session including move and delete", async () => {
  const journal = [];
  const storage = {
    read: async () => "old",
    compareWrite: async () => {},
    relocate: async () => {},
    removeCreated: async () => {},
  };
  const engine = new NoteEngine(storage, journal);
  engine.start("run", "session");
  await engine.patch("a.md", hash("old"), "old", "new", "run");
  await engine.relocate("a.md", "b.md", hash("old"), "run");
  await engine.deleteNote("b.md", hash("old"), "run");
  assert.deepEqual(
    journal.map((e) => e.sessionId),
    ["session", "session", "session"],
  );
  assert.deepEqual(
    journal.map((e) => e.kind),
    ["edit", "move", "delete"],
  );
  engine.stop();
  await assert.rejects(engine.undo(journal[1].id), /安全检查/);
});
