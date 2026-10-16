// Load explicitly through Obsidian CLI eval for native UI acceptance.
// Replaces only the view's host; all sample writes and sends stay in memory.
module.exports = function installNativeFixture(app) {
  const view = app.workspace.getLeavesOfType("note-agent-opencode")[0]?.view;
  if (!view || view.p.running || view.p.preparing)
    throw Error("An idle VaultBridge view is required");
  const original = { host: view.p, input: view.input.value };
  const state = { sent: [], decisions: [], persisted: 0 };
  const host = Object.assign(Object.create(null), {
    app,
    settings: { model: "deepseek-flash", agentMode: "agent" },
    sessionId: "native-acceptance-sample",
    sessionTitle: "独立验收样本",
    sessionMeta: {},
    sessionTitles: {},
    draft: "",
    mentions: new Set(),
    selectedSkills: new Set(),
    externalReferences: [],
    selection: null,
    journal: [],
    artifacts: [],
    queue: [],
    pendingApprovals: [],
    pendingMessage: null,
    running: false,
    preparing: false,
    status: "就绪",
    connection: "connected",
    error: "",
    transcript: [
      { id: "native-u1", role: "user", text: "核对这份独立样本。", done: true },
      {
        id: "native-a1",
        role: "assistant",
        kind: "answer",
        done: true,
        text: "### 验收结果\n\n这是 **独立测试数据**，没有修改笔记。\n\n| 项目 | 状态 |\n| --- | --- |\n| 操作撤销 | 已验证 |\n| 菜单布局 | 正在验收 |\n\n```js\nconst result = 'ready';\n```\n\n- 支持窄栏\n- 保留人工修改",
      },
    ],
    persist: async () => {
      state.persisted++;
    },
    fail: (error) => {
      host.error = error.message;
      view.render();
    },
    refresh: () => view.render(),
    send: async (text) => {
      state.sent.push(text);
    },
    stop: async () => {
      host.running = false;
      view.render();
    },
    turnQueue: {
      paused: true,
      add: async (text) => {
        host.queue.push({ id: "queued", sessionId: host.sessionId, text });
      },
      remove: (id) => {
        host.queue = host.queue.filter((e) => e.id !== id);
        view.render();
      },
      pause: () => {},
      resume: () => {},
    },
  });
  view.p = host;
  view.input.value = "";
  view.resizeInput();
  view.render();
  return {
    host,
    view,
    state,
    approval() {
      host.pendingApprovals = [
        {
          request: {
            label: "编辑样本笔记",
            args: { path: "独立样本.md", oldText: "旧内容", newText: "新内容" },
            expiresAt: Date.now() + 120000,
          },
          finish: (allowed) => {
            state.decisions.push(allowed);
            host.pendingApprovals = [];
            view.render();
          },
        },
      ];
      view.render();
    },
    restore() {
      clearTimeout(view.draftTimer);
      host.pendingApprovals = [];
      view.render();
      view.p = original.host;
      view.input.value = original.input;
      view.picker.close();
      view.resizeInput();
      view.render();
    },
  };
};
