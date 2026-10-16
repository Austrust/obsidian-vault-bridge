// Opt-in smoke test. Sends only synthetic text; all note operations stay in memory.
// Keys come from the local OpenCode credential store, never command-line arguments.
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { OpenCodeRuntime } = require("../src/backend/opencode-runtime");
const { runtimeEnvironment } = require("../src/backend/runtime-environment");
const { ConversationService } = require("../src/backend/conversation-service");
const { NoteEngine } = require("../src/domain/note-engine");
const { NoteTools } = require("../src/backend/note-tools");
const { PermissionGate } = require("../src/domain/permissions");
const { WorkspaceStore } = require("../src/domain/workspace-store");
(async () => {
  if (process.env.VAULTBRIDGE_LIVE_TEST !== "1")
    throw Error(
      "Set VAULTBRIDGE_LIVE_TEST=1 to allow synthetic provider requests",
    );
  const authPath = path.join(
    runtimeEnvironment().XDG_DATA_HOME,
    "opencode",
    "auth.json",
  );
  const auth = JSON.parse(await fs.readFile(authPath, "utf8"));
  const key = auth.deepseek?.key;
  if (!key) throw Error("A locally saved DeepSeek API credential is required");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vb-live-sample-"));
  const settings = {
    executable: process.env.OPENCODE_BIN,
    provider: "deepseek",
    model: "deepseek-flash",
    baseURL: "https://api.deepseek.com/v1",
  };
  if (!settings.executable) throw Error("OPENCODE_BIN is required");
  const state = new WorkspaceStore({}, settings).state;
  const notes = new Map([
    ["acceptance-sample.md", "The test marker is VAULTBRIDGE_SAMPLE_OK."],
  ]);
  const engine = new NoteEngine(
    {
      read: async (p) => {
        assert(notes.has(p));
        return notes.get(p);
      },
    },
    state.journal,
    async () => {},
  );
  const calls = [];
  const gate = new PermissionGate(() => ({
    read_note: "allow",
    active_note: "deny",
    search_notes: "deny",
    patch_note: "deny",
    create_note: "deny",
    delete_note: "deny",
    move_note: "deny",
    rename_note: "deny",
    publish_visualization: "deny",
  }));
  const tools = new NoteTools({
    engine,
    permissions: gate,
    files: () => [],
    publish: async () => {
      throw Error("No publication in smoke tests");
    },
  });
  const runtime = new OpenCodeRuntime({
    directory: root,
    settings: () => settings,
    apiKey: () => key,
    env: {
      ...process.env,
      XDG_DATA_HOME: path.join(root, "data"),
      XDG_CONFIG_HOME: path.join(root, "config"),
      XDG_CACHE_HOME: path.join(root, "cache"),
      XDG_STATE_HOME: path.join(root, "state"),
    },
    execute: async (name, args, run) => {
      calls.push(name);
      return tools.call(name, args, run);
    },
  });
  const service = new ConversationService({
    runtime,
    engine,
    state,
    persist: async () => {},
    refresh() {},
    context: async () => ({ notes: [] }),
    model: () => ({ providerID: settings.provider, modelID: settings.model }),
    beforeRun: () => engine.prepareRecovery(),
    afterRun: async () => {},
    pollMs: 250,
    timeoutMs: 120000,
  });
  const results = [];
  try {
    await service.send(
      "这是独立验收。请仅调用 read_note 读取 acceptance-sample.md，再原样回复其中的测试标记，不修改任何文件。请简短回答。",
    );
    assert(calls.includes("read_note"));
    assert(
      state.transcript.some(
        (m) =>
          m.role === "assistant" && m.text?.includes("VAULTBRIDGE_SAMPLE_OK"),
      ),
    );
    assert.equal(state.journal.length, 0);
    results.push({
      case: "DeepSeek response and bridged read_note",
      pass: true,
    });
    await runtime.disconnect();
    // Invalid authentication uses a synthetic credential and no note context.
    const response = await fetch(settings.baseURL + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer vaultbridge-deliberately-invalid",
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [{ role: "user", content: "synthetic auth check" }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(30000),
    });
    assert([401, 403].includes(response.status));
    results.push({
      case: "invalid credential rejected",
      status: response.status,
      pass: true,
    });
    console.log(
      JSON.stringify({
        provider: settings.provider,
        model: settings.model,
        results,
      }),
    );
  } finally {
    await runtime.disconnect();
  }
})().catch((error) => {
  // Never print remote response bodies, captured prompts, credential values or stacks.
  console.error(
    JSON.stringify({
      pass: false,
      category: error.code || error.name || "ProviderFailure",
    }),
  );
  process.exitCode = 1;
});
