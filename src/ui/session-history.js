const { Modal, Notice, Menu } = require("obsidian");
const { relativeTime } = require("../presentation-turns");
const { showMenuAtTrigger } = require("./menu-position");
class SessionHistory extends Modal {
  constructor(app, plugin, items) {
    super(app);
    this.p = plugin;
    this.items = items || plugin.sessionCache || [];
    this.query = "";
    this.archived = false;
    this.limit = 20;
  }
  onOpen() {
    const c = this.contentEl;
    c.addClass("vb-session-manager", "vb-surface");
    c.createEl("h2", { text: "对话" });
    const search = c.createEl("input", {
      type: "search",
      attr: { placeholder: "搜索对话", "aria-label": "搜索对话" },
    });
    search.oninput = () => {
      this.query = search.value;
      this.limit = 20;
      this.render();
    };
    const actions = c.createDiv("vb-panel-actions vb-actions-start");
    const toggle = actions.createEl("button", { text: "查看已归档" });
    toggle.onclick = () => {
      this.archived = !this.archived;
      this.limit = 20;
      toggle.textContent = this.archived ? "返回最近对话" : "查看已归档";
      this.render();
    };
    this.status = c.createDiv({ cls: "na-muted", text: "正在更新对话列表…" });
    this.list = c.createDiv("vb-session-list");
    this.render();
    this.load();
    search.focus();
  }
  async load() {
    try {
      const items = await this.p.conversations.history();
      if (this.closed) return;
      this.items = items;
      this.status.textContent = "";
      this.render();
    } catch (e) {
      if (this.closed) return;
      this.status.textContent = "更新失败：" + e.message;
      const retry = this.status.createEl("button", { text: "重试" });
      retry.onclick = () => this.load();
    }
  }
  async action(fn) {
    this.busy = true;
    this.render();
    try {
      await fn();
    } catch (e) {
      new Notice(e.message);
    } finally {
      this.busy = false;
      if (!this.closed) this.render();
    }
  }
  rename(s, row) {
    row.empty();
    const input = row.createEl("input", { attr: { "aria-label": "对话标题" } });
    input.value = s.displayTitle;
    const save = row.createEl("button", { text: "保存" });
    save.onclick = () =>
      this.action(async () => {
        const title = input.value.trim();
        if (!title) throw Error("标题不能为空");
        await this.p.conversations.renameSession(s.id, title);
        s.displayTitle = title;
      });
    const cancel = row.createEl("button", { text: "取消" });
    cancel.onclick = () => this.render();
    input.focus();
    input.select();
  }
  render() {
    this.list.empty();
    const items = this.items.filter(
      (s) =>
        !!this.p.sessionMeta?.[s.id]?.archived === this.archived &&
        s.displayTitle.toLowerCase().includes(this.query.toLowerCase()),
    );
    if (!items.length)
      this.list.createEl("p", {
        cls: "vb-empty",
        text: this.query.trim()
          ? "没有匹配“" + this.query + "”的对话"
          : this.archived
            ? "暂无已归档对话"
            : "还没有对话，从侧栏发送第一条指令开始",
      });
    for (const s of items.slice(0, this.limit)) {
      const row = this.list.createDiv("vb-session-row");
      const b = row.createEl("button", {
        cls: "vb-session-main",
        text: s.displayTitle,
      });
      b.disabled = !!this.busy;
      b.onclick = () =>
        this.action(async () => {
          await this.p.restore(s.id, s.displayTitle);
          this.close();
        });
      row.createSpan({
        cls: "vb-session-date",
        text: [
          s.id === this.p.sessionId ? "当前" : "",
          this.p.sessionMeta?.[s.id]?.parent ? "分支" : "",
          relativeTime(s.time?.updated),
        ]
          .filter(Boolean)
          .join(" · "),
      });
      const more = row.createEl("button", {
        text: "⋯",
        attr: { "aria-label": "管理对话：" + s.displayTitle },
      });
      more.disabled = !!this.busy;
      more.onclick = (event) => {
        const menu = new Menu();
        menu.addItem((i) =>
          i
            .setTitle("重命名")
            .setIcon("pencil")
            .onClick(() => this.rename(s, row)),
        );
        menu.addItem((i) =>
          i
            .setTitle(this.archived ? "恢复" : "归档")
            .setIcon("archive")
            .onClick(() =>
              this.action(() =>
                this.p.conversations.archiveSession(s.id, !this.archived),
              ),
            ),
        );
        showMenuAtTrigger(menu, event);
      };
    }
    if (items.length > this.limit) {
      const more = this.list.createEl("button", {
        text: "加载更多（剩余 " + (items.length - this.limit) + "）",
      });
      more.onclick = () => {
        this.limit += 20;
        this.render();
      };
    }
  }
  onClose() {
    this.closed = true;
    this.contentEl.empty();
  }
}
module.exports = { SessionHistory };
