const test = require("node:test");
const assert = require("node:assert/strict");
const { runtimeConfig } = require("../src/backend/opencode-runtime");
const {
  modelKey,
  validateModelLimit,
  contextUsage,
  usageLabel,
} = require("../src/domain/model-context");
const { ConversationService } = require("../src/backend/conversation-service");
const { WorkspaceStore } = require("../src/domain/workspace-store");
const { OpenCodeSessions } = require("../src/backend/opencode-sessions");
const settings = {
  executable: "opencode",
  provider: "demo",
  model: "model-a",
  baseURL: "http://localhost/v1",
};

test("model limits inherit the catalog unless this endpoint/model has explicit overrides", () => {
  assert.equal(
    runtimeConfig(settings, "").provider.demo.models["model-a"].limit,
    undefined,
  );
  const configured = {
    ...settings,
    modelLimits: { [modelKey(settings)]: { context: 128000, output: 16000 } },
  };
  assert.deepEqual(
    runtimeConfig(configured, "").provider.demo.models["model-a"].limit,
    { context: 128000, output: 16000 },
  );
  assert.equal(
    runtimeConfig({ ...configured, model: "model-b" }, "").provider.demo.models[
      "model-b"
    ].limit,
    undefined,
  );
  assert.equal(
    runtimeConfig({ ...configured, baseURL: "http://other/v1" }, "").provider
      .demo.models["model-a"].limit,
    undefined,
  );
  for (const limit of [
    { context: -1 },
    { context: 0 },
    { output: 1.5 },
    { context: 100, output: 100 },
    { output: NaN },
  ])
    assert.throws(() => validateModelLimit(limit));
});

test("usage is the last completed request, includes cache once, and does not show summary input as post-compaction usage", () => {
  const first = {
    role: "assistant",
    completed: true,
    tokens: { input: 10000, output: 10 },
  };
  const last = {
    role: "assistant",
    completed: true,
    modelID: "model-a",
    tokens: {
      input: 100,
      output: 50,
      reasoning: 20,
      cache: { read: 200, write: 30 },
    },
  };
  const result = contextUsage([first, last], 1000, "model-a");
  assert.equal(result.used, 380);
  assert.match(usageLabel(result), /38%/);
  assert.equal(
    contextUsage([{ ...last, tokens: { ...last.tokens, total: 450 } }], 1000)
      .used,
    450,
  );
  assert.match(usageLabel(contextUsage([last], null)), /未知上限/);
  const summary = { ...first, summary: true };
  assert.equal(contextUsage([last, summary], 1000).used, null);
  assert.equal(contextUsage([last, summary], 1000).compacted, true);
  assert.equal(contextUsage([summary, last], 1000).used, 380);
  assert.equal(
    contextUsage([last, { ...first, completed: false }], 1000).used,
    380,
  );
});

function fixture(compact) {
  const state = new WorkspaceStore({ sessionId: "session-a" }).state;
  let rows = [
    {
      id: "u",
      role: "user",
      view: { id: "u", role: "user", text: "original" },
    },
  ];
  let ended = 0;
  const harness = {
    connect: async () => {},
    messages: async () => rows,
    modelContext: async () => 128000,
    compact:
      compact ||
      (async () => {
        rows = [
          ...rows,
          {
            id: "summary",
            role: "assistant",
            completed: true,
            summary: true,
            view: { id: "summary", role: "assistant", text: "summary" },
          },
        ];
        return true;
      }),
    endRun: async () => {
      ended++;
    },
    abort: async () => {},
  };
  const service = new ConversationService({
    harness,
    state,
    engine: { stop() {} },
    model: () => ({ providerID: "demo", modelID: "model-a" }),
    persist: async () => {},
    refresh() {},
    timeoutMs: 30,
  });
  return { service, state, ended: () => ended, harness };
}

test("manual compaction reserves the session, retains history and updates usage", async () => {
  const { service, state, ended } = fixture();
  const work = service.compact();
  assert(state.preparing && state.compacting);
  assert.throws(() => service.compact(), /停止/);
  await assert.rejects(service.send("parallel"), /停止/);
  await work;
  assert.equal(state.sessionId, "session-a");
  assert.equal(state.transcript[0].text, "original");
  assert(state.contextUsage.compacted);
  assert.equal(state.contextUsage.limit, 128000);
  assert.equal(state.status, "上下文已压缩");
  assert(!state.preparing && !state.compacting);
  assert.equal(ended(), 1);
});

test("manual compaction failure and timeout release the backend and lock", async () => {
  for (const compact of [
    async () => {
      throw Error("provider rejected");
    },
    async () => true,
    (_id, _model, signal) =>
      new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(Error("aborted"))),
      ),
  ]) {
    const { service, state, ended } = fixture(compact);
    await assert.rejects(service.compact());
    assert.equal(state.status, "压缩失败");
    assert(!state.preparing && !state.compacting);
    assert.equal(ended(), 1);
  }
});

test("stop cancels manual compression without allowing a new turn until cleanup", async () => {
  let entered;
  const ready = new Promise((r) => {
    entered = r;
  });
  const { service, state, ended } = fixture(
    (_id, _model, signal) =>
      new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(Error("aborted")));
        entered();
      }),
  );
  const work = service.compact();
  await ready;
  await service.stop();
  await work;
  assert.equal(state.status, "压缩已停止");
  assert(!state.preparing);
  assert.equal(ended(), 1);
});

test("compression API uses explicit model, auto false and caller cancellation/timeout", async () => {
  let captured;
  const harness = new OpenCodeSessions({
    request: async (...args) => {
      captured = args;
      return true;
    },
  });
  const controller = new AbortController();
  await harness.compact(
    "s",
    { providerID: "p", modelID: "m" },
    controller.signal,
    60000,
  );
  assert.equal(captured[0], "/session/s/summarize");
  assert.deepEqual(captured[2], { providerID: "p", modelID: "m", auto: false });
  assert.equal(captured[3], controller.signal);
  assert.equal(captured[4], 60000);
});
