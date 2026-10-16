const p = {
  status: "就绪",
  connection: "connected",
  error: "",
  sessionTitle: "整理研究计划",
  sessionId: "current",
  contextUsage: { used: 32768, limit: 131072 },
  settings: { model: "deepseek-flash" },
  mentions: new Set(["研究计划.md"]),
  journal: [],
  artifacts: [],
  running: false,
  preparing: false,
  transcript: [
    {
      id: "u1",
      role: "user",
      text: "整理这篇研究计划，列出接下来的任务。",
      done: true,
    },
    {
      id: "p1",
      role: "assistant",
      kind: "progress",
      text: "先核对笔记中的目标与进度。",
      toolCalls: [
        {
          id: "t1",
          label: "读取笔记",
          path: "研究计划.md",
          status: "completed",
          input: { path: "研究计划.md" },
          output: "已读取笔记内容。",
        },
        {
          id: "t2",
          label: "编辑笔记",
          path: "研究计划.md",
          status: "completed",
          input: { path: "研究计划.md" },
          output: "已保存修改，可撤销。",
        },
      ],
      reasoning:
        "先区分已完成的工作与后续任务，再按照研究阶段整理。保留原始数据和引用，避免改变原意。",
      done: true,
    },
    {
      id: "a1",
      role: "assistant",
      kind: "answer",
      text: "已整理好研究计划，保留了原有的目标和引用。\n\n### 接下来做什么\n\n| 任务 | 进度 |\n| --- | --- |\n| 文献综述 | 已完成 |\n| 建立模型 | 进行中 |\n| 结果分析 | 待开始 |\n\n建议先完成 **模型验证**，再进入结果分析。",
      done: true,
    },
  ],
  fail: (e) => (document.querySelector("#result").textContent = e.message),
  connect: async () => {},
  autoConnect: async () => {},
  persist: async () => {},
  openSettings: () => {
    document.querySelector("#result").textContent = "打开模型设置";
  },
  attachActive: () => {
    p.mentions.add("研究计划.md");
    view.render();
  },
  chooseHistory: () => {
    document.querySelector("#history").textContent = "整理研究计划";
  },
  newSession: async () => {
    p.transcript = [];
    p.sessionTitle = "新对话";
    view.render();
  },
  stop: async () => {
    p.running = false;
    view.render();
  },
};
const view = new window.ViewClass({}, p);
const historyPerf = document.createElement("button");
historyPerf.textContent = "历史列表样本 1000";
historyPerf.onclick = () => {
  const items = Array.from({ length: 1000 }, (_, i) => ({
    id: "history-perf-" + i,
    displayTitle: "独立历史对话 " + i,
    time: { updated: Date.now() - i * 60000 },
  }));
  const host = {
    ...p,
    sessionCache: items,
    conversations: { ...p.conversations, history: async () => items },
  };
  const started = performance.now();
  new window.SessionHistory({}, host, items).open();
  document.querySelector("#result").textContent = JSON.stringify({
    sessions: 1000,
    initialMs: performance.now() - started,
    rows: document.querySelectorAll(".vb-session-row").length,
  });
};
document.querySelector("#tools").append(historyPerf);
const appendReply = document.createElement("button");
appendReply.textContent = "追加回复样本";
appendReply.onclick = () => {
  p.transcript.push({
    id: "appended-" + p.transcript.length,
    role: "assistant",
    kind: "answer",
    text: "新增独立回复",
    done: true,
  });
  view.render();
};
document.querySelector("#tools").append(appendReply);
for (const count of [100, 1000]) {
  const button = document.createElement("button");
  button.textContent = "长对话样本 " + count;
  button.onclick = () => {
    p.transcript = Array.from({ length: count }, (_, i) => ({
      id: "perf-" + i,
      role: i % 2 ? "assistant" : "user",
      kind: i % 2 ? "answer" : "user",
      text: "独立性能样本 " + i + "：" + "这是一段研究计划说明。".repeat(20),
      done: true,
      runId: "perf-" + Math.floor(i / 2),
    }));
    p.journal = [];
    p.artifacts = [];
    const started = performance.now();
    view.render();
    const initial = performance.now() - started;
    const refreshStarted = performance.now();
    for (let i = 0; i < 10; i++) view.render();
    document.querySelector("#result").textContent = JSON.stringify({
      messages: count,
      initialMs: initial,
      meanRefreshMs: (performance.now() - refreshStarted) / 10,
      renderedRows: view.rows.size,
    });
  };
  document.querySelector("#tools").append(button);
}
p.refresh = () => view.render();
p.send = async (text) => {
  document.querySelector("#sent").textContent = text;
  p.transcript.push({
    id: "u" + p.transcript.length,
    role: "user",
    text,
    done: true,
  });
  view.render();
};
view.onOpen();
document.querySelector("#update").onclick = () => {
  p.running = true;
  p.transcript = p.transcript.filter((x) => x.id !== "a1");
  view.render();
};
document.querySelector("#short").onclick = () => {
  document.querySelector("#frame").style.cssText = "width:320px;height:500px";
};
document.querySelector("#history-test").onclick = () => p.chooseHistory();
document.querySelector("#select-body").onclick = () => {
  const body = document.querySelector(".na-message.assistant .na-body");
  const range = document.createRange();
  range.selectNodeContents(body);
  const selection = document.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
};
document.querySelector("#clear-selection").onclick = () =>
  document.getSelection().removeAllRanges();
document.querySelector("#dark").onclick = () =>
  document.body.classList.toggle("theme-dark");
document.querySelector("#error").onclick = () => {
  p.error = "连接已断开，请点击右上角重连。";
  p.connection = "error";
  view.render();
};

p.journal = [
  {
    id: "change1",
    sessionId: "current",
    path: "研究计划.md",
    kind: "edit",
    time: Date.now(),
    status: "applied",
    before: "# 研究计划\n\n目标：旧内容\n",
    after: "# 研究计划\n\n目标：新内容\n新增任务\n",
  },
  {
    id: "create1",
    sessionId: "current",
    path: "任务.md",
    kind: "create",
    time: Date.now(),
    status: "applied",
    before: "",
    after: "# 新任务\n",
  },
];
p.openChangeHistory = () => new window.ChangeHistory({}, p).open();
for (const entry of p.journal) entry.runId = "fixture-run";
const recoveryFiles = new Map(p.journal.map((e) => [e.path, e.after]));
p.engine = new window.RecoveryEngine(
  {
    readOptional: async (name) => recoveryFiles.get(name),
    compareWrite: async (name, before, after, guard) => {
      guard();
      if (recoveryFiles.get(name) !== before) throw Error("文件已有后续修改");
      recoveryFiles.set(name, after);
    },
    removeCreated: async (name, expected, guard) => {
      guard();
      if (recoveryFiles.get(name) !== expected) throw Error("文件已有后续修改");
      recoveryFiles.delete(name);
      return "VaultBridge Recovery/test/" + name;
    },
  },
  p.journal,
  async () => view.render(),
);
p.undoOperation = (...args) =>
  window.PluginClass.prototype.undoOperation.apply(p, args);
p.openUndoHistory = () => new window.UndoHistory({}, p).open();
const recoveryTest = document
  .querySelector("#tools")
  .createEl("button", { text: "最近操作与撤销测试" });
recoveryTest.onclick = () => p.openUndoHistory();
const conflictTest = document
  .querySelector("#tools")
  .createEl("button", { text: "模拟后续人工修改" });
conflictTest.onclick = () =>
  recoveryFiles.set("研究计划.md", "人工修改，不能覆盖");
view.render();

p.gitHistory = {
  directory: "<vault>/.obsidian/plugins/vault-bridge/history.git",
  list: async () => [
    { id: "a".repeat(40), time: Date.now(), label: "运行后 · 整理研究计划" },
    {
      id: "b".repeat(40),
      time: Date.now() - 60000,
      label: "运行前 · 整理研究计划",
    },
  ],
  diff: async () =>
    "commit aaaaaaaa\n\n    运行后 · 整理研究计划\n\ndiff --git a/研究计划.md b/研究计划.md\n--- a/研究计划.md\n+++ b/研究计划.md\n@@ -1 +1 @@\n-旧目标\n+新目标",
  preview: async () => ({
    paths: ["研究计划.md"],
    target: new Map([["研究计划.md", "x"]]),
    current: new Map([["研究计划.md", "y"]]),
  }),
  checkpoint: async () => {},
};
p.conversations = { idle: () => {} };
p.restoreGit = async () => {
  document.querySelector("#result").textContent = "Git 回退已触发";
};
document.querySelector("#git-test").onclick = () =>
  new window.GitHistoryModal({}, p).open();
document.querySelector("#permission-test").onclick = () => {
  const modal = new window.PermissionModal(
    {},
    {
      label: "移动笔记",
      args: { path: "研究计划.md", destination: "归档/研究计划.md" },
    },
    (value) => {
      document.querySelector("#result").textContent = value
        ? "已批准一次"
        : "已拒绝";
      modal.close();
    },
  );
  modal.finish = (value) => {
    modal.finish = () => {};
    document.querySelector("#result").textContent = value
      ? "已批准一次"
      : "已拒绝";
    modal.close();
  };
  modal.open();
};

p.sessionTitles = { current: "整理研究计划" };
p.sessionMeta = {};
const sessions = [
  {
    id: "current",
    displayTitle: "整理研究计划",
    time: { updated: Date.now() },
  },
];
p.restore = async (id, title) => {
  p.sessionId = id;
  p.sessionTitle = title;
  view.render();
};
p.conversations.renameSession = async (id, title) => {
  p.sessionTitles[id] = title;
};
p.conversations.archiveSession = async (id, archived) => {
  p.sessionMeta[id] = { archived };
};
p.chooseHistory = () => new window.SessionHistory({}, p, sessions).open();

p.queue = [];
p.selectedSkills = new Set();
p.turnQueue = {
  paused: false,
  add: async (text) => {
    p.queue.push({ id: String(Date.now()), sessionId: p.sessionId, text });
    view.render();
  },
  remove: async (id) => {
    p.queue = p.queue.filter((x) => x.id !== id);
    view.render();
  },
  pause: () => {},
  resume: async () => {},
};
p.editMessage = async (id, text) => {
  view.input.value = text;
  view.resizeInput();
  document.querySelector("#result").textContent = "已创建编辑分支";
};
p.pickSkill = async () => {
  p.selectedSkills.add("review/SKILL.md");
  view.render();
};
p.resources = {
  roots: () => [{ id: "sample", path: "/sample/research" }],
  list: async () => [{ path: "README.md", directory: false }],
  read: async () => ({ text: "Sample external research material" }),
  resolve: async (x) => x,
  listRootCheck: async () => {},
};
p.openResources = () => new window.WorkspacePanel({}, p).open();
p.openExternalHistory = () => {
  document.querySelector("#result").textContent = "外部 Git 历史";
};
p.steer = async (text) => {
  document.querySelector("#sent").textContent = text;
  p.running = false;
  view.render();
};
const busy = document
  .querySelector("#tools")
  .createEl("button", { text: "模拟运行中" });
busy.onclick = () => {
  p.running = true;
  view.render();
};
// Exercise actual UI actions through the same facade as the native plugin.
p.settings.provider = "deepseek";
p.settings.baseURL = "https://api.deepseek.com/v1";
p.settings.artifactFolder = "Cards";
p.settings.externalFolders = ["/sample/research"];
p.openReview = (runId) =>
  new window.ChangeHistory({}, p, { sessionId: p.sessionId, runId }).open();
p.chooseModel = () => new window.ModelPicker({}, p).open();
p.disconnect = async () => {
  p.connection = "disconnected";
  view.render();
};
p.conversations.history = async () => sessions;
p.conversations.forkAt = async () => {
  p.sessionMeta.fork = { parent: p.sessionId };
  p.sessionId = "fork";
  p.sessionTitle += " · 分支";
  view.render();
};
p.openSettings = () => {
  const modal = new obsidian.Modal();
  modal.onOpen = () => {
    const settings = new window.Settings({}, p);
    settings.containerEl = modal.contentEl;
    settings.display();
  };
  modal.onClose = () => modal.contentEl.empty();
  modal.open();
};
p.app = {
  vault: { getAbstractFileByPath: () => null },
  workspace: { openLinkText: async () => {} },
};
view.app = {
  vault: {
    getMarkdownFiles: () => [
      { path: "研究计划.md" },
      { path: "资料/阅读笔记.md" },
    ],
  },
};
p.addExample = async () => {
  p.artifacts.push({
    id: "demo",
    sessionId: p.sessionId,
    runId: "fixture-run",
    title: "研究进度",
    code: 'dv.paragraph("Demo")',
  });
  view.render();
};
p.dataview = () => ({
  executeJs: async (code, body) => body.createDiv({ text: "卡片运行完成" }),
});
p.saveArtifact = async (a) => {
  a.savedPath = "Cards/" + a.title + ".md";
  view.render();
};
for (const m of p.transcript) m.runId = "fixture-run";
const tools = document.querySelector("#tools");
for (const width of [320, 360, 420, 520]) {
  const b = tools.createEl("button", { text: width + " × 500" });
  b.onclick = () => {
    document.querySelector("#frame").style.cssText =
      `width:${width}px;height:500px`;
    view.fitStatusBar();
  };
}
const compact = tools.createEl("button", { text: "320 × 360 / 125%" });
compact.onclick = () => {
  document.querySelector("#frame").style.cssText =
    "width:320px;height:360px;zoom:1.25";
  view.fitStatusBar();
};
const approval = tools.createEl("button", { text: "侧栏审批" });
approval.onclick = () => {
  const a = {
    request: {
      label: "修改笔记",
      args: { path: "研究计划.md", oldText: "旧内容", newText: "新内容" },
      expiresAt: Date.now() + 120000,
    },
    finish: (value) => {
      p.pendingApprovals = [];
      document.querySelector("#result").textContent = value
        ? "批准一次"
        : "已拒绝";
      view.render();
    },
  };
  p.pendingApprovals = [a];
  view.render();
};
const reset = tools.createEl("button", { text: "模拟完成" });
reset.onclick = () => {
  p.running = false;
  view.render();
};
view.render();

p.availableModels = async () => [
  {
    id: "fixture-chat",
    name: "Fixture chat",
    provider: p.settings.provider,
    configured: true,
    context: 64000,
  },
  {
    id: "fixture-reasoner",
    name: "Fixture reasoning",
    provider: p.settings.provider,
    configured: true,
    reasoning: true,
    context: 64000,
  },
];
p.compactContext = async () => {
  p.contextUsage = { used: null, limit: 131072, compacted: true };
  p.status = "上下文已压缩";
  view.render();
};
p.configureConnection = async (patch, options = {}) => {
  p.settings = { ...p.settings, ...patch };
  if (options.apiKey !== undefined) p.apiKey = options.apiKey;
  p.connection = options.connect === false ? "disconnected" : "connected";
  view.render();
  return p.availableModels();
};
for (const scale of [100, 125, 150]) {
  const button = tools.createEl("button", {
    text: "320 × 500 / " + scale + "%",
  });
  button.onclick = () => {
    document.querySelector("#frame").style.cssText =
      "width:320px;height:500px;zoom:" + scale / 100;
    view.fitStatusBar();
  };
}
