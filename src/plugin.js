"use strict";
const { Plugin, Notice, MarkdownView } = require("obsidian");
const path = require("node:path");
const { hash, NoteEngine } = require("./domain/note-engine");
const { AgentView, VIEW } = require("./ui/chat-view");
const { GitHistory } = require("./backend/git-history");
const { PermissionGate } = require("./domain/permissions");
const { PermissionModal } = require("./ui/permission-modal");
const { GitHistoryModal } = require("./ui/git-history");
const { Settings } = require("./ui/settings");
const { ChangeHistory } = require("./ui/change-history");
const { UndoHistory } = require("./ui/undo-history");
const { DEMO_CODE } = require("./ui/example");
const { DEFAULTS } = require("./config");
const { WorkspaceStore } = require("./domain/workspace-store");
const { SessionComposer } = require("./domain/session-composer");
const {
  validateConnection,
  modelCatalog,
} = require("./domain/connection-settings");
const { OpenCodeRuntime } = require("./backend/opencode-runtime");
const { NoteTools } = require("./backend/note-tools");
const { ConversationService } = require("./backend/conversation-service");
const { archiveJournal } = require("./domain/journal-archive");
const { ArtifactService } = require("./domain/artifact-service");
const { SessionHistory } = require("./ui/session-history");
const { ModelPicker } = require("./ui/model-picker");
const { VaultAdapter } = require("./adapters/vault-adapter");
const { ExternalWorkspace } = require("./domain/external-workspace");
const { readableError } = require("./domain/errors");
const { Resources } = require("./domain/resources");
const { TurnQueue } = require("./domain/turn-queue");
const { WorkspacePanel, SkillPicker } = require("./ui/workspace-panel");
const LIFECYCLE = Symbol.for("vaultbridge.lifecycle");
class NoteAgent extends Plugin {
  async onload() {
    this.unloading = false;
    await this.app[LIFECYCLE];
    if (this.unloading) return;
    const data = await this.loadData();
    if (this.unloading) return;
    this.store = new WorkspaceStore(data, DEFAULTS, (data) =>
      this.saveData(data),
    );
    for (const key of Object.keys(this.store.state))
      Object.defineProperty(this, key, {
        get: () => this.store.state[key],
        set: (value) => (this.store.state[key] = value),
      });
    this.composer = new SessionComposer(this.store.state);
    this.draft = this.composer.value.draft;
    this.mentions = new Set(this.composer.value.mentions);
    this.selectedSkills = new Set(this.composer.value.skills);
    this.selection = this.composer.value.selection;
    this.externalReferences = this.composer.value.external || [];
    this.resources = new Resources(() => this.settings);
    this.apiKey = "";
    this.pendingApprovals = [];
    this.autoConnectPaused = false;
    this.unloading = false;
    this.root = this.app.vault.adapter.getBasePath();
    this.runtimeDir = path.join(this.root, this.manifest.dir, "runtime");
    this.vaultAdapter = new VaultAdapter({
      root: this.root,
      vault: this.app.vault,
      editor: (p) => this.editor(p),
      guard: () => {
        if (this.unloading) throw Error("插件已卸载");
      },
    });
    this.artifactService = new ArtifactService({
      runId: () => this.conversations?.turn?.id || null,
      state: this.store.state,
      adapter: this.vaultAdapter,
      persist: () => this.persist(),
      refresh: () => this.refresh(),
      guard: () => {
        if (this.unloading) throw Error("插件已卸载");
      },
    });
    this.engine = new NoteEngine(this.storage(), this.journal, () =>
      this.persist().then(() => this.refresh()),
    );
    this.engine.storageForUndo = (entry) =>
      entry.workspace
        ? this.externalWorkspace(entry.workspace, true)
        : this.vaultAdapter;
    this.permissions = new PermissionGate(
      () =>
        this.settings.agentMode === "plan"
          ? {
              ...this.settings.permissions,
              patch_note: "deny",
              create_note: "deny",
              move_note: "deny",
              rename_note: "deny",
              delete_note: "deny",
              publish_visualization: "deny",
              patch_external: "deny",
              create_external: "deny",
            }
          : this.settings.permissions,
      (request, finish) => {
        if (this.views().length) {
          const approval = { request, finish };
          this.pendingApprovals.push(approval);
          this.refresh();
          return () => {
            this.pendingApprovals = this.pendingApprovals.filter(
              (a) => a !== approval,
            );
            this.refresh();
          };
        }
        const modal = new PermissionModal(this.app, request, finish);
        modal.open();
        return () => modal.close();
      },
    );
    this.gitHistory = new GitHistory({
      directory: path.join(this.root, this.manifest.dir, "history.git"),
      snapshot: () => this.snapshotVault(),
      apply: (...args) => this.applyGitFile(...args),
      executable: () => this.settings.gitExecutable || "git",
    });
    this.tools = new NoteTools({
      resources: this.resources,
      skillFile: (id, relative) => {
        if (!this.activeSkills?.has(id))
          throw Error("该 Skill 未被本次任务选择");
        return this.resources.skillFile(id, relative);
      },
      external: (name, args, run) => {
        const workspace = this.activeExternal;
        if (!workspace || this.resources.root(args.root) !== workspace.root)
          throw Error("仅允许写入当前已启用的外部工作目录");
        return workspace.mutate(
          args,
          run,
          this.sessionId,
          name === "create_external",
        );
      },
      engine: this.engine,
      permissions: this.permissions,
      files: () => this.app.vault.getMarkdownFiles(),
      read: (p) => this.storage().read(p),
      active: () => this.active(),
      publish: (args) => this.publishArtifact(args),
    });
    this.backend = new OpenCodeRuntime({
      directory: this.runtimeDir,
      execute: (n, a, run) => this.execute(n, a, run),
      settings: () => this.settings,
      apiKey: () => this.apiKey,
      onState: (connection, message) => {
        this.connection = connection;
        if (message && !this.running && !this.preparing) this.status = message;
        this.refresh();
      },
      onExit: (error) => {
        this.engine.stop();
        this.permissions.cancel();
        if (this.conversations?.turn) this.conversations.turn.cancelled = true;
        this.error = error.message;
      },
    });
    this.conversations = new ConversationService({
      runtime: this.backend,
      timeoutMs:
        Math.min(
          3600,
          Math.max(60, Number(this.settings.taskTimeoutSeconds) || 900),
        ) * 1000,
      engine: this.engine,
      state: this.store.state,
      persist: () => this.persist(),
      refresh: () => this.refresh(),
      context: (raw) => this.contextFor(raw),
      sessionChanged: (id, kind) => this.changeComposer(id, kind),
      onContext: (context) => {
        this.activeSkills = new Set((context.skills || []).map((s) => s.id));
      },
      model: () => ({
        providerID: this.settings.provider,
        modelID: this.settings.model,
      }),
      sourcePath: () => this.lastFile || "",
      beforeRun: async () => {
        this.activeExternal = null;
        await this.engine.prepareRecovery();
        if (
          this.settings.externalWriteEnabled &&
          this.settings.resourceWorkspace
        ) {
          this.activeExternal = this.externalWorkspace();
        }
      },
      afterRun: async () => {
        if (this.engine.persistenceError) throw this.engine.persistenceError;
        await this.persist();
      },
      cancelPending: () => this.permissions.cancel(),
    });
    this.turnQueue = new TurnQueue({
      context: (raw) => this.contextFor(raw),
      onContext: (context) => {
        this.activeSkills = new Set((context.skills || []).map((s) => s.id));
      },
      state: this.store.state,
      service: this.conversations,
      persist: () => this.persist(),
      refresh: () => this.refresh(),
    });
    this.registerView(VIEW, (leaf) => new AgentView(leaf, this));
    this.addRibbonIcon("bot", "打开 VaultBridge Agent", () => this.open());
    this.addCommand({
      id: "open",
      name: "打开原生 Agent 侧边栏",
      callback: () => this.open(),
    });
    this.addCommand({
      id: "send-selection",
      name: "将当前笔记或选区交给 Agent",
      editorCallback: () => {
        this.attachActive();
        this.open();
      },
    });
    this.addCommand({
      id: "visualize",
      name: "Visualize：当前笔记生成可视化",
      editorCallback: () => {
        this.attachActive();
        this.open().then(() => {
          const v = this.views()[0];
          v.input.value = "/visualize ";
          v.input.focus();
        });
      },
    });
    this.addCommand({
      id: "undo-history",
      name: "查看最近操作与撤销",
      callback: () => this.openUndoHistory(),
    });
    this.addCommand({
      id: "local-changes",
      name: "查看本地修改历史与 diff",
      callback: () => this.openChangeHistory(),
    });
    this.settingsTab = new Settings(this.app, this);
    this.addSettingTab(this.settingsTab);
    this.registerEvent(
      this.app.workspace.on("file-open", (f) => {
        if (f?.extension === "md") this.lastFile = f.path;
      }),
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        const v = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (v?.file) this.lastFile = v.file.path;
      }),
    );
  }
  snapshotVault() {
    return this.vaultAdapter.snapshot();
  }
  applyGitFile(...args) {
    return this.vaultAdapter.apply(...args);
  }
  async restoreGit(plan, history = this.gitHistory) {
    this.conversations.idle();
    this.preparing = true;
    this.refresh();
    try {
      return await this.engine.serial.run(() => history.restore(plan));
    } finally {
      this.preparing = false;
      this.refresh();
    }
  }
  views() {
    return this.app.workspace.getLeavesOfType(VIEW).map((l) => l.view);
  }
  refresh() {
    if (this.unloading) return;
    this.views().forEach((v) => v.render());
  }
  fail(e) {
    if (this.unloading) return;
    this.error = readableError(e);
    this.lastFailure = { time: Date.now(), message: this.error };
    void this.persist().catch(() => {});
    this.status = "需要处理";
    new Notice(this.error);
    this.refresh();
  }
  persist() {
    if (this.unloading) return Promise.resolve();
    this.composer?.save(this.composerValue());
    return this.store.save();
  }
  composerValue() {
    return {
      draft: this.draft || "",
      mentions: [...this.mentions],
      selection: this.selection || null,
      skills: [...this.selectedSkills],
      external: this.externalReferences || [],
    };
  }
  changeComposer(id, kind) {
    const value = this.composer.switch(id, kind, this.composerValue());
    this.draft = value.draft;
    this.mentions = new Set(value.mentions);
    this.selectedSkills = new Set(value.skills);
    this.selection = value.selection;
    this.externalReferences = value.external || [];
    for (const view of this.views()) {
      if (!view.input) continue;
      clearTimeout(view.draftTimer);
      view.input.value = value.draft;
      view.resizeInput();
    }
    this.refresh();
  }
  async archiveOldJournal() {
    this.conversations.idle();
    this.preparing = true;
    this.refresh();
    try {
      const result = await this.engine.serial.run(() =>
        archiveJournal({
          journal: this.journal,
          directory: path.join(this.root, this.manifest.dir, "journal-archive"),
          persist: () => this.persist(),
          guard: () => {
            if (this.unloading) throw Error("插件已卸载");
          },
        }),
      );
      if (!this.unloading)
        new Notice(
          result
            ? `已归档 ${result.count} 条记录：${result.file}`
            : "暂无需要归档的旧记录",
        );
    } finally {
      this.preparing = false;
      this.refresh();
    }
  }
  openGitHistory() {
    new GitHistoryModal(this.app, this).open();
  }
  openChangeHistory() {
    new ChangeHistory(this.app, this).open();
  }
  openUndoHistory() {
    new UndoHistory(this.app, this).open();
  }
  openReview(runId) {
    new ChangeHistory(this.app, this, {
      sessionId: this.sessionId,
      runId,
    }).open();
  }
  chooseModel() {
    this.conversations.idle();
    new ModelPicker(this.app, this).open();
  }
  async configureConnection(patch, options = {}) {
    const next = validateConnection({ ...this.settings, ...patch });
    return this.conversations
      .switchSession(async () => {
        this.turnQueue.pause();
        const previous = this.settings;
        const previousKey = this.apiKey;
        this.status = "正在应用连接设置";
        this.refresh();
        await this.backend.disconnect();
        this.settings = next;
        if (options.apiKey !== undefined) this.apiKey = options.apiKey.trim();
        try {
          await this.persist();
        } catch (error) {
          this.settings = previous;
          this.apiKey = previousKey;
          throw error;
        }
        this.catalog = [];
        if (options.connect !== false || options.rememberKey) {
          const client = await this.connect();
          if (options.rememberKey && this.apiKey) {
            let saved;
            try {
              saved = await client.request(
                "/auth/" + encodeURIComponent(this.settings.provider),
                "PUT",
                { type: "api", key: this.apiKey },
              );
            } catch {
              throw Error(
                "本机凭据保存失败，Key 仍仅在本次运行可用。请检查 OpenCode 后重试。",
              );
            }
            if (saved !== true) throw Error("OpenCode 未确认凭据保存，请重试");
            this.apiKey = "";
          }
          const data = await client.request("/provider");
          this.catalog = modelCatalog(data, this.settings.provider);
          this.status = "本地连接已验证";
          if (options.connect === false) await this.backend.disconnect();
        } else this.status = "连接设置已保存";
        return this.catalog;
      })
      .catch((error) => {
        this.status = "连接设置需要处理";
        this.refresh();
        throw error;
      });
  }
  async availableModels() {
    return this.conversations.switchSession(async () => {
      const client = await this.connect();
      this.catalog = modelCatalog(
        await client.request("/provider"),
        this.settings.provider,
      );
      return this.catalog;
    });
  }
  async undoOperation(id, wholeRun = false, preview = false) {
    this.conversations.idle();
    this.turnQueue.pause();
    this.preparing = true;
    this.refresh();
    try {
      return await (preview
        ? this.engine.previewUndo(id)
        : wholeRun
          ? this.engine.undoRun(id)
          : this.engine.undo(id));
    } finally {
      this.preparing = false;
      this.refresh();
    }
  }
  openSettings() {
    this.app.setting.open();
    this.app.setting.openTabById(this.manifest.id);
  }
  async open() {
    const current = this.app.workspace.getActiveFile();
    if (current?.extension === "md") this.lastFile = current.path;
    let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      await leaf.setViewState({ type: VIEW, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }
  editor(p) {
    return this.app.workspace
      .getLeavesOfType("markdown")
      .map((l) => l.view)
      .find((v) => v.file?.path === p && v.editor)?.editor;
  }
  active() {
    const v = this.app.workspace.getActiveViewOfType(MarkdownView);
    const p =
      v?.file?.path ||
      this.app.workspace.getActiveFile()?.path ||
      this.lastFile;
    const editor = p && this.editor(p);
    return p
      ? {
          path: p,
          selection: editor?.getSelection() || "",
          text: editor?.getValue(),
        }
      : null;
  }
  attachActive(scope = "auto") {
    const a = this.active();
    if (!a) {
      new Notice("请先打开一篇 Markdown 笔记");
      return;
    }
    if (scope === "selection" && !a.selection) {
      new Notice("请先在笔记中选中要引用的文字");
      return;
    }
    if (scope !== "note" && a.selection) {
      this.mentions.delete(a.path);
      this.selection = {
        path: a.path,
        text: a.selection,
        revision: hash(a.text),
      };
    } else {
      this.mentions.add(a.path);
      if (this.selection?.path === a.path) this.selection = null;
    }
    this.refresh();
    void this.persist().catch((e) => this.fail(e));
  }
  storage() {
    return this.vaultAdapter;
  }
  mkdir(folder) {
    return this.vaultAdapter.mkdir(folder);
  }
  execute(name, args, run) {
    return this.tools.call(name, args, run);
  }
  publishArtifact(args) {
    return this.artifactService.publish(args);
  }
  dataview() {
    return this.app.plugins.plugins.dataview?.api;
  }
  addExample() {
    return this.artifactService.publish({
      title: "复利交互示例 · 无需 API",
      code: DEMO_CODE,
      sourcePath: this.active()?.path || "",
    });
  }
  async saveArtifact(artifact) {
    const p = await this.artifactService.save(artifact);
    if (this.unloading) return;
    new Notice("已保存 " + p);
    await this.app.workspace.openLinkText(p, "", true);
  }
  async contextFor(raw) {
    const notes = [];
    for (const p of this.mentions) notes.push(await this.engine.read(p));
    const externalNotes = [];
    let externalSize = 0;
    for (const reference of this.externalReferences || []) {
      const data = await this.resources.read(reference.root, reference.path);
      externalSize += data.text.length;
      if (externalSize > 120000) throw Error("外部引用过大，请减少引用文件");
      externalNotes.push(data);
    }
    const artifacts = this.artifacts
      .filter((a) => a.sessionId === this.sessionId && raw.includes(a.id))
      .map((a) => ({ id: a.id, title: a.title, code: a.code }));
    const skills = [];
    if (raw.includes("$"))
      for (const skill of await this.resources.skills())
        if (raw.includes("$" + skill.name)) this.selectedSkills.add(skill.id);
    for (const id of this.selectedSkills)
      skills.push(await this.resources.skill(id));
    return {
      mode:
        this.settings.agentMode === "plan"
          ? "只读规划：仅调研、解释和提供计划，不修改文件"
          : "Agent：按授权执行",
      notes,
      externalNotes,
      selection: this.selection || null,
      artifacts,
      skills,
      externalResources: this.resources.roots(),
      preferredResourceDirectory:
        this.settings.resourceWorkspace || "当前笔记库",
    };
  }
  get client() {
    return this.backend.client;
  }
  async connect() {
    if (this.unloading) throw Error("插件已卸载");
    this.autoConnectPaused = false;
    const client = await this.backend.connect();
    this.error = "";
    this.refresh();
    return client;
  }
  async autoConnect() {
    if (
      this.settings.autoConnect === false ||
      this.autoConnectPaused ||
      this.unloading
    )
      return;
    try {
      await this.connect();
    } catch (error) {
      if (!this.unloading && !this.autoConnectPaused) this.fail(error);
    }
  }
  newSession() {
    return this.conversations.newSession();
  }
  restore(id, title) {
    return this.conversations.restore(id, title);
  }
  async send(raw) {
    try {
      return await this.conversations.send(raw);
    } catch (e) {
      this.turnQueue.pause();
      throw e;
    } finally {
      if (!this.unloading)
        void this.turnQueue.drain().catch((e) => this.fail(e));
    }
  }
  stop() {
    this.turnQueue.pause();
    return this.conversations.stop();
  }
  async steer(raw) {
    this.turnQueue.pause();
    await this.conversations.stop();
    await this.conversations.pending?.catch(() => {});
    return this.send(raw);
  }
  externalWorkspace(root = this.settings.resourceWorkspace, recovery = false) {
    const relative = path.relative(root || this.root, this.root);
    const inverse = path.relative(this.root, root || this.root);
    if (!relative || !relative.startsWith("..") || !inverse.startsWith(".."))
      throw Error("外部可写目录不能与当前笔记库重叠");
    const resource = this.resources.roots().find((r) => r.path === root);
    if (!resource) throw Error("请先授权外部工作目录");
    return new ExternalWorkspace({
      root,
      resources: this.resources,
      directory: path.join(
        this.root,
        this.manifest.dir,
        "external-history",
        resource.id + ".git",
      ),
      engine: this.engine,
      journal: this.journal,
      persist: () => this.persist().then(() => this.refresh()),
      executable: () => this.settings.gitExecutable || "git",
      guard: () => {
        if (
          this.unloading ||
          (!recovery &&
            (!this.settings.externalWriteEnabled ||
              this.settings.resourceWorkspace !== root)) ||
          !this.settings.externalFolders.includes(root)
        )
          throw Error("外部写入授权已撤销");
      },
    });
  }
  openExternalHistory() {
    const history = this.externalWorkspace().history;
    const facade = new Proxy(this, {
      get: (target, key) =>
        key === "gitHistory"
          ? history
          : key === "restoreGit"
            ? (plan) => this.restoreGit(plan, history)
            : typeof target[key] === "function"
              ? target[key].bind(target)
              : target[key],
      set: (target, key, value) => {
        target[key] = value;
        return true;
      },
    });
    new GitHistoryModal(this.app, facade).open();
  }
  openResources() {
    new WorkspacePanel(this.app, this).open();
  }
  async pickSkill() {
    const items = await this.resources.skills();
    if (!items.length) throw Error("未发现 Skill，请先设置 Skill 仓库路径");
    new SkillPicker(this.app, items, (s) => {
      this.selectedSkills.add(s.id);
      this.refresh();
      void this.persist().catch((e) => this.fail(e));
    }).open();
  }
  async editMessage(id, text) {
    await this.conversations.forkAt(id);
    this.draft = "";
    for (const view of this.views()) {
      view.input.value = "";
      view.resizeInput();
    }
    try {
      await this.send(text);
    } catch (error) {
      this.draft = text;
      for (const view of this.views()) {
        view.input.value = text;
        view.resizeInput();
      }
      await this.persist();
      throw error;
    }
  }
  async chooseHistory() {
    this.conversations.idle();
    new SessionHistory(this.app, this).open();
  }
  async disconnect() {
    this.autoConnectPaused = true;
    try {
      await this.conversations.stop();
    } finally {
      await this.backend.disconnect();
    }
  }
  onunload() {
    this.unloading = true;
    this.settingsTab?.hide();
    this.turnQueue?.pause();
    this.permissions?.cancel();
    this.engine?.stop();
    const draining = this.conversations?.dispose() || Promise.resolve();
    this.store?.dispose();
    // A reloaded instance must not race pending writes from this instance.
    this.app[LIFECYCLE] = Promise.allSettled([
      draining,
      this.backend?.disconnect(),
      this.store?.tail,
      this.engine?.serial.tail,
      this.gitHistory?.tail,
    ]).then(() => {});
  }
}
module.exports = NoteAgent;
