// Explicitly invoked through the official Obsidian CLI; uses an in-memory host.
module.exports = async function (app, base, output) {
  const path = require("node:path"),
    fs = require("node:fs"),
    assert = require("node:assert/strict");
  const real = app.plugins.plugins["vault-bridge"];
  const fixture = require(path.join(base, "tests/native-fixture.cjs"))(app);
  const { host, view } = fixture;
  const doc = view.contentEl.ownerDocument,
    win = doc.defaultView;
  const native = win.require("@electron/remote").getCurrentWindow();
  const original = {
    width: app.workspace.rightSplit.containerEl.getBoundingClientRect().width,
    dark: doc.body.classList.contains("theme-dark"),
  };
  const checks = [],
    shots = [];
  const settle = () => new Promise((r) => setTimeout(r, 250));
  const modal = () => [...doc.querySelectorAll(".modal")].at(-1);
  const close = () => modal()?.querySelector(".modal-header-button")?.click();
  const button = (root, text) =>
    [...root.querySelectorAll("button")].find((b) => b.textContent === text);
  const input = (root, label) =>
    root.querySelector('[aria-label="' + label + '"]');
  const type = (el, value) => {
    el.value = value;
    el.dispatchEvent(
      new el.ownerDocument.defaultView.Event("input", { bubbles: true }),
    );
  };
  const capture = async (el, name) => {
    const w = el.ownerDocument.defaultView,
      n = w.require("@electron/remote").getCurrentWindow();
    n.webContents.setBackgroundThrottling(false);
    n.focus();
    await settle();
    const r = el.getBoundingClientRect(),
      z = w.require("electron").webFrame.getZoomFactor();
    const shot = await n.webContents.capturePage({
      x: Math.floor(r.x * z),
      y: Math.floor(r.y * z),
      width: Math.floor(r.width * z),
      height: Math.floor(r.height * z),
    });
    fs.writeFileSync(path.join(output, name + ".png"), shot.toPNG());
    shots.push({
      name,
      width: r.width,
      height: r.height,
      overflow: el.scrollWidth - el.clientWidth,
    });
    n.webContents.setBackgroundThrottling(true);
  };
  fs.mkdirSync(output, { recursive: true });
  Object.assign(host, {
    settings: {
      executable: "C:/Program Files/OpenCode/opencode.exe",
      provider: "deepseek",
      model: "deepseek-flash",
      baseURL: "https://api.deepseek.com/v1",
      agentMode: "agent",
      permissions: {},
      externalFolders: [],
      skillFolder: "C:/sample-old",
      taskTimeoutSeconds: 900,
    },
    apiKey: "",
    catalog: [],
    resources: {
      roots: () => [],
      resolve: async (value) => value,
      listRootCheck: async () => {},
    },
    conversations: {
      idle() {},
      history: async () =>
        Array.from({ length: 25 }, (_, i) => ({
          id: "sample-" + i,
          displayTitle: "独立验收样本 · 研究方案比较 " + (i + 1),
          time: { updated: Date.now() - i * 3600000 },
        })),
    },
    configureConnection: async (patch, options) => {
      Object.assign(host.settings, patch);
      host.apiKey = options.rememberKey ? "" : options.apiKey;
      return [];
    },
    active: () => ({
      path: "sample.md",
      selection: "SELECTED",
      text: "SELECTED\nUNSELECTED",
    }),
    engine: { read: async (path) => ({ path, text: "SELECTED\nUNSELECTED" }) },
    availableModels: async () => [],
    pickSkill: async () => {},
  });
  for (const key of [
    "openResources",
    "chooseModel",
    "chooseHistory",
    "openUndoHistory",
    "openReview",
  ])
    host[key] = (...args) => real[key].apply(host, args);
  try {
    for (const theme of ["light", "dark"]) {
      doc.body.classList.toggle("theme-dark", theme === "dark");
      doc.body.classList.toggle("theme-light", theme === "light");
      app.workspace.rightSplit.setSize(340);
      await settle();
      real.attachActive.call(host, "selection");
      const context = await real.contextFor.call(host, "explain");
      assert.equal(context.notes.length, 0);
      assert.equal(context.selection.text, "SELECTED");
      await capture(view.contentEl, "conversation-" + theme);
      button(view.contentEl, "仅选区 · 8 字符").click();
      await settle();
      assert.equal(modal().querySelector("pre").textContent, "SELECTED");
      await capture(modal(), "selection-" + theme);
      close();
      host.openResources();
      await settle();
      const r = modal();
      type(input(r, "外部目录路径"), "C:/sample/reference-directory");
      button(r, "Skills").click();
      type(
        input(r, "Skill 仓库路径"),
        "C:/sample/a-long-research-workspace/skills-library",
      );
      button(r, "资料").click();
      assert.equal(
        input(r, "外部目录路径").value,
        "C:/sample/reference-directory",
      );
      await capture(r, "resources-" + theme);
      button(r, "Skills").click();
      assert.equal(
        input(r, "Skill 仓库路径").value,
        "C:/sample/a-long-research-workspace/skills-library",
      );
      await capture(r, "skills-" + theme);
      button(r, "保存").click();
      await settle();
      assert.equal(host.settings.skillFolder, input(r, "Skill 仓库路径").value);
      button(r, "工作目录").click();
      await capture(r, "workspace-" + theme);
      close();
      host.chooseModel();
      await capture(modal(), "model-" + theme);
      close();
      await host.chooseHistory();
      await settle();
      assert.equal(modal().querySelectorAll(".vb-session-row").length, 20);
      await capture(modal(), "history-" + theme);
      close();
    }
    checks.push(
      "selection preview excludes unselected text",
      "resource and Skill drafts survive tabs",
      "Skill visible path equals saved path",
      "history pagination: 20 of 25",
    );
    const settings = real.settingsTab;
    const saved = Object.fromEntries(
      [
        "p",
        "tab",
        "connectionDraft",
        "connectionBaseline",
        "keyDraft",
        "credentialMode",
      ].map((key) => [key, settings[key]]),
    );
    try {
      settings.p = host;
      settings.connectionDraft = settings.connectionBaseline = undefined;
      settings.keyDraft = "";
      real.openSettings();
      await settle();
      settings.tab = "连接";
      settings.display();
      settings.hide();
      host.settings.model = "external-model";
      settings.display();
      assert.equal(
        input(settings.containerEl, "模型 ID").value,
        "external-model",
      );
      await button(settings.containerEl, "仅保存设置").onclick();
      assert.equal(host.settings.model, "external-model");
      type(input(settings.containerEl, "模型 ID"), "my-edit");
      settings.hide();
      host.settings.model = "external-newer";
      settings.display();
      assert(button(settings.containerEl, "仅保存设置").disabled);
      button(settings.containerEl, "放弃草稿，载入当前配置").click();
      assert.equal(
        input(settings.containerEl, "模型 ID").value,
        "external-newer",
      );
      host.settings.model = "deepseek-flash";
      settings.display();
      checks.push(
        "settings follows external model",
        "conflicting draft blocks save",
        "explicit reset loads current configuration",
      );
      for (const label of ["连接", "对话", "权限", "历史", "资料"]) {
        settings.tab = label;
        settings.display();
        await capture(settings.containerEl, "settings-" + label);
      }
    } finally {
      app.setting.close();
      settings.hide();
      Object.assign(settings, saved);
    }
    host.openUndoHistory();
    await capture(modal(), "undo");
    close();
    host.openReview();
    await capture(modal(), "review");
    close();
    view.mountCard({
      id: "native-card-preview",
      title: "独立卡片样本",
      code: 'dv.paragraph("Sample only");',
    });
    const card = view.cards.get("native-card-preview").el;
    assert(card.querySelector(".vb-card-permissions"));
    assert.equal(
      card.querySelector(".vb-card-source pre").textContent,
      'dv.paragraph("Sample only");',
    );
    checks.push("card privileges and code available before execution");
  } finally {
    for (let i = 0; modal() && i < 20; i++) close();
    doc.body.classList.toggle("theme-dark", original.dark);
    doc.body.classList.toggle("theme-light", !original.dark);
    app.workspace.rightSplit.setSize(original.width);
    fixture.restore();
    native.webContents.setBackgroundThrottling(true);
  }
  assert.equal(doc.querySelectorAll(".modal-container").length, 0);
  const result = {
    version: real.manifest.version,
    checks,
    shots,
    restored: view.p === real,
  };
  fs.writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify(result, null, 2),
  );
  return result;
};
