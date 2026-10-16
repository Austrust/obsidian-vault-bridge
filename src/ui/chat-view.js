"use strict";
const {
  ItemView,
  MarkdownRenderer,
  Component,
  FuzzySuggestModal,
  Notice,
  setIcon,
  Menu,
} = require("obsidian");
const { shouldSend, conversationItems } = require("../presentation");
const { turnSummaries } = require("../presentation-turns");
const { renderDiff } = require("./change-history");
const { ComposerPicker } = require("./composer-picker");
const { showMenuAtTrigger } = require("./menu-position");
const { renderPermission, PermissionModal } = require("./permission-modal");
const VIEW = "note-agent-opencode";
class MentionModal extends FuzzySuggestModal {
  constructor(app, choose) {
    super(app);
    this.choose = choose;
    this.setPlaceholder("引用笔记或选择助手");
  }
  getItems() {
    return [
      { path: "DeepSeek", agent: true },
      ...this.app.vault.getMarkdownFiles(),
    ];
  }
  getItemText(f) {
    return f.agent ? "DeepSeek · 助手" : f.path;
  }
  onChooseItem(f) {
    this.choose(f.path, f.agent);
  }
}
class AgentView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.p = plugin;
    this.rows = new Map();
    this.cards = new Map();
    this.approvals = new Map();
    this.followTail = true;
    this.messageLimit = 100;
  }
  getViewType() {
    return VIEW;
  }
  getDisplayText() {
    return "VaultBridge";
  }
  getIcon() {
    return "bot";
  }
  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("na-root");
    root.addClass("vb-workspace");
    const header = root.createDiv("vb-header");
    const brand = header.createDiv("vb-brand");
    setIcon(brand.createSpan("vb-brand-mark"), "waypoints");
    brand.createSpan({ text: "VaultBridge" });
    const controls = header.createDiv("vb-header-actions");
    this.connection = this.button(
      controls,
      "连接",
      () => this.p.connect(),
      "vb-connection",
    );
    this.newButton = this.iconButton(controls, "新对话", "square-pen", () =>
      this.p.newSession(),
    );
    this.historyButton = this.iconButton(controls, "历史对话", "history", () =>
      this.p.chooseHistory(),
    );
    this.iconButton(controls, "更多选项", "ellipsis", (event) =>
      this.menu(event),
    );
    const sub = root.createDiv("vb-session-bar");
    this.title = sub.createDiv("na-session-title");
    this.status = sub.createDiv("vb-status");
    this.status.setAttribute("role", "status");
    this.branchBar = root.createDiv("vb-branch-bar");
    this.errorBox = root.createDiv("vb-error");
    this.errorBox.setAttribute("role", "alert");
    this.errorText = this.errorBox.createDiv("vb-error-text");
    this.button(
      this.errorBox,
      "重新连接",
      () => this.p.connect(),
      "vb-text-button",
    );
    this.button(
      this.errorBox,
      "设置",
      () => this.p.openSettings(),
      "vb-text-button",
    );
    this.button(
      this.errorBox,
      "关闭提示",
      () => {
        this.p.error = "";
        this.render();
      },
      "vb-text-button",
    );
    this.log = root.createDiv("na-log");
    this.log.setAttribute("aria-label", "对话内容");
    this.earlier = this.button(
      this.log,
      "加载更早消息",
      () => {
        const top = this.log.scrollTop;
        const height = this.log.scrollHeight;
        this.followTail = false;
        this.messageLimit += 100;
        this.render();
        this.log.scrollTop = top + this.log.scrollHeight - height;
      },
      "vb-text-button",
    );
    this.earlier.hidden = true;
    this.welcome = this.log.createDiv("vb-welcome");
    setIcon(this.welcome.createDiv("vb-welcome-icon"), "sparkles");
    this.welcome.createEl("h2", { text: "从一篇笔记开始" });
    this.welcome.createEl("p", {
      text: "整理思路、修改文档，或把知识变成可交互的视图。",
    });
    const suggestions = this.welcome.createDiv("vb-suggestions");
    for (const [icon, title, prompt] of [
      ["file-text", "梳理这篇笔记", "总结当前笔记，提炼关键观点和待办。"],
      ["pen-line", "一起打磨内容", "帮我改进当前笔记的表达，保留结构与原意。"],
      [
        "chart-no-axes-combined",
        "生成交互视图",
        "/visualize 根据当前笔记生成清晰的交互视图。",
      ],
    ]) {
      const b = this.button(
        suggestions,
        "",
        () => {
          this.p.attachActive();
          this.input.value = prompt;
          this.p.draft = prompt;
          void this.p.persist().catch((e) => this.p.fail(e));
          this.resizeInput();
          this.input.focus();
        },
        "vb-suggestion",
      );
      setIcon(b.createSpan(), icon);
      b.createSpan({ text: title });
      setIcon(b.createSpan("vb-suggestion-arrow"), "arrow-up-right");
    }
    this.jump = this.button(
      root,
      "回到最新",
      () => {
        const approval = this.p.pendingApprovals?.[0];
        if (approval) {
          this.expandApproval(approval);
          return;
        }
        this.followTail = true;
        this.scrollToEnd();
      },
      "vb-jump",
    );
    this.jump.hidden = true;
    this.log.addEventListener("scroll", () => {
      if (this.tailScrollPending) return;
      const size = this.log.clientWidth + ":" + this.log.clientHeight;
      if (this.followTail && this.logSize && this.logSize !== size) {
        this.scrollToEnd();
        return;
      }
      this.logSize = size;
      this.followTail =
        this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 72;
      this.jump.hidden = this.followTail;
    });
    this.aux = this.log.createDiv("vb-turn-notices");
    this.aux.append(this.errorBox);
    this.queueBox = this.aux.createDiv("vb-queue");
    this.approvalBox = this.aux.createDiv("vb-approvals");
    this.changeBox = root.createDiv("na-changes");
    const compose = root.createDiv("vb-composer");
    this.compose = compose;
    this.context = compose.createDiv("na-context");
    this.input = compose.createEl("textarea", {
      attr: {
        placeholder: "继续讨论，@ 引用笔记，/ 查看操作…",
        rows: "2",
        "aria-label": "Agent 指令",
      },
    });
    this.input.value = this.p.draft || "";
    this.picker = new ComposerPicker(this, compose);
    this.input.addEventListener("input", () => {
      this.p.draft = this.input.value;
      this.resizeInput();
      this.picker.update();
      clearTimeout(this.draftTimer);
      this.draftTimer = setTimeout(
        () => this.p.persist().catch((e) => this.p.fail(e)),
        500,
      );
    });
    this.input.addEventListener("keydown", (event) => {
      if (this.picker.key(event)) return;
      if (shouldSend(event)) {
        event.preventDefault();
        if (!event.repeat) this.submit().catch((e) => this.p.fail(e));
      }
    });
    const footer = compose.createDiv("vb-composer-footer");
    const attach = footer.createDiv("vb-compose-actions");
    this.iconButton(attach, "添加引用与工具", "plus", (event) =>
      this.addMenu(event),
    );
    this.mode = this.button(
      footer,
      "Agent",
      (event) => this.modeMenu(event),
      "vb-mode",
    );
    this.model = this.button(
      footer,
      "",
      () => this.p.chooseModel(),
      "vb-model",
    );
    this.send = this.iconButton(
      footer,
      "发送",
      "arrow-up",
      () =>
        (this.p.running || this.p.preparing) && !this.input.value.trim()
          ? this.p.stop()
          : this.submit(),
      "vb-send",
    );
    this.interrupt = this.button(
      root,
      "立即引导：停止当前轮并发送",
      async () => {
        const text = this.input.value.trim();
        if (!text) return;
        this.input.value = "";
        this.p.draft = "";
        this.resizeInput();
        try {
          await this.p.steer(text);
        } catch (error) {
          if (!this.input.value) {
            this.input.value = text;
            this.p.draft = text;
            await this.p.persist();
          }
          this.resizeInput();
          throw error;
        }
      },
      "vb-steer",
    );
    const hint = root.createDiv("vb-composer-hint");
    hint.createSpan({ text: "Enter 发送 · Shift+Enter 换行" });
    this.registerInterval?.(
      setInterval(() => {
        if (this.p.running || this.p.preparing) this.renderStatus();
      }, 1000),
    );
    this.fitStatusBar();
    const win = root.ownerDocument.defaultView;
    if (win.ResizeObserver) {
      const observer = new win.ResizeObserver(() => this.fitStatusBar());
      observer.observe(root);
      const status = root.ownerDocument.querySelector(".status-bar");
      if (status) observer.observe(status);
      this.register(() => observer.disconnect());
    }
    this.registerDomEvent(win, "resize", () => this.fitStatusBar());
    this.registerDomEvent(root.ownerDocument, "selectionchange", () => {
      if (root.ownerDocument.getSelection()?.isCollapsed) this.render();
    });
    this.render();
    void this.p.autoConnect();
  }
  button(parent, label, fn, cls = "") {
    const b = parent.createEl("button", { text: label, cls });
    b.addEventListener("click", (event) =>
      Promise.resolve()
        .then(() => fn(event))
        .catch((e) => this.p.fail(e)),
    );
    return b;
  }
  expandApproval(approval) {
    const record = this.approvals.get(approval);
    if (!record || (record.modal && !record.modal.closed)) return;
    record.modal = new PermissionModal(
      this.app,
      approval.request,
      approval.finish,
    );
    record.modal.open();
  }
  iconButton(parent, label, icon, fn, cls = "") {
    const b = this.button(parent, "", fn, "vb-icon-button " + cls);
    b.setAttribute("aria-label", label);
    b.setAttribute("title", label);
    setIcon(b, icon);
    return b;
  }
  showMenu(event, groups) {
    const menu = new Menu();
    groups.forEach((group, index) => {
      if (index) menu.addSeparator();
      for (const [title, icon, fn, disabled = false] of group)
        menu.addItem((item) =>
          item
            .setTitle(title)
            .setIcon(icon)
            .setDisabled(disabled)
            .onClick(() =>
              Promise.resolve()
                .then(fn)
                .catch((e) => new Notice(e.message)),
            ),
        );
    });
    showMenuAtTrigger(menu, event);
  }
  addMenu(event) {
    this.showMenu(event, [
      [
        ["引用笔记", "at-sign", () => this.pickMention()],
        ["附加当前笔记或选区", "paperclip", () => this.p.attachActive()],
        ["外部资料", "folder-open", () => this.p.openResources()],
        ["选择 Skill", "sparkles", () => this.p.pickSkill()],
      ],
      [
        [
          "生成可视化",
          "chart-no-axes-combined",
          () => {
            this.input.value =
              "/visualize " + this.input.value.replace(/^\/visualize\s*/, "");
            this.p.draft = this.input.value;
            this.resizeInput();
            this.input.focus();
            return this.p.persist();
          },
        ],
      ],
    ]);
  }
  modeMenu(event) {
    const busy = !!(this.p.running || this.p.preparing);
    this.showMenu(event, [
      [
        ["执行 · 按权限修改文件", "bot", () => this.setMode("agent"), busy],
        [
          "规划 · 只读分析和制定方案",
          "list-checks",
          () => this.setMode("plan"),
          busy,
        ],
      ],
    ]);
  }
  async setMode(mode) {
    this.p.conversations.idle();
    this.p.settings.agentMode = mode;
    await this.p.persist();
    this.render();
  }
  menu(event) {
    const busy = !!(this.p.running || this.p.preparing);
    const lastUser = [...this.p.transcript]
      .reverse()
      .find((m) => m.role === "user");
    this.showMenu(event, [
      [
        [
          "复制整个对话",
          "copy",
          () =>
            this.copyText(
              this.p.transcript
                .filter((m) => m.text)
                .map(
                  (m) =>
                    "## " +
                    (m.role === "user" ? "你" : "VaultBridge") +
                    "\n\n" +
                    m.text,
                )
                .join("\n\n"),
            ),
          !this.p.transcript.length,
        ],
        [
          "从当前对话创建分支",
          "git-branch",
          () => this.p.conversations.forkAt(),
          busy || !this.p.sessionId,
        ],
        [
          "编辑上一条指令",
          "pencil",
          () => this.beginMessageEdit(lastUser.id),
          busy || !lastUser,
        ],
      ],
      [
        ["审阅文件变更", "files", () => this.p.openReview()],
        ["最近操作与撤销", "undo-2", () => this.p.openUndoHistory(), busy],
      ],
      [
        ["资料与 Skills", "folder-open", () => this.p.openResources()],
        ["连接与设置", "settings-2", () => this.p.openSettings()],
        [
          "体验交互卡片",
          "chart-no-axes-combined",
          () => this.p.addExample(),
          busy,
        ],
        ["断开连接", "unplug", () => this.p.disconnect()],
      ],
    ]);
  }
  renderStatus() {
    const busy = this.p.running || this.p.preparing;
    const elapsed =
      busy && this.p.turnStartedAt
        ? Math.floor((Date.now() - this.p.turnStartedAt) / 1000)
        : 0;
    this.status.textContent =
      (this.p.pendingApprovals?.length
        ? "等待批准"
        : this.p.status || "准备就绪") +
      (elapsed ? " · " + elapsed + " 秒" : "");
    this.status.classList.toggle("is-busy", !!busy);
  }
  beginMessageEdit(id) {
    if (this.p.running || this.p.preparing) return;
    const row = this.rows.get(id);
    if (!row || row.editing) return;
    row.editing = true;
    row.body.empty();
    const input = row.body.createEl("textarea", {
      cls: "vb-message-edit",
      attr: { "aria-label": "编辑指令" },
    });
    input.value = row.message.text || "";
    row.body.createEl("p", {
      cls: "na-muted",
      text: "确认后创建对话分支并发送；文件变更保持原状。",
    });
    const actions = row.body.createDiv("na-actions");
    this.button(actions, "取消", () => {
      row.editing = false;
      row.text = null;
      this.render();
    });
    const confirm = this.button(
      actions,
      "创建分支并发送",
      async () => {
        if (!input.value.trim()) return;
        confirm.disabled = true;
        try {
          await this.p.editMessage(id, input.value.trim());
        } catch (error) {
          new Notice(error.message);
          confirm.disabled = false;
        }
      },
      "mod-cta",
    );
    input.focus();
  }
  resizeInput() {
    this.input.style.height = "auto";
    this.input.style.height =
      Math.min(
        this.contentEl.clientHeight < 480 ? 80 : 140,
        Math.max(52, this.input.scrollHeight),
      ) + "px";
    this.updateSend();
  }
  updateSend() {
    const busy = this.p.running || this.p.preparing;
    this.send.disabled = !!this.queuing || (!busy && !this.input.value.trim());
    const hasText = !!this.input.value.trim();
    if (this.interrupt) this.interrupt.hidden = !busy || !hasText;
    if (this.stopButton) this.stopButton.hidden = !busy;
    this.send.setAttribute(
      "aria-label",
      busy ? (hasText ? "加入队列" : "停止生成") : "发送",
    );
    this.send.setAttribute(
      "title",
      busy ? (hasText ? "加入队列" : "停止生成") : "发送",
    );
    const icon = busy && !hasText ? "square" : "arrow-up";
    if (this.busyIcon !== icon) {
      setIcon(this.send, icon);
      this.busyIcon = icon;
    }
  }
  pickMention(removeAt = false) {
    new MentionModal(this.app, (path, agent) => {
      if (removeAt) this.input.value = this.input.value.replace(/@$/, "");
      if (agent) this.input.value = "@DeepSeek " + this.input.value;
      else this.p.mentions.add(path);
      this.p.draft = this.input.value;
      void this.p.persist().catch((e) => this.p.fail(e));
      this.renderContext();
      this.resizeInput();
      this.input.focus();
    }).open();
  }
  async submit() {
    const original = this.input.value;
    const text = original.trim();
    if (!text) return;
    const commands = {
      "/skills": () => this.p.pickSkill(),
      "/resources": () => this.p.openResources(),
      "/history": () => this.p.chooseHistory(),
      "/new": () => this.p.newSession(),
      "/stop": () => this.p.stop(),
    };
    if (commands[text]) {
      if (this.commanding) return;
      this.commanding = true;
      try {
        await commands[text]();
        if (this.input.value === original) {
          this.input.value = "";
          this.p.draft = "";
          await this.p.persist();
        }
      } finally {
        this.commanding = false;
      }
      this.resizeInput();
      return;
    }
    if (this.p.running || this.p.preparing) {
      if (this.queuing) return;
      this.queuing = true;
      this.updateSend();
      try {
        await this.p.turnQueue.add(text);
        if (this.input.value === original) {
          this.input.value = "";
          this.p.draft = "";
        }
        await this.p.persist();
      } finally {
        this.queuing = false;
        this.resizeInput();
      }
      return;
    }
    this.input.value = "";
    this.p.draft = "";
    this.resizeInput();
    this.followTail = true;
    try {
      await this.p.send(text);
    } catch (error) {
      if (!this.input.value) {
        this.input.value = text;
        this.p.draft = text;
        await this.p.persist();
      }
      this.resizeInput();
      throw error;
    }
  }
  renderQueue() {
    if (!this.queueBox) return;
    const entries = (this.p.queue || []).filter(
      (x) => x.sessionId === this.p.sessionId,
    );
    const key = JSON.stringify([entries, this.p.turnQueue?.paused]);
    if (this.queueKey === key) return;
    this.queueKey = key;
    this.queueBox.empty();
    if (!entries.length) return;
    this.queueBox.createDiv({
      text: `待发送 ${entries.length} 条 · ${this.p.turnQueue?.paused ? "已暂停" : "本轮完成后发送"}`,
    });
    for (const e of entries) {
      const row = this.queueBox.createDiv("vb-queue-row");
      row.createSpan({ text: (e.attemptFailed ? "需检查 · " : "") + e.text });
      this.button(row, e.attemptFailed ? "移除已尝试任务" : "取消", () =>
        this.p.turnQueue.remove(e.id),
      );
    }
    this.button(this.queueBox, "继续队列", () => this.p.turnQueue.resume());
    this.button(this.queueBox, "暂停", () => this.p.turnQueue.pause());
  }
  renderContext() {
    if (!this.context) return;
    const signature = JSON.stringify([
      [...this.p.mentions],
      this.p.selection,
      [...(this.p.selectedSkills || [])],
      this.p.externalReferences || [],
    ]);
    if (this.contextSignature === signature) return;
    this.contextSignature = signature;
    this.context.empty();
    for (const path of this.p.mentions) {
      const chip = this.button(
        this.context,
        "",
        () => {
          this.p.mentions.delete(path);
          if (this.p.selection?.path === path) this.p.selection = null;
          this.renderContext();
          void this.p.persist().catch((e) => this.p.fail(e));
        },
        "vb-context-chip",
      );
      chip.setAttribute("title", path + " · 点击移除");
      setIcon(chip.createSpan(), "file-text");
      chip.createSpan({ text: path.split("/").pop() });
      setIcon(chip.createSpan(), "x");
    }
    for (const id of this.p.selectedSkills || [])
      this.button(
        this.context,
        "Skill: " + id.split("/")[0],
        () => {
          this.p.selectedSkills.delete(id);
          this.renderContext();
          void this.p.persist().catch((e) => this.p.fail(e));
        },
        "vb-context-chip",
      );
    for (const ref of this.p.externalReferences || [])
      this.button(
        this.context,
        "外部：" + ref.path.split("/").pop(),
        () => {
          this.p.externalReferences = this.p.externalReferences.filter(
            (r) => r !== ref,
          );
          this.renderContext();
          return this.p.persist();
        },
        "vb-context-chip",
      );
    if (this.p.selection)
      this.context.createSpan({ text: "已附加选区", cls: "vb-selection-chip" });
  }
  fitStatusBar() {
    const root = this.contentEl;
    const bar = root.ownerDocument.querySelector(".status-bar");
    let overlap = 0;
    if (bar) {
      const a = root.getBoundingClientRect(),
        b = bar.getBoundingClientRect();
      if (
        b.width &&
        b.height &&
        a.right > b.left &&
        a.left < b.right &&
        a.bottom > b.top &&
        a.top < b.bottom
      )
        overlap = Math.min(b.height, a.bottom - b.top);
    }
    root.style.setProperty("--na-statusbar-space", overlap + "px");
    root.dataset.compact = String(root.clientHeight < 480);
    this.scrollToEnd();
  }
  scrollToEnd() {
    if (!this.followTail || this.tailScrollPending) return;
    this.tailScrollPending = true;
    this.contentEl.ownerDocument.defaultView.requestAnimationFrame(() => {
      this.tailScrollPending = false;
      if (this.log)
        this.logSize = this.log.clientWidth + ":" + this.log.clientHeight;
      if (
        this.followTail &&
        this.log &&
        this.contentEl.ownerDocument.getSelection()?.isCollapsed
      )
        this.log.scrollTop = this.log.scrollHeight;
    });
  }
  render() {
    if (!this.log) return;
    const busy = this.p.running || this.p.preparing;
    this.title.textContent = this.p.sessionTitle || "新对话";
    const parent = this.p.sessionMeta?.[this.p.sessionId]?.parent;
    if (this.branchParent !== parent) {
      this.branchParent = parent;
      this.branchBar.empty();
      if (parent)
        this.button(
          this.branchBar,
          "来自：" + (this.p.sessionTitles[parent] || "原对话"),
          () => this.p.restore(parent),
        );
    }
    for (const b of this.branchBar.querySelectorAll("button"))
      b.disabled = busy;
    this.renderStatus();
    this.newButton.disabled = busy;
    this.historyButton.disabled = busy;
    this.model.disabled = busy;
    const connection = this.p.connection || "disconnected";
    this.connection.textContent = {
      connected: "已连接",
      connecting: "连接中",
      error: "重连",
      disconnected: "连接",
    }[connection];
    this.connection.dataset.state = connection;
    this.connection.disabled = connection === "connecting";
    this.model.textContent = (this.p.settings?.model || "选择模型").replace(
      /^deepseek-/,
      "DeepSeek ",
    );
    this.model.setAttribute("title", "选择模型");
    if (this.mode) {
      this.mode.textContent =
        this.p.settings.agentMode === "plan" ? "规划 ▾" : "执行 ▾";
      this.mode.disabled = busy;
    }
    this.errorBox.hidden = !this.p.error;
    this.errorText.textContent = this.p.error || "";
    this.renderQueue();
    const approvals = this.p.pendingApprovals || [];
    this.jump.textContent = approvals.length ? "待批准 · 查看请求" : "回到最新";
    for (const [approval, view] of this.approvals)
      if (!approvals.includes(approval)) {
        view.dispose();
        if (view.modal && !view.modal.closed) view.modal.close();
        view.el.remove();
        this.approvals.delete(approval);
      }
    for (const approval of approvals)
      if (!this.approvals.has(approval)) {
        const el = this.approvalBox.createDiv();
        this.approvals.set(approval, {
          el,
          ...renderPermission(el, approval.request, approval.finish, () =>
            this.expandApproval(approval),
          ),
        });
      }
    this.updateSend();
    this.renderContext();
    if (this.renderedSession !== this.p.sessionId) {
      this.renderedSession = this.p.sessionId;
      this.messageLimit = 100;
      this.messageCount = undefined;
    }
    const allMessages = conversationItems([
      ...this.p.transcript,
      ...(this.p.pendingMessage ? [this.p.pendingMessage] : []),
    ]);
    if (
      this.messageCount !== undefined &&
      !this.followTail &&
      allMessages.length > this.messageCount
    )
      this.messageLimit += allMessages.length - this.messageCount;
    this.messageCount = allMessages.length;
    const messages = allMessages.slice(-this.messageLimit);
    this.earlier.hidden = allMessages.length <= this.messageLimit;
    this.earlier.textContent =
      "加载更早消息（剩余 " +
      Math.max(0, allMessages.length - this.messageLimit) +
      "）";
    this.welcome.hidden = messages.length > 0;
    const wanted = new Set(messages.map((m) => m.id));
    const reviewKey = JSON.stringify([
      this.p.sessionId,
      messages.map((m) => [m.id, m.runId, m.kind]),
      this.p.journal.map((e) => [e.id, e.status]),
    ]);
    if (reviewKey !== this.reviewKey) {
      this.reviewKey = reviewKey;
      this.turnSummaries = turnSummaries(
        allMessages,
        this.p.journal,
        this.p.sessionId,
      );
    }
    for (const [id, row] of this.rows)
      if (!wanted.has(id)) {
        row.revision++;
        row.component?.unload();
        if (row.component) this.removeChild(row.component);
        row.el.remove();
        this.rows.delete(id);
      }
    let anchor = this.welcome;
    for (const m of messages) {
      let row = this.rows.get(m.id);
      if (!row) {
        row = m.kind === "work" ? this.createWork(m) : this.createMessage(m);
        this.rows.set(m.id, row);
      }
      if (row.el.previousElementSibling !== anchor)
        this.log.insertBefore(row.el, anchor.nextSibling);
      anchor = row.el;
      if (m.kind === "work") {
        this.renderWork(
          row,
          m,
          busy &&
            messages
              .slice(messages.indexOf(m) + 1)
              .every((x) => x.role !== "user"),
        );
        continue;
      }
      row.message = m;
      const kind =
        m.kind || (m.role === "user" ? "user" : m.done ? "answer" : "draft");
      row.label.textContent =
        {
          user: "你",
          answer: "VaultBridge",
          draft: "正在回复",
          error: "回复已中断",
        }[kind] || "VaultBridge";
      row.copy.disabled = !m.text;
      if (row.edit) row.edit.disabled = busy || !!m.localPending;
      this.renderMessageBody(row, m, kind);
      const summary = this.turnSummaries.get(m.id);
      if (row.review) row.review.hidden = !summary;
      if (summary) {
        if (!row.review)
          row.review = this.button(
            row.el,
            "",
            () => this.p.openReview(row.message.runId),
            "vb-turn-review",
          );
        row.review.hidden = false;
        row.review.textContent =
          `审阅本轮 · ${summary.files} 个文件 · +${summary.plus} −${summary.minus}` +
          (summary.undone ? " · 已撤销" : "");
      }
    }
    const visibleRuns = new Set(messages.map((m) => m.runId).filter(Boolean));
    const allRuns = new Set(allMessages.map((m) => m.runId).filter(Boolean));
    const artifacts = this.p.artifacts.filter(
      (a) =>
        a.sessionId === this.p.sessionId &&
        (!a.runId || !allRuns.has(a.runId) || visibleRuns.has(a.runId)),
    );
    for (const a of artifacts) if (!this.cards.has(a.id)) this.mountCard(a);
    const cardAnchors = new Map();
    for (const a of artifacts) {
      const card = this.cards.get(a.id);
      const owner =
        a.runId &&
        [...messages]
          .reverse()
          .find((m) => m.runId === a.runId && this.rows.has(m.id));
      const after =
        cardAnchors.get(a.runId) || (owner && this.rows.get(owner.id).el);
      if (after) {
        this.log.insertBefore(card.el, after.nextSibling);
        cardAnchors.set(a.runId, card.el);
      } else this.log.append(card.el);
      card.save.textContent = a.savedPath ? "打开已保存笔记" : "保存到笔记";
    }
    for (const [id, card] of this.cards)
      if (!artifacts.some((a) => a.id === id)) {
        card.component?.unload();
        if (card.component) this.removeChild(card.component);
        card.el.remove();
        this.cards.delete(id);
      }
    this.renderChanges();
    this.log.append(this.aux);
    this.scrollToEnd();
  }
  createMessage(m) {
    const el = this.log.createDiv("na-message " + m.role);
    const head = el.createDiv("na-message-header");
    const label = head.createDiv("na-role");
    const row = {
      el,
      label,
      body: el.createDiv("na-body"),
      text: null,
      revision: 0,
      message: m,
      component: new Component(),
    };
    this.addChild(row.component);
    row.copy = this.iconButton(
      head,
      "复制 Markdown",
      "copy",
      () => this.copyText(row.message.text || ""),
      "vb-copy",
    );
    if (m.role === "user")
      row.edit = this.iconButton(
        head,
        "编辑指令",
        "pencil",
        () => this.beginMessageEdit(row.message.id),
        "vb-copy",
      );
    return row;
  }
  createWork(m) {
    const el = this.log.createEl("details", { cls: "vb-work" });
    const summary = el.createEl("summary", { cls: "vb-work-summary" });
    const mark = summary.createSpan("vb-work-mark");
    setIcon(mark, "circle-check");
    const label = summary.createSpan();
    const chevron = summary.createSpan("vb-work-chevron");
    setIcon(chevron, "chevron-down");
    const content = el.createDiv("vb-work-content");
    const thinking = content.createEl("details", { cls: "na-thinking" });
    thinking.createEl("summary", { text: "思考过程" });
    const reasoning = thinking.createDiv("na-reasoning");
    this.iconButton(
      thinking,
      "复制思考",
      "copy",
      () => this.copyText(this.rows.get(m.id)?.message.reasoning || ""),
      "vb-copy",
    );
    const preamble = content.createDiv("vb-preamble");
    const tools = content.createDiv("vb-tools");
    return {
      el,
      label,
      mark,
      thinking,
      reasoning,
      preamble,
      tools,
      toolRows: new Map(),
      message: m,
      revision: 0,
    };
  }
  renderWork(row, m, busy) {
    row.message = m;
    const active = busy;
    row.el.classList.toggle("is-active", active);
    row.label.textContent = active
      ? "正在思考与执行"
      : m.toolCalls.some((t) => t.status === "error")
        ? "执行遇到问题"
        : m.toolCalls.length
          ? `已完成 ${m.toolCalls.length} 个步骤`
          : "已思考";
    row.thinking.hidden = !m.reasoning;
    if (row.reasoning.textContent !== m.reasoning)
      row.reasoning.textContent = m.reasoning;
    row.preamble.hidden = !m.text;
    if (row.preamble.textContent !== m.text) row.preamble.textContent = m.text;
    const wanted = new Set();
    for (const tool of m.toolCalls) {
      wanted.add(tool.id);
      let t = row.toolRows.get(tool.id);
      if (!t) {
        const el = row.tools.createEl("details", { cls: "vb-tool" });
        const summary = el.createEl("summary");
        const icon = summary.createSpan("vb-tool-icon");
        const names = summary.createDiv("vb-tool-names");
        const label = names.createSpan("vb-tool-label");
        const path = names.createSpan("vb-tool-path");
        const state = summary.createSpan("vb-tool-state");
        const body = el.createDiv("vb-tool-details");
        t = { el, icon, label, path, state, body };
        row.toolRows.set(tool.id, t);
      }
      t.label.textContent = tool.label;
      t.path.textContent = tool.path;
      t.path.hidden = !tool.path;
      t.state.textContent =
        tool.status === "completed"
          ? "完成"
          : tool.status === "error"
            ? "失败"
            : "进行中";
      t.el.dataset.state = tool.status;
      setIcon(
        t.icon,
        tool.status === "error"
          ? "circle-alert"
          : tool.status === "completed"
            ? "check"
            : "loader-circle",
      );
      const detail =
        tool.error ||
        "参数\n" +
          JSON.stringify(tool.input, null, 2) +
          (tool.output ? "\n\n结果\n" + tool.output : "");
      if (t.body.textContent !== detail) t.body.textContent = detail;
    }
    for (const [id, t] of row.toolRows)
      if (!wanted.has(id)) {
        t.el.remove();
        row.toolRows.delete(id);
      }
  }
  async copyText(text) {
    // Desktop Obsidian exposes Electron's clipboard without browser focus/permission prompts.
    const clipboard = require("electron").clipboard;
    if (clipboard?.writeText) clipboard.writeText(text);
    else
      await this.contentEl.ownerDocument.defaultView.navigator.clipboard.writeText(
        text,
      );
    new Notice("已复制");
  }
  renderMessageBody(row, m, kind) {
    if (row.editing) return;
    if (row.text === m.text && row.done === m.done && row.kind === kind) return;
    // Polling must not destroy text that the user is currently selecting.
    const selection = row.body.ownerDocument.getSelection();
    if (
      selection &&
      !selection.isCollapsed &&
      (row.body.contains(selection.anchorNode) ||
        row.body.contains(selection.focusNode))
    )
      return;
    row.text = m.text;
    row.done = m.done;
    row.kind = kind;
    const revision = ++row.revision;
    const host = row.body.ownerDocument.createElement("div");
    host.className =
      kind === "user" ? "na-plain" : "na-markdown markdown-rendered";
    const component = new Component();
    this.addChild(component);
    const apply = () => {
      if (row.revision !== revision || !row.el.isConnected) {
        component.unload();
        this.removeChild(component);
        return;
      }
      const selected = row.body.ownerDocument.getSelection();
      if (
        selected &&
        !selected.isCollapsed &&
        (row.body.contains(selected.anchorNode) ||
          row.body.contains(selected.focusNode))
      ) {
        row.text = null;
        component.unload();
        this.removeChild(component);
        return;
      }
      row.component.unload();
      this.removeChild(row.component);
      row.component = component;
      row.body.replaceChildren(host);
      this.scrollToEnd();
    };
    if (kind === "user") {
      host.textContent = m.text;
      apply();
      return;
    }
    const markdown = (m.text || "").replace(
      /^(`{3,}|~{3,})(dataviewjs|dataview)\b/gm,
      "$1javascript",
    );
    MarkdownRenderer.render(
      this.app,
      markdown,
      host,
      (m.sourcePath || "") + "?no-dataview",
      component,
    )
      .then(() => {
        for (const table of host.querySelectorAll("table")) {
          const wrap = host.ownerDocument.createElement("div");
          wrap.className = "na-table-scroll";
          wrap.setAttribute("tabindex", "0");
          table.replaceWith(wrap);
          wrap.append(table);
        }
        apply();
      })
      .catch(() => {
        host.className = "na-plain";
        host.textContent = m.text;
        apply();
      });
  }
  mountCard(a) {
    const el = this.log.createDiv("na-artifact");
    el.createEl("h4", { text: a.title });
    const controls = el.createDiv("na-actions");
    const body = el.createDiv("na-card");
    const component = new Component();
    this.addChild(component);
    const record = { el, body, component };
    this.cards.set(a.id, record);
    const status = el.createDiv({ cls: "na-muted", text: "待运行" });
    const run = this.button(controls, "运行", async () => {
      run.disabled = true;
      status.textContent = "正在运行…";
      try {
        if (!this.p.dataview())
          throw Error("请安装 Dataview，并启用 JavaScript 查询");
        component.unload();
        component.load();
        body.empty();
        await this.p
          .dataview()
          .executeJs(a.code, body, component, a.sourcePath || "");
        status.textContent = body.querySelector(
          ".dataview-error, .block-language-dataview-error",
        )
          ? "运行失败，请检查卡片内的错误信息"
          : "已运行";
        run.textContent = "重新运行";
      } catch (e) {
        status.textContent = "运行失败：" + e.message;
      } finally {
        run.disabled = false;
      }
    });
    record.save = this.button(controls, "保存到笔记", async () => {
      record.save.disabled = true;
      try {
        await this.p.saveArtifact(a);
        status.textContent = "已保存：" + a.savedPath;
      } catch (e) {
        status.textContent = "保存失败：" + e.message;
      } finally {
        record.save.disabled = false;
      }
    });
    this.button(controls, "继续修改", () => {
      this.input.value = `/visualize 修改卡片「${a.title}」（${a.id}）：`;
      this.p.draft = this.input.value;
      this.resizeInput();
      void this.p.persist().catch((e) => this.p.fail(e));
      this.input.focus();
    });
    const details = el.createEl("details");
    details.createEl("summary", { text: "查看 DataviewJS 源码" });
    details.createEl("pre", { text: a.code });
    body.createDiv({
      text: "交互视图已准备好。检查代码后点击运行。",
      cls: "na-muted",
    });
  }
  renderChanges() {
    const changes = require("../domain/session-changes").sessionChanges(
      this.p.journal,
      this.p.sessionId,
    );
    const key = JSON.stringify([
      this.p.sessionId,
      this.p.journal.length,
      changes.map((c) => [c.id, c.status]),
    ]);
    if (key === this.changesKey) return;
    this.changesKey = key;
    this.changeBox.empty();
    const files = new Set(
      changes.map((c) => (c.workspace || "vault") + "/" + c.path),
    ).size;
    this.changeBox.hidden = !changes.length;
    if (changes.length)
      this.button(
        this.changeBox,
        "审阅 · " + files + " 个文件 · " + changes.length + " 次操作",
        () => this.p.openReview(),
        "vb-review-summary",
      );
  }

  async onClose() {
    clearTimeout(this.draftTimer);
    for (const [approval, view] of this.approvals) {
      view.dispose();
      if (view.modal && !view.modal.closed) view.modal.close();
      approval.finish(false);
    }
    this.approvals.clear();
    for (const x of [...this.rows.values(), ...this.cards.values()]) {
      x.component?.unload();
      if (x.component) this.removeChild(x.component);
    }
    this.rows.clear();
    this.cards.clear();
  }
}
module.exports = { AgentView, VIEW };
