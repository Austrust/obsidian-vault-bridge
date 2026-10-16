const { Modal, Notice } = require("obsidian");
const { connectionErrors } = require("../domain/connection-settings");
class ModelPicker extends Modal {
  constructor(app, p) {
    super(app);
    this.p = p;
    this.catalog = p.catalog || [];
  }
  onOpen() {
    const c = this.contentEl;
    c.addClass("vb-surface");
    c.createEl("h2", { text: "选择模型" });
    c.createEl("p", {
      text:
        "供应商：" +
        this.p.settings.provider +
        " · 当前：" +
        this.p.settings.model,
    });
    const input = c.createEl("input", {
      attr: { "aria-label": "模型 ID", placeholder: "搜索或输入模型 ID" },
    });
    const status = c.createEl("p", {
      cls: "na-muted",
      text: "近期配置来自本机记录。可读取 OpenCode 目录；目录登记不代表已验证远程鉴权。",
    });
    const refresh = c.createEl("button", { text: "读取模型目录" });
    const list = c.createDiv("vb-model-list");
    const history = [
      ...new Set([
        this.p.settings.model,
        ...(this.p.settings.modelHistory || []),
      ]),
    ];
    const items = () => [
      ...new Map(
        [
          ...history.map((id) => ({ id, name: id, recent: true })),
          ...this.catalog,
        ].map((m) => [m.id, m]),
      ).values(),
    ];
    const render = () => {
      list.empty();
      const filtered = items().filter((m) =>
        (m.id + " " + m.name).toLowerCase().includes(input.value.toLowerCase()),
      );
      for (const m of filtered.slice(0, 100)) {
        const b = list.createEl("button", {
          text: [
            m.id,
            m.id === this.p.settings.model ? "当前" : "",
            m.recent ? "近期使用" : m.configured ? "已配置" : "目录模型",
            m.reasoning ? "支持推理" : "",
            m.context ? "上下文 " + Math.round(m.context / 1000) + "K" : "",
          ]
            .filter(Boolean)
            .join(" · "),
        });
        b.onclick = () => {
          input.value = m.id;
          render();
        };
      }
      if (!filtered.length)
        list.createEl("p", {
          cls: "na-muted",
          text: "没有匹配项。可填写供应商提供的模型 ID，应用后在首次请求中验证。",
        });
      const error = connectionErrors({
        ...this.p.settings,
        model: input.value.trim() || this.p.settings.model,
      }).model;
      input.setAttribute("aria-invalid", String(!!error));
      save.disabled = !!error || !!this.busy;
      if (error) status.textContent = error;
    };
    const actions = c.createDiv("na-actions");
    const cancel = actions.createEl("button", { text: "取消" });
    cancel.onclick = () => this.close();
    const save = actions.createEl("button", {
      text: "应用模型",
      cls: "mod-cta",
    });
    refresh.onclick = async () => {
      refresh.disabled = true;
      this.busy = true;
      render();
      status.textContent = "正在读取 OpenCode 模型目录…";
      try {
        this.catalog = await this.p.availableModels();
        if (this.closed) return;
        status.textContent =
          this.catalog.length + " 个已登记模型 · 远程可用性尚未验证";
      } catch (e) {
        status.textContent = "目录读取失败：" + e.message;
      } finally {
        this.busy = false;
        if (!this.closed) {
          refresh.disabled = false;
          render();
        }
      }
    };
    save.onclick = async () => {
      const id = input.value.trim() || this.p.settings.model;
      this.busy = true;
      refresh.disabled = true;
      render();
      try {
        await this.p.configureConnection(
          {
            model: id,
            modelHistory: [...new Set([id, ...history])].slice(0, 20),
          },
          { connect: this.p.connection === "connected" },
        );
        this.close();
      } catch (e) {
        new Notice(e.message);
      } finally {
        this.busy = false;
        if (!this.closed) {
          refresh.disabled = false;
          render();
        }
      }
    };
    input.oninput = render;
    render();
    input.focus();
  }
  onClose() {
    this.closed = true;
    this.contentEl.empty();
  }
}
module.exports = { ModelPicker };
