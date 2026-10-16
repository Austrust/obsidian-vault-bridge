"use strict";
const { Modal, Notice } = require("obsidian");
const { lineDiff, diffContext } = require("../domain/diff");
function renderDiff(parent, entry) {
  const rows = lineDiff(entry.before || "", entry.after || "");
  const plus = rows.filter((r) => r.kind === "add").length,
    minus = rows.filter((r) => r.kind === "remove").length;
  parent.createDiv({ cls: "vb-diff-stat", text: `+${plus} / −${minus} 行` });
  const body = parent.createDiv("vb-local-diff");
  body.setAttribute("tabindex", "0");
  for (const row of diffContext(rows)) {
    if (row.kind === "skip") {
      body.createDiv({ cls: "vb-diff-skip", text: "⋯ 未修改的行" });
      continue;
    }
    const line = body.createDiv("vb-diff-line is-" + row.kind);
    line.createSpan({ cls: "vb-diff-number", text: String(row.old ?? "") });
    line.createSpan({ cls: "vb-diff-number", text: String(row.next ?? "") });
    line.createSpan({
      cls: "vb-diff-sign",
      text: row.kind === "add" ? "+" : row.kind === "remove" ? "−" : " ",
    });
    line.createSpan({
      cls: "vb-diff-code",
      text:
        row.text.replace(/\n$/, "") +
        (!row.text.endsWith("\n") ? " ⏎ 无末尾换行" : ""),
    });
  }
  return body;
}
class ChangeHistory extends Modal {
  constructor(app, plugin, scope = {}) {
    super(app);
    this.p = plugin;
    this.query = "";
    this.page = 0;
    this.filterScope = scope;
  }
  onOpen() {
    const c = this.contentEl;
    c.addClass("vb-history", "vb-surface");
    c.createEl("h2", { text: "审阅文件变更" });
    const tabs = c.createDiv("vb-tabs");
    const tabButtons = [];
    for (const [label, scope] of [
      [
        "本轮",
        {
          sessionId: this.p.sessionId,
          runId:
            this.filterScope.runId ||
            this.p.journal
              .filter((e) => e.sessionId === this.p.sessionId)
              .at(-1)?.runId ||
            "__empty",
        },
      ],
      ["当前对话", { sessionId: this.p.sessionId }],
      ["全部记录", {}],
    ]) {
      const b = tabs.createEl("button", { text: label });
      b.setAttribute(
        "aria-pressed",
        String(
          this.filterScope.runId
            ? label === "本轮"
            : this.filterScope.sessionId
              ? label === "当前对话"
              : label === "全部记录",
        ),
      );
      tabButtons.push(b);
      b.onclick = () => {
        for (const button of tabButtons)
          button.setAttribute("aria-pressed", String(button === b));
        this.filterScope = scope;
        this.page = 0;
        this.render();
      };
    }
    const undo = tabs.createEl("button", { text: "预览与撤销" });
    undo.onclick = () => this.p.openUndoHistory();
    c.createEl("p", {
      text: "跨会话的操作记录。撤销会检查后续编辑；新建文件撤销后保存在 VaultBridge Recovery。未确认或失败的记录请展开检查原文与恢复副本。",
      cls: "vb-history-hint",
    });
    const search = c.createEl("input", {
      type: "search",
      attr: { placeholder: "按笔记路径筛选", "aria-label": "筛选修改历史" },
    });
    search.addEventListener("input", () => {
      this.query = search.value;
      this.page = 0;
      this.render();
    });
    this.list = c.createDiv("vb-history-list");
    this.render();
  }
  render() {
    this.list.empty();
    const entries = this.p.journal
      .filter(
        (e) =>
          (!this.filterScope.sessionId ||
            e.sessionId === this.filterScope.sessionId) &&
          (!this.filterScope.runId || e.runId === this.filterScope.runId),
      )
      .filter((e) => e.path.toLowerCase().includes(this.query.toLowerCase()))
      .slice()
      .reverse();
    const pages = Math.max(1, Math.ceil(entries.length / 20));
    this.page = Math.min(this.page, pages - 1);
    const nav = this.list.createDiv("vb-history-nav");
    nav.createSpan({
      text: `${entries.length} 项记录 · ${this.page + 1}/${pages}`,
    });
    for (const [label, delta] of [
      ["上一页", -1],
      ["下一页", 1],
    ]) {
      const b = nav.createEl("button", { text: label });
      b.disabled = this.page + delta < 0 || this.page + delta >= pages;
      b.onclick = () => {
        this.page += delta;
        this.render();
      };
    }
    if (!entries.length) this.list.createEl("p", { text: "暂无修改记录" });
    for (const e of entries.slice(this.page * 20, (this.page + 1) * 20)) {
      const details = this.list.createEl("details", {
        cls: "vb-history-entry",
      });
      if (
        !e.workspace &&
        this.p.app?.vault?.getAbstractFileByPath(e.destination || e.path)
      ) {
        const open = details.createEl("button", { text: "打开文件" });
        open.onclick = () =>
          this.p.app.workspace.openLinkText(e.destination || e.path, "", true);
      }
      details.createEl("summary", {
        text: `${{ create: "新建", edit: "修改", move: "移动", rename: "重命名", delete: "删除" }[e.kind] || "修改"} · ${e.workspace ? "[外部] " : ""}${e.path}${e.destination ? " → " + e.destination : ""} · ${{ applied: "已应用", undone: "已撤销", pending: "写入未确认", undoing: "撤销结果待检查", failed: "失败" }[e.status] || e.status}`,
      });
      details.createDiv({
        cls: "vb-history-time",
        text:
          (this.p.sessionTitles[e.sessionId] ||
            (e.sessionId ? "未命名对话" : "旧版记录 · 未关联会话")) +
          " · " +
          new Date(e.time).toLocaleString(),
      });
      let loaded = false;
      details.addEventListener("toggle", () => {
        if (details.open && !loaded) {
          loaded = true;
          renderDiff(details, e);
        }
      });
      for (const recovery of [e.recoveryPath, e.undoRecoveryPath].filter(
        Boolean,
      ))
        details.createEl("p", { text: "恢复副本：" + recovery });
      if (e.undoError)
        details.createEl("p", { cls: "vb-error-text", text: e.undoError });
      if (e.status === "applied") {
        const b = details.createEl("button", {
          text:
            e.kind === "create" ? "撤销新建（保留恢复副本）" : "撤销这次操作",
        });
        b.onclick = async () => {
          b.disabled = true;
          try {
            await this.p.undoOperation(e.id);
            this.render();
            new Notice("已撤销");
          } catch (error) {
            new Notice(error.message);
            b.disabled = false;
          }
        };
      }
    }
  }
  onClose() {
    this.contentEl.empty();
  }
}
module.exports = { ChangeHistory, renderDiff };
