const { Modal, Notice } = require("obsidian");
class GitHistoryModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.p = plugin;
    this.closed = false;
    this.limit = 100;
    this.previewGeneration = 0;
    this.activePanel = null;
  }
  onOpen() {
    const c = this.contentEl;
    c.addClass("vb-history", "vb-surface");
    c.createEl("h2", { text: "Git 检查点" });
    c.createEl("p", {
      text: "可选的手动整库快照及旧版历史。日常任务不再自动创建 Git 提交；请优先使用“最近操作与撤销”。此处整库回退会影响预览中列出的全部文件。",
    });
    const location = c.createEl("details");
    location.createEl("summary", { text: "存储位置与技术信息" });
    location.createEl("code", { text: this.p.gitHistory.directory });
    const button = c.createEl("button", { text: "手动保存检查点" });
    button.onclick = async () => {
      let reserved = false;
      try {
        this.p.conversations.idle();
        this.p.preparing = true;
        reserved = true;
        this.p.refresh();
        await this.p.gitHistory.checkpoint("手动检查点");
        await this.load();
      } catch (e) {
        new Notice(e.message);
      } finally {
        if (reserved) {
          this.p.preparing = false;
          this.p.refresh();
        }
      }
    };
    this.list = c.createDiv("vb-history-list");
    this.load().catch((e) => this.list.createEl("p", { text: e.message }));
  }
  async load() {
    const commits = await this.p.gitHistory.list(this.limit);
    if (this.closed) return;
    this.previewGeneration++;
    this.activePanel = null;
    this.list.empty();
    if (!commits.length)
      this.list.createEl("p", {
        text: "暂无手动检查点。可使用上方按钮保存；普通 Agent 任务使用操作日志撤销。",
      });
    for (const commit of commits) {
      const row = this.list.createEl("details", { cls: "vb-history-entry" });
      row.createEl("summary", {
        text: commit.label,
      });
      row.createEl("p", { text: new Date(commit.time).toLocaleString() });
      const technical = row.createEl("details");
      technical.createEl("summary", { text: "查看 Git 技术详情" });
      technical.createEl("code", { text: commit.id });
      const pre = technical.createEl("pre", {
        cls: "vb-git-diff",
        text: "展开后加载 Git diff…",
      });
      let loaded = false;
      technical.addEventListener("toggle", async () => {
        if (technical.open && !loaded) {
          loaded = true;
          try {
            const diff = await this.p.gitHistory.diff(commit.id);
            pre.textContent =
              diff.length > 120000
                ? diff.slice(0, 120000) +
                  "\n…界面仅显示前 120000 字符，完整 diff 可用 Git 查看。"
                : diff;
          } catch (e) {
            pre.textContent = e.message;
          }
        }
      });
      const preview = row.createEl("button", { text: "预览回退到此版本" });
      const panel = row.createDiv();
      preview.onclick = async () => {
        try {
          this.p.conversations.idle();
          const generation = ++this.previewGeneration;
          this.activePanel?.empty();
          this.activePanel = panel;
          panel.empty();
          const plan = await this.p.gitHistory.preview(commit.id);
          if (this.closed || generation !== this.previewGeneration) return;
          panel.createEl("p", {
            text: plan.paths.length + " 个文件将改变；回退前另存当前版本。",
          });
          panel.createEl("pre", {
            text: plan.paths
              .map(
                (p) =>
                  (!plan.target.has(p)
                    ? "保留到恢复目录"
                    : !plan.current.has(p)
                      ? "恢复文件"
                      : "替换内容") +
                  "  " +
                  p,
              )
              .join("\n"),
            cls: "vb-git-diff",
          });
          if (plan.paths.length) {
            const apply = panel.createEl("button", {
              text: "确认回退这 " + plan.paths.length + " 个文件",
            });
            apply.onclick = async () => {
              apply.disabled = true;
              try {
                await this.p.restoreGit(plan);
                new Notice("已回退，当前状态已备份");
                await this.load();
              } catch (e) {
                new Notice(e.message);
                apply.disabled = false;
              }
            };
          }
        } catch (e) {
          new Notice(e.message);
        }
      };
    }
    if (commits.length === this.limit) {
      const more = this.list.createEl("button", { text: "加载更多版本" });
      more.onclick = () => {
        this.limit += 100;
        this.load().catch((e) => new Notice(e.message));
      };
    }
  }
  onClose() {
    this.closed = true;
    this.previewGeneration++;
    this.activePanel = null;
    this.contentEl.empty();
  }
}
module.exports = { GitHistoryModal };
