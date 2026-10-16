const { Modal, Notice, Setting, FuzzySuggestModal } = require("obsidian");
class SkillPicker extends FuzzySuggestModal {
  constructor(app, items, choose) {
    super(app);
    this.items = items;
    this.choose = choose;
    this.setPlaceholder("选择本次任务使用的 Skill");
  }
  getItems() {
    return this.items;
  }
  getItemText(s) {
    return s.name;
  }
  onChooseItem(s) {
    this.choose(s);
  }
}
class WorkspacePanel extends Modal {
  constructor(app, p) {
    super(app);
    this.p = p;
    this.tab = "资料";
    this.generation = 0;
  }
  onOpen() {
    this.render();
  }
  async save(fn) {
    try {
      this.p.conversations.idle();
      await fn();
      await this.p.persist();
      this.render();
      this.p.refresh();
    } catch (e) {
      new Notice(e.message);
    }
  }
  render() {
    let c = this.contentEl;
    c.empty();
    c.addClass("vb-resource-panel", "vb-surface");
    c.createEl("h2", { text: "资料与 Skills" });
    const tabs = c.createDiv("vb-tabs");
    const panels = {};
    for (const label of ["资料", "Skills", "工作目录"]) {
      const button = tabs.createEl("button", { text: label });
      button.setAttribute("aria-pressed", String(this.tab === label));
      panels[label] = c.createDiv();
      panels[label].hidden = this.tab !== label;
      button.onclick = () => {
        this.tab = label;
        this.render();
      };
    }
    this.generation++;
    c = panels["资料"];
    c.createEl("p", {
      text: "授权目录默认只读。只读取文本文件，不执行目录中的程序。已发送给模型的资料不会随移除授权而从历史中消失。",
    });
    const input = c.createEl("input", {
      attr: {
        placeholder: "外部资料目录的绝对路径",
        "aria-label": "外部目录路径",
      },
    });
    const add = c.createEl("button", { text: "添加只读目录" });
    const choose = c.createEl("button", { text: "选择文件夹…" });
    choose.onclick = async () => {
      try {
        const electron = require("electron");
        const dialog = electron.remote?.dialog || electron.dialog;
        if (!dialog) {
          new Notice("当前环境不支持系统选择器，请在路径栏粘贴目录路径");
          input.focus();
          return;
        }
        const result = await dialog.showOpenDialog({
          properties: ["openDirectory"],
        });
        if (!result.canceled && result.filePaths[0])
          input.value = result.filePaths[0];
      } catch (e) {
        new Notice(e.message);
      }
    };
    add.onclick = () =>
      this.save(async () => {
        const root = await this.p.resources.resolve(input.value.trim());
        await this.p.resources.listRootCheck(root);
        this.p.settings.externalFolders = [
          ...new Set([...(this.p.settings.externalFolders || []), root]),
        ];
      });
    for (const r of this.p.resources.roots()) {
      const row = c.createDiv("vb-resource-row");
      row.createEl("code", { text: r.path });
      const browse = row.createEl("button", { text: "浏览" });
      browse.onclick = () =>
        this.browse(r.id, "").catch((e) => new Notice(e.message));
      const remove = row.createEl("button", { text: "移除授权" });
      remove.onclick = () =>
        this.save(async () => {
          this.p.settings.externalFolders =
            this.p.settings.externalFolders.filter((x) => x !== r.path);
          if (this.p.settings.resourceWorkspace === r.path)
            this.p.settings.resourceWorkspace = "";
        });
    }
    c = panels["工作目录"];
    new Setting(c)
      .setName("资料工作目录")
      .setDesc(
        "改变 Agent 优先检索的资料目录，默认只读；下方可另行开启文本写入。",
      )
      .addDropdown((d) => {
        d.addOption("", "当前笔记库（推荐）");
        for (const r of this.p.resources.roots()) d.addOption(r.path, r.path);
        d.setValue(this.p.settings.resourceWorkspace || "").onChange((v) =>
          this.save(async () => {
            this.p.settings.resourceWorkspace = v;
            this.p.settings.externalWriteEnabled = false;
          }),
        );
      });
    new Setting(c)
      .setName("允许外部工作目录写入（不推荐）")
      .setDesc(
        "默认关闭。开启后 Agent 可修改/创建文本文件，并记录操作供撤销。外部编辑器的未保存内容不在保护范围内；原文件保留在外部目录的 VaultBridge Recovery。",
      )
      .addToggle((t) =>
        t.setValue(!!this.p.settings.externalWriteEnabled).onChange((value) =>
          this.save(async () => {
            if (value && !this.p.settings.resourceWorkspace)
              throw Error("请先选择外部工作目录");
            this.p.settings.externalWriteEnabled = value;
          }),
        ),
      );
    const recovery = c.createEl("button", {
      text: "最近操作与撤销（含外部文件）",
    });
    recovery.onclick = () => this.p.openUndoHistory();
    const history = c.createEl("button", {
      text: "外部目录手动 Git 快照（可选）",
    });
    history.onclick = () => {
      try {
        this.p.openExternalHistory();
      } catch (e) {
        new Notice(e.message);
      }
    };
    c = panels["Skills"];
    c.createEl("h3", { text: "Skill 仓库" });
    new Setting(c)
      .setName("本地仓库路径")
      .setDesc(
        "支持仓库根目录的 SKILL.md，以及一级子目录中的 SKILL.md。选择 Skill 才会将说明加入模型上下文；不会自动执行脚本。",
      )
      .addText((t) =>
        t.setValue(this.p.settings.skillFolder || "").onChange((v) => {
          this.skillDraft = v;
        }),
      )
      .addButton((b) =>
        b.setButtonText("保存").onClick(() =>
          this.save(async () => {
            const root = (
              this.skillDraft ??
              this.p.settings.skillFolder ??
              ""
            ).trim();
            if (root)
              await this.p.resources.listRootCheck(
                await this.p.resources.resolve(root),
              );
            this.p.settings.skillFolder = root;
            this.p.selectedSkills.clear();
          }),
        ),
      );
    const use = c.createEl("button", { text: "选择 Skill" });
    use.onclick = () => this.p.pickSkill().catch((e) => new Notice(e.message));
    this.files = panels["资料"].createDiv("vb-resource-files");
    this.preview = panels["资料"].createDiv("vb-resource-preview");
  }
  async browse(id, path) {
    const generation = ++this.generation;
    const files = await this.p.resources.list(id, path);
    if (this.closed || generation !== this.generation) return;
    this.files.empty();
    this.preview.empty();
    this.files.createEl("h3", { text: path || "目录" });
    if (path) {
      const up = this.files.createEl("button", { text: "上级" });
      up.onclick = () =>
        this.browse(id, path.split("/").slice(0, -1).join("/")).catch(
          (e) => new Notice(e.message),
        );
    }
    for (const f of files) {
      const b = this.files.createEl("button", {
        text: (f.directory ? "▸ " : "") + f.path,
      });
      b.onclick = async () => {
        try {
          if (f.directory) await this.browse(id, f.path);
          else {
            const request = ++this.generation;
            const data = await this.p.resources.read(id, f.path);
            if (this.closed || request !== this.generation) return;
            this.preview.empty();
            this.preview.createEl("h3", { text: f.path });
            this.preview.createEl("pre", { text: data.text.slice(0, 12000) });
            const attach = this.preview.createEl("button", {
              text: "引用到当前对话",
            });
            attach.onclick = async () => {
              const refs = (this.p.externalReferences ||= []);
              if (!refs.some((r) => r.root === id && r.path === f.path))
                refs.push({ root: id, path: f.path });
              await this.p.persist();
              this.p.refresh();
              attach.textContent = "已引用";
              attach.disabled = true;
            };
          }
        } catch (e) {
          new Notice(e.message);
        }
      };
    }
  }
  onClose() {
    this.closed = true;
    this.generation++;
    this.contentEl.empty();
  }
}
module.exports = { WorkspacePanel, SkillPicker };
