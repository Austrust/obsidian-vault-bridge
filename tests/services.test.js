const { test } = require("node:test");
const assert = require("node:assert/strict");
const { WorkspaceStore } = require("../src/domain/workspace-store");
const {
  ConversationService,
  buildPrompt,
} = require("../src/backend/conversation-service");
const { conversationItems, messageView } = require("../src/presentation");
test("legacy store preserves history/settings and snapshots exclude runtime/API credentials", async () => {
  const writes = [];
  const store = new WorkspaceStore(
    {
      settings: { model: "custom" },
      journal: [{ id: "edit" }],
      sessionId: "s",
      sessionTitles: { s: "旧会话" },
      transcript: [{ id: "old" }],
      apiKey: "must-not-persist",
    },
    { model: "default" },
    async (x) => writes.push(x),
  );
  store.state.apiKey = "secret";
  const saving = store.save();
  store.state.settings.model = "changed";
  await saving;
  assert.equal(writes[0].settings.model, "custom");
  assert.equal(writes[0].schemaVersion, 2);
  assert.equal(store.state.sessionTitle, "旧会话");
  assert(!("apiKey" in writes[0]));
  assert(!("running" in writes[0]));
  assert.equal(writes[0].journal[0].id, "edit");
});
test("group reasoning and tool steps once per user turn; final answer remains separate", () => {
  const user = { id: "u", role: "user", text: "问题", kind: "user" };
  const tool = messageView({
    info: {
      id: "t",
      role: "assistant",
      finish: "tool-calls",
      time: { completed: 2 },
    },
    parts: [
      { type: "reasoning", text: "先读笔记" },
      {
        id: "tool1",
        type: "tool",
        tool: "note_agent_read_note",
        state: { status: "completed", input: { path: "研究.md" } },
      },
    ],
  });
  const answer = {
    id: "a",
    role: "assistant",
    kind: "answer",
    text: "结论",
    reasoning: "整理结果",
    done: true,
  };
  const items = conversationItems([user, tool, answer]);
  assert.equal(items.length, 3);
  assert.equal(items[1].kind, "work");
  assert.equal(items[1].toolCalls[0].label, "读取笔记");
  assert.equal(items[1].toolCalls[0].path, "研究.md");
  assert.equal(items[1].reasoning, "先读笔记\n\n整理结果");
  assert.equal(items[2].reasoning, "");
  assert.equal(items[2].text, "结论");
});
test("legacy cached tool strings remain visible after migration", () => {
  const items = conversationItems([
    {
      id: "t",
      role: "assistant",
      kind: "progress",
      text: "",
      tools: ["已完成：read_note"],
      done: true,
    },
  ]);
  assert.equal(items[0].toolCalls.length, 1);
  assert.equal(items[0].toolCalls[0].status, "completed");
});
function setup(runtime) {
  const store = new WorkspaceStore({}, {});
  const engine = {
    runID: null,
    start(id) {
      this.runID = id;
    },
    stop() {
      this.runID = null;
    },
  };
  const service = new ConversationService({
    runtime,
    engine,
    state: store.state,
    persist: () => store.save(),
    refresh: () => {},
    context: async () => ({ notes: [] }),
    model: () => ({ providerID: "demo", modelID: "demo" }),
    pollMs: 1,
    timeoutMs: 100,
  });
  return { service, state: store.state, engine };
}
test("cancel during connection prevents prompt and restores idle state", async () => {
  let release;
  const requests = [];
  const runtime = {
    client: null,
    connect: () => new Promise((r) => (release = r)),
    request: async (...a) => requests.push(a),
  };
  const { service, state, engine } = setup(runtime);
  const run = service.send("问题");
  assert(state.preparing);
  assert.equal(state.pendingMessage.text, "问题");
  assert(state.turnStartedAt > 0);
  await service.stop();
  release();
  await run;
  assert.equal(requests.length, 0);
  assert(!state.running && !state.preparing);
  assert.equal(engine.runID, null);
  assert.equal(state.pendingMessage, null);
});
test("model failures release run lock and retain actionable error", async () => {
  const runtime = {
    connect: async () => {},
    request: async (route) => {
      if (route === "/session") return { id: "s" };
      if (route.endsWith("/message")) return [];
      if (route.endsWith("/prompt_async")) throw Error("API unavailable");
      return {};
    },
  };
  const { service, state, engine } = setup(runtime);
  await assert.rejects(service.send("问题"), /API unavailable/);
  assert.equal(state.error, "API unavailable");
  assert(!state.running && !state.preparing);
  assert.equal(engine.runID, null);
});
test("successful turn sets title, maps messages and blocks parallel sends", async () => {
  let sent = false;
  const runtime = {
    connect: async () => {},
    request: async (route, method, body) => {
      if (route === "/session") return { id: "s" };
      if (route.endsWith("/prompt_async")) {
        sent = true;
        return null;
      }
      if (route.endsWith("/message"))
        return sent
          ? [
              {
                info: { id: "u", role: "user", time: {} },
                parts: [{ type: "text", text: "expanded" }],
              },
              {
                info: {
                  id: "a",
                  role: "assistant",
                  time: { completed: 1 },
                  finish: "stop",
                },
                parts: [{ type: "text", text: "完成" }],
              },
            ]
          : [];
      return {};
    },
  };
  const { service, state } = setup(runtime);
  const run = service.send("整理笔记");
  assert.equal(state.pendingMessage.text, "整理笔记");
  const runId = state.pendingMessage.runId;
  await assert.rejects(service.send("重复"), /停止/);
  await run;
  assert.equal(state.sessionTitle, "整理笔记");
  assert.equal(state.transcript[0].text, "整理笔记");
  assert.equal(state.transcript[1].kind, "answer");
  assert.equal(state.status, "已完成");
  assert.equal(state.pendingMessage, null);
  assert.equal(state.transcript.length, 2);
  assert.equal(state.transcript[0].runId, runId);
  assert.equal(state.transcript[1].runId, runId);
  assert.equal(state.messageRuns.u, runId);
});
test("prompt building keeps bounded context and visualize command", () => {
  assert(
    buildPrompt("/visualize test", { notes: [] }).includes(
      "publish_visualization",
    ),
  );
  assert.throws(
    () => buildPrompt("x", { notes: ["x".repeat(180001)] }),
    /过大/,
  );
});
test("session switch reserves the workspace against concurrent sends", async () => {
  let release;
  const runtime = { request: () => new Promise((r) => (release = r)) };
  const { service, state } = setup(runtime);
  const switching = service.newSession();
  assert(state.preparing);
  await assert.rejects(service.send("race"), /停止/);
  release({ id: "new" });
  await switching;
  assert.equal(state.sessionId, "new");
  assert(!state.preparing);
});
test("timeout is reported instead of being mistaken for a user cancellation", async () => {
  const runtime = {
    connect: async () => {},
    request: async (route) =>
      route === "/session" ? { id: "s" } : route.endsWith("/message") ? [] : {},
  };
  const { service, state, engine } = setup(runtime);
  service.timeoutMs = 0;
  await assert.rejects(service.send("timeout"), /超时/);
  assert.match(state.error, /超时/);
  assert.equal(engine.runID, null);
  assert(!state.running && !state.preparing);
});
test("failed pre-run Git checkpoint prevents agent writes and model submission", async () => {
  let prompt = false;
  const runtime = {
    connect: async () => {},
    request: async (route) => {
      if (route === "/session") return { id: "s" };
      prompt = true;
      return [];
    },
  };
  const { service, state, engine } = setup(runtime);
  service.beforeRun = async () => {
    throw Error("Git unavailable");
  };
  await assert.rejects(service.send("edit"), /Git unavailable/);
  assert(!prompt);
  assert.equal(engine.runID, null);
  assert(!state.preparing);
});
test("pre and post Git checkpoints wrap successful agent execution", async () => {
  let sent = false;
  const events = [];
  const runtime = {
    connect: async () => {},
    request: async (route) => {
      if (route === "/session") return { id: "s" };
      if (route.endsWith("/prompt_async")) {
        events.push("prompt");
        sent = true;
      }
      if (route.endsWith("/message"))
        return sent
          ? [
              {
                info: {
                  id: "a",
                  role: "assistant",
                  finish: "stop",
                  time: { completed: 1 },
                },
                parts: [],
              },
            ]
          : [];
      return {};
    },
  };
  const { service } = setup(runtime);
  service.beforeRun = async () => events.push("before");
  service.afterRun = async () => events.push("after");
  await service.send("edit");
  assert.deepEqual(events, ["before", "prompt", "after"]);
});

test("cleanup and recovery-persistence failures reject delivery and pause remaining queued tasks", async () => {
  const { TurnQueue } = require("../src/domain/turn-queue");
  for (const failure of ["endRun", "afterRun"]) {
    let sent = 0;
    const { service, state } = setup({});
    state.sessionId = "s";
    service.harness = {
      connect: async () => {},
      beginRun: async () => {},
      endRun: async () => {
        if (failure === "endRun") throw Error("cleanup failed");
      },
      submit: async () => {
        sent++;
      },
      setTitle: async () => {},
      isIdle: async () => true,
      messages: async () =>
        sent
          ? [
              {
                id: "answer-" + sent,
                role: "assistant",
                completed: true,
                finish: "stop",
                view: { role: "assistant", text: "done" },
              },
            ]
          : [],
    };
    service.afterRun = async () => {
      if (failure === "afterRun") throw Error("disk full");
    };
    state.queue = ["one", "two"].map((text) => ({
      id: text,
      text,
      sessionId: "s",
    }));
    const queue = new TurnQueue({
      state,
      service,
      persist: async () => {},
      refresh: () => {},
    });
    await queue.resume();
    assert.equal(sent, 1);
    assert.equal(queue.paused, true);
    assert.equal(state.queue.length, 2);
    assert.equal(state.running, false);
    assert.equal(state.preparing, false);
    assert.match(state.error, /cleanup failed|disk full/);
    await queue.resume();
    assert.equal(
      sent,
      1,
      "resume must not repeat a potentially partially applied task",
    );
    assert.equal(queue.paused, true);
  }
});
