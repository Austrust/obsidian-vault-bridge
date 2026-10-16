const test = require("node:test");
const assert = require("node:assert/strict");
const { runtimeConfig } = require("../src/backend/opencode-runtime");
const { WorkspaceStore } = require("../src/domain/workspace-store");
const { SessionComposer } = require("../src/domain/session-composer");

test("saved credentials retain custom provider endpoint and model without injecting an empty key", () => {
  const settings = {
    provider: "custom",
    model: "my-model",
    baseURL: "https://example.test/v1",
  };
  const provider = runtimeConfig(settings, "").provider.custom;
  assert.equal(provider.options.baseURL, settings.baseURL);
  assert(!Object.hasOwn(provider.options, "apiKey"));
  assert.equal(provider.models["my-model"].name, "my-model");
  assert.equal(
    runtimeConfig(settings, "test-key").provider.custom.options.apiKey,
    "test-key",
  );
  assert.throws(
    () => runtimeConfig({ ...settings, baseURL: "file:///unsafe" }, ""),
    /http/,
  );
});

test("new conversations isolate draft, notes, selection and Skills, with switching and restart restoration", () => {
  const store = new WorkspaceStore({ sessionId: "a", draft: "legacy draft" });
  const composer = new SessionComposer(store.state);
  assert.equal(composer.value.draft, "legacy draft");
  const a = {
    draft: "draft A",
    mentions: ["a.md"],
    selection: { path: "a.md", text: "excerpt" },
    skills: ["skill/SKILL.md"],
  };
  assert.deepEqual(composer.switch("b", "new", a), {
    draft: "",
    mentions: [],
    selection: null,
    skills: [],
  });
  const b = {
    draft: "draft B",
    mentions: ["b.md"],
    selection: null,
    skills: [],
  };
  assert.deepEqual(composer.switch("a", "restore", b), a);
  store.state.sessionId = "a";
  const restarted = new SessionComposer(
    new WorkspaceStore(store.snapshot()).state,
  );
  assert.deepEqual(restarted.value, a);
  assert.deepEqual(restarted.switch("fork", "fork", a), a);
  restarted.value.mentions.push("fork-only.md");
  assert.deepEqual(restarted.switch("a", "restore", restarted.value).mentions, [
    "a.md",
  ]);
});

test("first session adopts the unsent composer while explicit new starts empty", () => {
  const store = new WorkspaceStore();
  const composer = new SessionComposer(store.state);
  const context = {
    draft: "",
    mentions: ["selected.md"],
    selection: null,
    skills: [],
  };
  assert.deepEqual(composer.switch("first", "initial", context).mentions, [
    "selected.md",
  ]);
  assert.deepEqual(composer.switch("second", "new", context).mentions, []);
});

const { tokenAt, replaceToken } = require("../src/ui/composer-picker");
const { permissionPreset, inferPreset } = require("../src/domain/permissions");
const { ArtifactService } = require("../src/domain/artifact-service");
test("mention replacement follows the caret and preserves the suffix, slash suggestions only at command start", () => {
  const text = "前文 @研究 后文";
  const token = tokenAt(text, 6);
  assert.equal(token.query, "研究");
  assert.equal(replaceToken(text, token, ""), "前文  后文");
  assert.equal(tokenAt("普通 /路径", 6), null);
  assert.equal(tokenAt("/his", 4).query, "his");
});
test("permission presets reflect effective values and manual overrides", () => {
  assert.equal(inferPreset({}), "standard");
  for (const mode of ["readonly", "review", "standard"])
    assert.equal(inferPreset(permissionPreset(mode)), mode);
  assert.equal(inferPreset({ read_note: "deny" }), "custom");
});
test("artifact save is idempotent across reload and concurrent clicks and never overwrites edits", async () => {
  const files = new Map();
  let creates = 0;
  const state = {
    sessionId: "s",
    settings: { artifactFolder: "Cards" },
    artifacts: [],
  };
  const options = {
    state,
    adapter: {
      readOptional: async (p) => files.get(p),
      create: async (p, text) => {
        creates++;
        files.set(p, text);
      },
    },
    persist: async () => {},
    refresh: () => {},
    guard: () => {},
    runId: () => "run-a",
  };
  const service = new ArtifactService(options);
  await service.publish({ title: "Diagram", code: 'dv.paragraph("ok")' });
  const a = state.artifacts[0];
  assert.equal(a.runId, "run-a");
  const [first, second] = await Promise.all([service.save(a), service.save(a)]);
  assert.equal(first, second);
  assert.equal(creates, 1);
  files.set(first, "manual edit");
  assert.equal(await new ArtifactService(options).save(a), first);
  assert.equal(files.get(first), "manual edit");
  assert.equal(creates, 1);
  delete a.savedPath;
  await assert.rejects(service.save(a), /已有不同内容/);
  assert.equal(files.get(first), "manual edit");
});

const {
  connectionErrors,
  modelCatalog,
} = require("../src/domain/connection-settings");
test("connection validation and model catalogue never confuse registry metadata with remote verification", () => {
  const valid = {
    executable: "opencode",
    provider: "custom",
    model: "org/model-v1",
    baseURL: "https://example.test/v1",
  };
  assert.deepEqual(connectionErrors(valid), {});
  assert(
    connectionErrors({
      ...valid,
      baseURL: "https://name:password@example.test",
    }).baseURL,
  );
  assert(connectionErrors({ ...valid, model: "bad model" }).model);
  assert(connectionErrors({ ...valid, provider: "invalid provider" }).provider);
  const data = {
    all: [
      {
        id: "custom",
        models: {
          "org/model-v1": {
            name: "Model",
            capabilities: { reasoning: true },
            limit: { context: 64000 },
          },
        },
      },
    ],
    connected: ["custom"],
  };
  const models = modelCatalog(data, "custom");
  assert.equal(models.length, 1);
  assert(models[0].configured);
  assert(models[0].reasoning);
  assert(!Object.hasOwn(models[0], "verified"));
  assert.deepEqual(modelCatalog(data, "missing"), []);
});

const { turnSummaries, relativeTime } = require("../src/presentation-turns");
test("review summary follows the final answer, falls back before an answer, and excludes other session changes", () => {
  const messages = [
    { id: "u", role: "user", kind: "user", runId: "r" },
    { id: "progress", role: "assistant", kind: "progress", runId: "r" },
    { id: "answer", role: "assistant", kind: "answer", runId: "r" },
  ];
  const journal = [
    {
      id: "e",
      runId: "r",
      sessionId: "s",
      path: "a.md",
      before: "old\n",
      after: "new\nextra\n",
      status: "applied",
    },
    {
      id: "foreign",
      runId: "r",
      sessionId: "other",
      path: "b.md",
      before: "",
      after: "wrong\n",
      status: "applied",
    },
  ];
  const summary = turnSummaries(messages, journal, "s");
  assert.equal(summary.size, 1);
  assert(!summary.has("u"));
  assert.deepEqual(summary.get("answer"), {
    runId: "r",
    files: 1,
    operations: 1,
    plus: 2,
    minus: 1,
    undone: false,
  });
  assert(turnSummaries(messages.slice(0, 2), journal, "s").has("u"));
  assert.equal(turnSummaries(messages, journal, "fork").size, 0);
  assert.equal(relativeTime(1000, 61000), "1 分钟前");
});
