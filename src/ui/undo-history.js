"use strict";
const { Modal, Notice } = require("obsidian");
const { recentRuns } = require("../domain/operation-undo");
const { renderDiff } = require("./change-history");
const labels = {
  edit: "恢复原文",
  create: "移入恢复目录",
  move: "移回原位置",
  rename: "恢复原文件名",
  delete: "恢复已删除笔记",
};

class UndoHistory extends Modal {
  constructor(app, plugin) {
    super(app);
    this.p = plugin;
    this.generation = 0;
    this.closed = false;
  }
  onOpen() {
    this.contentEl.addClass("vb-history", "vb-surface");
    this.render();
  }
  render() {
    this.generation++;
    const c = this.contentEl;
    c.empty();
    c.createEl("h2", { text: "最近操作与撤销" });
    c.createEl("p", {
      cls: "vb-history-hint",
      text: "最近 20 轮文件操作。只撤销 Agent 在该轮做的修改，不扫描整个笔记库。预览和确认时都会检查后续编辑；对话消息保持不变。",
    });
    const runs = recentRuns(this.p.journal);
    if (!runs.length)
      c.createEl("p", {
        text: "暂无可撤销的任务。Agent 修改文件后会在这里显示。",
      });
    for (const run of runs) {
      const row = c.createDiv("vb-history-entry");
      const session = run.entries[0].sessionId;
      row.createEl("h3", {
        text: this.p.sessionTitles[session] || "未命名对话",
      });
      const available = run.entries.filter(
        (e) => e.status === "applied",
      ).length;
      const uncertain = run.entries.some((e) =>
        ["pending", "undoing", "failed"].includes(e.status),
      );
      row.createDiv({
        cls: "vb-history-time",
        text: `${new Date(run.time).toLocaleString()} · ${run.entries.length} 次操作 · ${available} 项待撤销`,
      });
      row.createEl("p", {
        text: [
          ...new Set(
            run.entries.map((e) => (e.workspace ? "[外部] " : "") + e.path),
          ),
        ].join("、"),
      });
      if (uncertain)
        row.createEl("p", {
          cls: "vb-error-text",
          text: "存在失败或未确认记录，请在全部操作记录中检查原文和恢复副本；暂不整轮撤销。",
        });
      const preview = row.createEl("button", {
        text: available ? "预览撤销这一轮" : "本轮已无待撤销修改",
      });
      preview.disabled =
        !available || uncertain || this.p.running || this.p.preparing;
      const panel = row.createDiv();
      preview.onclick = async () => {
        const generation = ++this.generation;
        preview.disabled = true;
        panel.empty();
        panel.createEl("p", { text: "正在检查涉及的文件…" });
        try {
          const entries = await this.p.undoOperation(run.id, true, true);
          if (this.closed || generation !== this.generation) return;
          panel.empty();
          for (const entry of entries) {
            const d = panel.createEl("details");
            d.createEl("summary", {
              text: `${labels[entry.kind || "edit"]} · ${entry.destination ? entry.destination + " → " : ""}${entry.path}`,
            });
            d.addEventListener("toggle", () => {
              if (d.open && !d.dataset.loaded) {
                d.dataset.loaded = "true";
                renderDiff(d, { before: entry.after, after: entry.before });
              }
            });
          }
          panel.createEl("p", {
            cls: "vb-history-hint",
            text: "按相反顺序逐项恢复。执行中遇到冲突会停止，并保留已完成状态及恢复记录。",
          });
          const confirm = panel.createEl("button", {
            cls: "mod-warning",
            text: `确认撤销这一轮（${entries.length} 项）`,
          });
          confirm.onclick = async () => {
            confirm.disabled = true;
            try {
              const result = await this.p.undoOperation(run.id, true);
              new Notice(`已撤销 ${result.count} 项操作`);
              if (!this.closed) this.render();
            } catch (error) {
              if (!this.closed) {
                panel.createEl("p", {
                  cls: "vb-error-text",
                  text: error.message,
                });
                confirm.remove();
              }
            }
          };
        } catch (error) {
          if (!this.closed && generation === this.generation) {
            panel.empty();
            panel.createEl("p", { cls: "vb-error-text", text: error.message });
          }
        } finally {
          preview.disabled = false;
        }
      };
    }
    const all = c.createEl("button", { text: "全部操作记录与单项撤销" });
    all.onclick = () => {
      this.close();
      this.p.openChangeHistory();
    };
  }
  onClose() {
    this.closed = true;
    this.generation++;
    this.contentEl.empty();
  }
}
module.exports = { UndoHistory };
