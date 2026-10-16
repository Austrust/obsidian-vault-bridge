const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { NoteEngine } = require("../src/domain/note-engine");
const { OpenCodeRuntime } = require("../src/backend/opencode-runtime");
const { ConversationService } = require("../src/backend/conversation-service");
const { NoteTools } = require("../src/backend/note-tools");
const { PermissionGate } = require("../src/domain/permissions");
const { WorkspaceStore } = require("../src/domain/workspace-store");
(async () => {
  const root = await fs.mkdtemp(
    path.join(require("node:os").tmpdir(), "vaultbridge-integration-"),
  );
  const notes = new Map([["测试.md", "目标：旧内容"]]);
  const artifacts = [],
    journal = [],
    calls = [];
  const engine = new NoteEngine(
    {
      read: async (p) => notes.get(p),
      readOptional: async (p) => notes.get(p),
      removeCreated: async (p, expected, guard) => {
        guard();
        assert.equal(notes.get(p), expected);
        notes.delete(p);
      },
      compareWrite: async (p, b, a, g) => {
        g();
        assert.equal(notes.get(p), b);
        notes.set(p, a);
      },
      create: async (p, t, g) => {
        g();
        assert(!notes.has(p));
        notes.set(p, t);
      },
    },
    journal,
  );
  const approvals = [];
  const gate = new PermissionGate(
    () => ({ patch_note: "ask", delete_note: "deny" }),
    (request, finish) => {
      approvals.push(request.name);
      queueMicrotask(() => finish(true));
    },
  );
  const noteTools = new NoteTools({
    engine,
    permissions: gate,
    files: () => [],
    publish: async (a) => {
      artifacts.push(a);
      return { artifactId: "test" };
    },
  });
  const execute = async (name, args, run) => {
    calls.push(name);
    return noteTools.call(name, args, run);
  };
  let modelStep = 0;
  let revision = "";
  const received = [];
  const provider = http.createServer(async (req, res) => {
    try {
      let b = "";
      for await (const c of req) b += c;
      const body = JSON.parse(b);
      received.push({
        port: req.socket.localPort,
        authorization: req.headers.authorization,
        model: body.model,
      });
      await fs.writeFile(
        path.join(root, "last-request.json"),
        JSON.stringify(body, null, 2),
      );
      const available = (body.tools || []).map((t) => t.function.name);
      let name, args;
      modelStep++;
      console.log("MODEL_STEP", modelStep, "TOOLS", available.join(","));
      if (modelStep === 1) {
        name = available.find((n) => n.endsWith("read_note"));
        args = { path: "测试.md" };
      } else if (modelStep === 2) {
        for (const m of body.messages) {
          if (m.role === "tool") {
            try {
              const c = JSON.parse(m.content);
              revision = c.revision || revision;
            } catch {
              const match = JSON.stringify(m.content).match(/[a-f0-9]{64}/);
              if (match) revision = match[0];
            }
          }
        }
        name = available.find((n) => n.endsWith("patch_note"));
        args = {
          path: "测试.md",
          revision,
          oldText: "旧内容",
          newText: "新内容",
        };
      } else if (modelStep === 3) {
        name = available.find((n) => n.endsWith("publish_visualization"));
        args = {
          title: "测试卡片",
          code: "dv.paragraph('完成');",
          sourcePath: "测试.md",
        };
      } else if (modelStep === 4) {
        name = available.find((n) => n.endsWith("delete_note"));
        args = { path: "测试.md", revision };
      } else if (modelStep === 5) {
        name = available.find((n) => n.endsWith("create_note"));
        args = { path: "新笔记.md", text: "# 已创建" };
      }
      const base = {
        id: "chatcmpl-" + modelStep,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: "demo-model",
      };
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const emit = (delta, finish_reason = null) =>
        res.write(
          "data: " +
            JSON.stringify({
              ...base,
              choices: [{ index: 0, delta, finish_reason }],
            }) +
            "\n\n",
        );
      if (name) {
        emit({
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "call_" + modelStep,
              type: "function",
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        });
        emit({}, "tool_calls");
      } else {
        emit({
          role: "assistant",
          reasoning_content: "已检查工具结果，准备汇总。",
        });
        emit({ role: "assistant", content: "已修改笔记并发布卡片。" });
        emit({}, "stop");
      }
      res.end("data: [DONE]\n\n");
    } catch (e) {
      console.error(e);
      res.writeHead(500);
      res.end(String(e));
    }
  });
  await new Promise((r) => provider.listen(0, "127.0.0.1", r));
  const providerURL = `http://127.0.0.1:${provider.address().port}/v1`;

  const settings = {
    executable: process.env.OPENCODE_BIN || "opencode",
    provider: "demo",
    model: "demo-model",
    baseURL: providerURL,
  };
  const runtime = new OpenCodeRuntime({
    directory: root,
    execute,
    settings: () => settings,
    apiKey: () => "local-test",
    env: {
      ...process.env,
      XDG_DATA_HOME: root + "/data",
      XDG_CACHE_HOME: root + "/cache",
      XDG_CONFIG_HOME: root + "/config",
      XDG_STATE_HOME: root + "/state",
    },
  });
  const alternateProvider = http.createServer(provider.listeners("request")[0]);
  const bridges = [];
  const begin = runtime.beginRun.bind(runtime);
  runtime.beginRun = async (id) => {
    await begin(id);
    const current = runtime.resources.bridge;
    if (bridges.length) {
      const previous = bridges.at(-1);
      assert.notEqual(current.token, previous.token);
      let response;
      try {
        response = await fetch(previous.url, {
          method: "POST",
          headers: {
            Authorization: "Bearer " + previous.token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 999,
            method: "tools/call",
            params: { name: "read_note", arguments: { path: "测试.md" } },
          }),
          signal: AbortSignal.timeout(1000),
        });
      } catch {} // A closed old socket is the expected case.
      assert(
        !response || response.status >= 400,
        "old run credential must not execute",
      );
    }
    bridges.push({ url: current.url, token: current.token });
  };
  const store = new WorkspaceStore({}, settings);
  store.state.journal = journal;
  engine.changed = () => store.save();
  const service = new ConversationService({
    runtime,
    engine,
    state: store.state,
    persist: () => store.save(),
    refresh: () => {},
    context: async () => ({ notes: [] }),
    model: () => ({ providerID: "demo", modelID: "demo-model" }),
    pollMs: 100,
    beforeRun: () => engine.prepareRecovery(),
    afterRun: async () => {
      if (engine.persistenceError) throw engine.persistenceError;
      await store.save();
    },
  });
  try {
    const [a, b] = await Promise.all([runtime.connect(), runtime.connect()]);
    assert.equal(a, b, "one shared connection");
    const catalogue = await a.request("/provider");
    assert(catalogue.all.find((p) => p.id === "demo").models["demo-model"]);
    await service.send("编辑测试笔记并创建交互卡片");
    assert.equal(store.state.status, "已完成");
    assert.deepEqual(approvals, ["patch_note"]);
    assert(calls.includes("delete_note"));
    assert(notes.has("测试.md"));
    await assert.rejects(fs.stat(path.join(root, "history.git")), {
      code: "ENOENT",
    });
    assert(journal[0].before.includes("旧内容"));
    assert.equal(notes.get("测试.md"), "目标：新内容");
    assert.equal(notes.get("新笔记.md"), "# 已创建");
    assert.equal(artifacts.length, 1);
    assert.equal(journal.length, 2);
    assert(
      store.state.transcript.some((m) =>
        m.reasoning.includes("已检查工具结果"),
      ),
    );
    assert.equal(
      (await runtime.request("/session/" + store.state.sessionId)).title,
      "编辑测试笔记并创建交互卡片",
    );
    await service.restore(store.state.sessionId);
    assert(
      (await service.history()).some((s) => s.id === store.state.sessionId),
    );
    await engine.undoRun(journal[0].runId);
    assert.equal(notes.get("测试.md"), "目标：旧内容");
    assert(!notes.has("新笔记.md"));
    await service.send("第二轮仅回答");
    assert.equal(store.state.status, "已完成");
    const originalId = store.state.sessionId;
    const users = (await service.messages()).filter((m) => m.role === "user");
    assert(users.length >= 2);
    await service.forkAt(users[1].id);
    assert.notEqual(store.state.sessionId, originalId);
    assert.equal(
      (await service.messages()).filter((m) => m.role === "user").length,
      1,
    );
    assert.equal(
      (await service.messages(originalId)).filter((m) => m.role === "user")
        .length,
      2,
    );
    await service.stop();
    await runtime.disconnect();
    assert.equal(runtime.client, null);
    await runtime.connect();
    assert(
      (await service.history()).some((s) => s.id === store.state.sessionId),
    );
    console.log(
      "PASS modular runtime + conversation service: tools, edit, create, cards, reasoning, title, history, undo, shared connection, restart",
    );
    assert(
      received.every(
        (r) =>
          r.port === provider.address().port &&
          r.authorization === "Bearer local-test" &&
          r.model === "demo-model",
      ),
    );
    await runtime.disconnect();
    await new Promise((resolve) =>
      alternateProvider.listen(0, "127.0.0.1", resolve),
    );
    const credentials = path.join(root, "data", "opencode");
    await fs.mkdir(credentials, { recursive: true });
    await fs.writeFile(
      path.join(credentials, "auth.json"),
      JSON.stringify({ demo: { type: "api", key: "saved-test-credential" } }),
    );
    runtime.apiKey = () => "";
    settings.baseURL = `http://127.0.0.1:${alternateProvider.address().port}/v1`;
    settings.model = "changed-model";
    service.model = () => ({ providerID: "demo", modelID: "changed-model" });
    const before = received.length;
    await service.send("仅验证新端点与已保存凭据");
    assert(received.length > before);
    assert(
      received
        .slice(before)
        .every(
          (r) =>
            r.port === alternateProvider.address().port &&
            r.authorization === "Bearer saved-test-credential" &&
            r.model === "changed-model",
        ),
    );
    console.log(
      "PASS saved credential mode uses the changed API endpoint and model; /provider includes the configured model",
    );
  } finally {
    await runtime.disconnect();
    provider.closeAllConnections();
    provider.close();
    alternateProvider.closeAllConnections();
    alternateProvider.close();
  }
  const broken = new OpenCodeRuntime({
    directory: root,
    execute,
    settings: () => ({
      ...settings,
      executable: path.join(root, "missing-executable"),
    }),
  });
  await assert.rejects(broken.connect());
  assert.equal(broken.resources, null);
  await broken.disconnect();
  console.log("PASS failed startup releases MCP and child resources");
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
