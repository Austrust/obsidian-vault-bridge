// Local scripted provider only; no user notes, credentials or paid requests.
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { OpenCodeRuntime } = require("../src/backend/opencode-runtime");
const { ConversationService } = require("../src/backend/conversation-service");
const { WorkspaceStore } = require("../src/domain/workspace-store");
const { modelKey } = require("../src/domain/model-context");
(async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "vb-context-integration-"),
  );
  let requests = 0;
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests++;
    const base = {
      id: "context-" + requests,
      object: "chat.completion.chunk",
      created: 1,
      model: body.model,
    };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = (data) =>
      res.write("data: " + JSON.stringify({ ...base, ...data }) + "\n\n");
    send({
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            content: "Summary: retain the user's task and continue when asked.",
          },
          finish_reason: null,
        },
      ],
    });
    send({
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: {
        prompt_tokens: 1200,
        completion_tokens: 300,
        total_tokens: 1500,
      },
    });
    res.end("data: [DONE]\n\n");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const settings = {
    executable: process.env.OPENCODE_BIN,
    provider: "context-test",
    model: "model-a",
    baseURL: `http://127.0.0.1:${server.address().port}/v1`,
  };
  settings.modelLimits = {
    [modelKey(settings)]: { context: 256000, output: 16000 },
  };
  const runtime = new OpenCodeRuntime({
    directory: root,
    settings: () => settings,
    apiKey: () => "fixture",
    execute: () => {
      throw Error("Compression must not execute note tools");
    },
    env: {
      ...process.env,
      XDG_DATA_HOME: path.join(root, "data"),
      XDG_CONFIG_HOME: path.join(root, "config"),
      XDG_CACHE_HOME: path.join(root, "cache"),
      XDG_STATE_HOME: path.join(root, "state"),
    },
  });
  const store = new WorkspaceStore();
  const service = new ConversationService({
    runtime,
    state: store.state,
    engine: { start() {}, stop() {} },
    persist: async () => {},
    refresh() {},
    context: async () => ({}),
    model: () => ({ providerID: settings.provider, modelID: settings.model }),
    pollMs: 100,
    timeoutMs: 60000,
  });
  try {
    await service.send("Remember this synthetic task and respond.");
    assert.equal(store.state.contextUsage.limit, 256000);
    assert.equal(store.state.contextUsage.used, 1500);
    const session = store.state.sessionId;
    const original = await service.messages();
    await service.compact();
    assert.equal(store.state.status, "上下文已压缩");
    assert.equal(store.state.sessionId, session);
    assert(store.state.contextUsage.compacted);
    assert.equal(store.state.contextUsage.used, null);
    const after = await service.messages();
    assert(original.every((m) => after.some((a) => a.id === m.id)));
    assert(after.some((m) => m.summary));
    await service.send("Continue after compression.");
    assert.equal(store.state.contextUsage.used, 1500);
    assert.equal(store.state.contextUsage.compacted, undefined);
    settings.model = "model-b";
    settings.modelLimits[modelKey(settings)] = { context: 96000, output: 6000 };
    await runtime.disconnect();
    await service.send("Use a different model limit.");
    assert.equal(store.state.contextUsage.limit, 96000);
    console.log(
      "PASS real runtime: model-specific limits, token usage, manual compaction, retained history, restart and model switch",
      requests,
    );
  } finally {
    await runtime.disconnect();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
