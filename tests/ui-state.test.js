// Host-control tests: exercise real UI callbacks without launching or controlling an app.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
class Element {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.children = [];
    this.attributes = {};
    this.textContent = options.text || "";
    this.value = "";
    this.classList = { add() {}, toggle() {} };
    for (const [k, v] of Object.entries(options.attr || {}))
      this.setAttribute(k, v);
  }
  createEl(tag, options) {
    const el = new Element(tag, options);
    this.children.push(el);
    return el;
  }
  createDiv(options) {
    return this.createEl("div", options);
  }
  createSpan(options) {
    return this.createEl("span", options);
  }
  addClass() {}
  empty() {
    this.children = [];
  }
  setAttribute(k, v) {
    this.attributes[k] = v;
  }
  addEventListener(type, handler) {
    (this.listeners ||= {})[type] = handler;
  }
  focus() {
    this.focused = true;
  }
  select() {}
  all() {
    return [this, ...this.children.flatMap((c) => c.all())];
  }
}
class Setting {
  constructor(parent) {
    this.settingEl = parent.createDiv();
  }
  setName(value) {
    this.settingEl.createEl("label", { text: value });
    return this;
  }
  setDesc(value) {
    this.settingEl.createEl("p", { text: value });
    return this;
  }
  component(tag, fn) {
    const el = this.settingEl.createEl(tag);
    const component = {
      inputEl: el,
      setValue(v) {
        el.value = v;
        return component;
      },
      setButtonText(v) {
        el.textContent = v;
        return component;
      },
      addOptions() {
        return component;
      },
      addOption() {
        return component;
      },
      onChange(cb) {
        el.oninput = () => cb(el.value);
        return component;
      },
      onClick(cb) {
        el.onclick = cb;
        return component;
      },
    };
    fn(component);
    return this;
  }
  addText(fn) {
    return this.component("input", fn);
  }
  addButton(fn) {
    return this.component("button", fn);
  }
  addDropdown(fn) {
    return this.component("select", fn);
  }
  addToggle(fn) {
    return this.component("input", fn);
  }
}
const obsidian = {
  ItemView: class {},
  FuzzySuggestModal: class {},
  Setting,
  PluginSettingTab: class {
    constructor() {
      this.containerEl = new Element();
    }
  },
  Notice: class {},
  Modal: class {
    constructor() {
      this.contentEl = new Element();
      this.scope = { handleKey() {} };
    }
    open() {
      this.onOpen();
      // Native Obsidian runs its initial-focus pass after onOpen.
      for (const el of this.contentEl.all()) el.focused = false;
      this.contentEl.focus();
    }
    close() {
      this.onClose();
    }
  },
};
function load(name) {
  const file = path.resolve(__dirname, "../src/ui/", name + ".js");
  const requireLocal = createRequire(file);
  const sandbox = {
    module: { exports: {} },
    require: (id) => (id === "obsidian" ? obsidian : requireLocal(id)),
    setInterval: () => 1,
    clearInterval: () => {},
    Date,
  };
  if (name === "permission-modal")
    sandbox.require = (id) =>
      id === "obsidian"
        ? obsidian
        : id === "./change-history"
          ? {
              renderDiff: (parent, e) =>
                parent.createEl("pre", { text: e.before + " → " + e.after }),
            }
          : requireLocal(id);
  if (name === "chat-view")
    sandbox.require = (id) =>
      id === "obsidian"
        ? obsidian
        : ["./change-history", "./permission-modal"].includes(id)
          ? {}
          : requireLocal(id);
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox);
  return sandbox.module.exports;
}
const { Settings } = load("settings");
const { PermissionModal } = load("permission-modal");
const { AgentView } = load("chat-view");
const { ChangeHistory } = load("change-history");
const find = (root, text) => root.all().find((e) => e.textContent === text);

test("review filters preserve the native Modal keyboard scope", () => {
  const modal = new ChangeHistory(
    {},
    {
      sessionId: "sample-session",
      journal: [],
      sessionTitles: {},
    },
    { sessionId: "sample-session" },
  );
  const keyboardScope = modal.scope;
  assert.equal(typeof keyboardScope.handleKey, "function");
  modal.open();
  find(modal.contentEl, "本轮").onclick();
  assert.equal(modal.filterScope.sessionId, "sample-session");
  assert.equal(modal.filterScope.runId, "__empty");
  find(modal.contentEl, "全部记录").onclick();
  assert.equal(Object.keys(modal.filterScope).length, 0);
  assert.equal(modal.scope, keyboardScope);
  modal.close();
});

test("streaming scroll requests share one animation frame and respect reading older messages", () => {
  const frames = [];
  const view = new AgentView({}, {});
  view.contentEl = {
    ownerDocument: {
      defaultView: { requestAnimationFrame: (fn) => frames.push(fn) },
      getSelection: () => ({ isCollapsed: true }),
    },
  };
  view.log = { scrollTop: 20, scrollHeight: 1000 };
  for (let i = 0; i < 100; i++) view.scrollToEnd();
  assert.equal(frames.length, 1);
  view.followTail = false;
  frames.shift()();
  assert.equal(view.log.scrollTop, 20);
  view.followTail = true;
  view.scrollToEnd();
  frames.shift()();
  assert.equal(view.log.scrollTop, 1000);
  assert.equal(view.tailScrollPending, false);
});
test("settings separates five tasks, validates drafts immediately and applies only through the reserved connection action", async () => {
  const calls = [];
  const p = {
    settings: {
      executable: "opencode",
      provider: "demo",
      model: "model",
      baseURL: "https://example.test/v1",
    },
    apiKey: "",
    conversations: { idle() {} },
    configureConnection: async (patch, options) => {
      calls.push({ patch, options });
      return [];
    },
    persist: async () => {},
    refresh() {},
  };
  const ui = new Settings({}, p);
  ui.display();
  for (const tab of ["连接", "对话", "权限", "历史", "资料"])
    assert(find(ui.containerEl, tab));
  const field = ui.containerEl
    .all()
    .find((e) => e.attributes["aria-label"] === "API Base URL");
  field.value = "wrong";
  field.oninput();
  assert(find(ui.containerEl, "应用并测试本地连接").disabled);
  assert.equal(p.settings.baseURL, "https://example.test/v1");
  field.value = "http://localhost:1111/v1";
  field.oninput();
  assert(!find(ui.containerEl, "应用并测试本地连接").disabled);
  await find(ui.containerEl, "应用并测试本地连接").onclick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].patch.baseURL, "http://localhost:1111/v1");
  assert.equal(calls[0].options.apiKey, "");
  find(ui.containerEl, "权限").onclick();
  assert(find(ui.containerEl, "笔记"));
  assert(find(ui.containerEl, "外部资料与 Skills"));
  assert(find(ui.containerEl, "可视化"));
  assert(!find(ui.containerEl, "API Base URL"));
});
test("expanded approval grants exactly once and closing it denies with focus initially on deny", () => {
  const request = {
    label: "修改笔记",
    args: { path: "sample.md", oldText: "old", newText: "new" },
    expiresAt: Date.now() + 120000,
  };
  const values = [];
  const modal = new PermissionModal({}, request, (value) => values.push(value));
  modal.open();
  assert(find(modal.contentEl, "拒绝").focused);
  find(modal.contentEl, "允许一次").onclick();
  modal.close();
  modal.finish(true);
  assert.deepEqual(values, [true]);
  assert(modal.closed);
  const dismissed = new PermissionModal({}, request, (value) =>
    values.push(value),
  );
  dismissed.open();
  dismissed.close();
  dismissed.close();
  assert.deepEqual(values, [true, false]);
});
test("queue submission preserves text typed during context capture and ignores double submission", async () => {
  let release;
  const delivered = [];
  const p = {
    running: true,
    draft: "first",
    turnQueue: {
      add: async (text) => {
        delivered.push(text);
        await new Promise((r) => (release = r));
      },
    },
    persist: async () => {},
  };
  const view = new AgentView({}, p);
  view.input = { value: "first" };
  view.updateSend = () => {};
  view.resizeInput = () => {};
  const adding = view.submit();
  await view.submit();
  assert.deepEqual(delivered, ["first"]);
  view.input.value = "next draft";
  p.draft = "next draft";
  release();
  await adding;
  assert.equal(view.input.value, "next draft");
  assert.equal(p.draft, "next draft");
  assert(!view.queuing);
});
