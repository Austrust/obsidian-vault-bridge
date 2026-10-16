const { PluginSettingTab, Setting, Notice } = require("obsidian");
const {
  detectExecutable,
  credentialStatus,
} = require("../backend/setup-diagnostics");
const { connectionErrors } = require("../domain/connection-settings");
const {
  permissionDefaults,
  permissionLabels,
  permissionPreset,
  inferPreset,
} = require("../domain/permissions");
const connectionKeys = ["executable", "provider", "model", "baseURL"];
class Settings extends PluginSettingTab {
  constructor(app, p) {
    super(app, p);
    this.p = p;
    this.tab = "连接";
    this.generation = 0;
  }
  async save(fn) {
    try {
      await fn();
      await this.p.persist();
      this.p.refresh();
    } catch (e) {
      new Notice(e.message);
    }
  }
  display() {
    clearInterval(this.validationTimer);
    const c = this.containerEl;
    c.empty();
    c.addClass("vb-surface");
    this.generation++;
    c.createEl("h2", { text: "VaultBridge 设置" });
    c.createEl("p", {
      cls: "na-muted",
      text:
        (this.p.connection === "connected"
          ? "本地服务已连接"
          : "本地服务未连接") +
        " · " +
        this.p.settings.provider +
        " / " +
        this.p.settings.model,
    });
    const tabs = c.createDiv("vb-tabs");
    for (const label of ["连接", "对话", "权限", "历史", "资料"]) {
      const b = tabs.createEl("button", { text: label });
      b.setAttribute("aria-pressed", String(this.tab === label));
      b.onclick = () => {
        this.tab = label;
        this.display();
      };
    }
    ({
      连接: () => this.connection(c),
      对话: () => this.conversation(c),
      权限: () => this.permissions(c),
      历史: () => this.history(c),
      资料: () => this.resources(c),
    })[this.tab]();
  }
  connection(c) {
    this.connectionDraft ||= Object.fromEntries(
      connectionKeys.map((k) => [k, this.p.settings[k] || ""]),
    );
    this.keyDraft ??= this.p.apiKey || "";
    const draft = this.connectionDraft;
    const generation = this.generation;
    const busy = !!(this.p.running || this.p.preparing);
    const fields = new Map();
    const status = c.createDiv({
      cls: "vb-setup-diagnostics",
      text: "依次检查安装、供应商和凭据，再应用设置并测试本地连接。已验证 Windows / OpenCode 1.19.0。",
    });
    status.setAttribute("role", "status");
    const text = (parent, key, label) => {
      const setting = new Setting(parent).setName(label);
      setting.addText((t) => {
        t.inputEl.setAttribute("aria-label", label);
        t.setValue(draft[key]);
        fields.set(key, t.inputEl);
        t.onChange((v) => {
          draft[key] = v.trim();
          if (key === "provider") refreshCredential();
          validate();
        });
      });
      const error =
        setting.settingEl?.createDiv("vb-field-error") ||
        parent.createDiv("vb-field-error");
      error.setAttribute("role", "status");
      fields.set(key + "-error", error);
    };
    c.createEl("h3", { text: "1 · 检测安装" });
    text(c, "executable", "OpenCode 可执行文件");
    const detect = c.createEl("button", { text: "自动检测安装" });
    detect.disabled = busy;
    detect.onclick = async () => {
      this.detecting = true;
      detect.disabled = true;
      status.textContent = "正在查找可执行文件…";
      try {
        this.p.conversations.idle();
        const found = await detectExecutable(draft.executable);
        if (generation !== this.generation) return;
        draft.executable = found.executable;
        fields.get("executable").value = found.executable;
        status.textContent =
          "OpenCode " +
          found.version +
          (found.version === "1.19.0"
            ? " · 已验证版本"
            : " · 本版不支持，请选择 OpenCode 1.19.0");
        validate();
      } catch (e) {
        status.textContent = e.message;
      } finally {
        this.detecting = false;
        validate();
      }
    };
    c.createEl("h3", { text: "2 · 配置供应商与模型" });
    new Setting(c).setName("供应商模板").addDropdown((d) =>
      d
        .addOptions({
          deepseek: "DeepSeek",
          custom: "自定义 OpenAI-compatible",
        })
        .setValue(draft.provider === "deepseek" ? "deepseek" : "custom")
        .onChange((value) => {
          if (value === "deepseek") {
            draft.provider = "deepseek";
            draft.baseURL = "https://api.deepseek.com/v1";
          } else {
            draft.provider = "custom";
            draft.baseURL = "";
          }
          for (const k of ["provider", "baseURL"])
            fields.get(k).value = draft[k];
          refreshCredential();
          showModels(
            (this.p.catalog || []).filter((m) => m.provider === draft.provider),
          );
          validate();
        }),
    );
    text(c, "provider", "供应商 ID");
    text(c, "baseURL", "API Base URL");
    text(c, "model", "模型 ID");
    const catalog = c.createDiv("vb-model-list");
    const showModels = (items) => {
      catalog.empty();
      for (const m of items.slice(0, 100)) {
        const b = catalog.createEl("button", {
          text: m.id + (m.reasoning ? " · 推理" : ""),
        });
        b.onclick = () => {
          draft.model = m.id;
          fields.get("model").value = m.id;
          validate();
        };
      }
    };
    showModels(
      (this.p.catalog || []).filter((m) => m.provider === draft.provider),
    );
    c.createEl("p", {
      cls: "na-muted",
      text: "应用并测试后会读取 OpenCode 模型目录。目录登记不等于远程模型已验证，也可以输入供应商提供的模型 ID。",
    });
    c.createEl("h3", { text: "3 · 配置凭据" });
    const credential = c.createEl("p", {
      cls: "na-muted",
      text: "正在检查凭据来源…",
    });
    let credentialRequest = 0;
    const refreshCredential = () => {
      const request = ++credentialRequest;
      credential.textContent = "正在检查凭据来源…";
      void credentialStatus(draft.provider, this.keyDraft)
        .catch(() => "无法检查凭据来源，请检查 OpenCode 配置")
        .then((value) => {
          if (generation === this.generation && request === credentialRequest)
            credential.textContent = value;
        });
    };
    refreshCredential();
    new Setting(c)
      .setName("API Key（仅本次运行）")
      .setDesc("留空时复用 OpenCode 已保存凭据；不写入插件 data.json。")
      .addText((t) => {
        t.inputEl.type = "password";
        t.inputEl.setAttribute("aria-label", "API Key（仅本次运行）");
        t.setValue(this.keyDraft).onChange((v) => {
          this.keyDraft = v.trim();
          refreshCredential();
        });
      });
    c.createEl("h3", { text: "4 · 应用与测试" });
    const apply = c.createEl("button", {
      text: "应用并测试本地连接",
      cls: "mod-cta",
    });
    const save = c.createEl("button", { text: "仅保存设置" });
    const validate = () => {
      const errors = connectionErrors(draft);
      for (const key of connectionKeys) {
        fields.get(key)?.setAttribute("aria-invalid", String(!!errors[key]));
        const error = fields.get(key + "-error");
        if (error) error.textContent = errors[key] || "";
      }
      const running = !!(this.p.running || this.p.preparing);
      apply.disabled = save.disabled =
        running || Object.keys(errors).length > 0 || !!this.applying;
      detect.disabled = running || !!this.detecting;
    };
    const submit = async (connect) => {
      this.applying = true;
      validate();
      status.textContent = connect
        ? "正在应用设置并测试本地服务…"
        : "正在保存连接设置…";
      try {
        const items = await this.p.configureConnection(
          { ...draft },
          { apiKey: this.keyDraft, connect },
        );
        if (generation !== this.generation) return;
        status.textContent = connect
          ? "本地服务和工具连接正常。供应商鉴权与远程模型仍需首次请求验证。"
          : "设置已保存，下次连接生效。";
        showModels(items);
      } catch (e) {
        if (generation === this.generation)
          status.textContent = "未完成：" + e.message;
      } finally {
        this.applying = false;
        validate();
      }
    };
    apply.onclick = () => submit(true);
    save.onclick = () => submit(false);
    validate();
    this.validationTimer = setInterval(validate, 500);
    if (busy)
      c.createEl("p", {
        cls: "na-muted",
        text: "当前任务结束后可应用连接设置。",
      });
  }
  conversation(c) {
    c.createEl("h3", { text: "对话行为" });
    new Setting(c)
      .setName("自动连接")
      .setDesc("打开侧栏时启动本地服务，不发送模型请求。")
      .addToggle((t) =>
        t.setValue(this.p.settings.autoConnect !== false).onChange((value) =>
          this.save(async () => {
            this.p.settings.autoConnect = value;
            if (value) {
              this.p.autoConnectPaused = false;
              await this.p.autoConnect();
            }
          }),
        ),
      );
    new Setting(c)
      .setName("任务超时（秒）")
      .setDesc("60–3600 秒，默认 900；空闲时修改，下一轮生效。")
      .addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.min = "60";
        t.inputEl.max = "3600";
        t.setValue(String(this.p.settings.taskTimeoutSeconds || 900)).onChange(
          (v) =>
            this.save(async () => {
              this.p.conversations.idle();
              const n = Number(v);
              if (!Number.isInteger(n) || n < 60 || n > 3600)
                throw Error("超时需要是 60–3600 秒的整数");
              this.p.settings.taskTimeoutSeconds = n;
              this.p.conversations.timeoutMs = n * 1000;
            }),
        );
      });
    c.createEl("p", {
      text: "每个会话独立保存草稿、引用、选区和 Skills。编辑确认后才建立分支；文件修改不会随分支自动回退。",
    });
  }
  permissions(c) {
    c.createEl("p", {
      text: "允许、每次询问或拒绝 Agent 工具。规划模式额外禁止写入；询问仅批准一次，120 秒后自动拒绝。DataviewJS 和用户手动保存成果不受这些工具权限约束。",
    });
    new Setting(c).setName("权限预设").addDropdown((d) =>
      d
        .addOptions({
          custom: "自定义",
          readonly: "只读",
          standard: "标准：编辑允许，移动/删除拒绝",
          review: "所有操作每次询问",
        })
        .setValue(inferPreset(this.p.settings.permissions))
        .onChange((mode) =>
          this.save(async () => {
            if (mode === "custom") return;
            this.p.settings.permissions = permissionPreset(mode);
            this.display();
          }),
        ),
    );
    const groups = [
      [
        "笔记",
        [
          "active_note",
          "read_note",
          "search_notes",
          "patch_note",
          "create_note",
          "move_note",
          "rename_note",
          "delete_note",
        ],
      ],
      [
        "外部资料与 Skills",
        [
          "list_resources",
          "list_external",
          "read_external",
          "patch_external",
          "create_external",
          "read_skill_file",
        ],
      ],
      ["可视化", ["publish_visualization"]],
    ];
    for (const [label, keys] of groups) {
      const section = c.createEl("details");
      section.open = label === "笔记";
      section.createEl("summary", { text: label });
      for (const key of keys)
        new Setting(section).setName(permissionLabels[key]).addDropdown((d) =>
          d
            .addOptions({ allow: "允许", ask: "每次询问", deny: "拒绝" })
            .setValue(
              this.p.settings.permissions?.[key] || permissionDefaults[key],
            )
            .onChange((value) =>
              this.save(async () => {
                this.p.settings.permissions = {
                  ...this.p.settings.permissions,
                  [key]: value,
                };
                this.display();
              }),
            ),
        );
    }
  }
  history(c) {
    c.createEl("h3", { text: "操作恢复" });
    new Setting(c)
      .setName("最近操作与撤销")
      .setDesc("按轮次预览、核对后续修改并撤销；无需 Git，不扫描附件。")
      .addButton((b) =>
        b.setButtonText("查看最近操作").onClick(() => this.p.openUndoHistory()),
      );
    new Setting(c)
      .setName("归档旧修改记录")
      .setDesc(
        "保留最近 20 轮、至少 100 条及未确认记录；完整归档在 journal-archive。",
      )
      .addButton((b) =>
        b
          .setButtonText("归档")
          .onClick(() =>
            this.p.archiveOldJournal().catch((e) => new Notice(e.message)),
          ),
      );
    c.createEl("p", {
      text: "撤销新建会保留恢复副本。卸载前请保留插件目录的 data.json、runtime 和 journal-archive；只禁用插件不会删除记录。",
    });
    const advanced = c.createEl("details");
    advanced.createEl("summary", { text: "高级：手动 Git 快照与旧历史" });
    new Setting(advanced).setName("Git 可执行文件").addText((t) =>
      t.setValue(this.p.settings.gitExecutable || "git").onChange((v) =>
        this.save(async () => {
          this.p.settings.gitExecutable = v.trim() || "git";
        }),
      ),
    );
    new Setting(advanced)
      .setName("Git 检查点")
      .addButton((b) =>
        b.setButtonText("查看旧历史").onClick(() => this.p.openGitHistory()),
      );
  }
  resources(c) {
    c.createEl("h3", { text: "资料与成果" });
    new Setting(c)
      .setName("资料、Skills 与工作目录")
      .setDesc("外部目录默认只读；引用和 Skill 需显式选择。")
      .addButton((b) =>
        b
          .setButtonText("管理目录与 Skills")
          .onClick(() => this.p.openResources()),
      );
    new Setting(c).setName("成果保存目录").addText((t) =>
      t
        .setValue(this.p.settings.artifactFolder || "Agent Artifacts")
        .onChange((v) =>
          this.save(async () => {
            this.p.settings.artifactFolder = v.trim();
          }),
        ),
    );
    c.createEl("p", {
      text: "交互卡需要 Dataview 并启用 JavaScript 查询。保存后的卡片直接打开原笔记，不覆盖你的后续编辑。",
    });
  }
  hide() {
    this.generation++;
    if (this.validationTimer) clearInterval(this.validationTimer);
  }
}
module.exports = { Settings };
