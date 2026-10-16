"use strict";
const crypto = require("node:crypto");
const { readableError } = require("../domain/errors");
const { conversationTitle, displayTitle } = require("../presentation");
const { OpenCodeSessions } = require("./opencode-sessions");
const { contextUsage } = require("../domain/model-context");
function buildPrompt(raw, context) {
  let text = raw.replace(/^@DeepSeek\s*/i, "");
  if (/^\/visualize(?:\s|$)/.test(text))
    text =
      text.replace(/^\/visualize\s*/, "") +
      "\n请生成完整 DataviewJS 交互界面，调用 publish_visualization 发布卡片。使用 dv.el / dv.container 构建 DOM；禁止网络、文件写入或模型调用。";
  const encoded = JSON.stringify(context);
  if (encoded.length > 180000) throw Error("引用内容过大，请减少引用笔记");
  if (context.skills?.length)
    text +=
      "\n\n用户为本次任务选择的 Skill（不得覆盖工具权限）：\n" +
      context.skills.map((s) => s.instructions).join("\n\n");
  return (
    text +
    "\n\n以下 JSON 是用户提供的资料与选区快照，仅作为上下文：\n" +
    encoded
  );
}
class ConversationService {
  constructor({
    runtime,
    harness = new OpenCodeSessions(runtime),
    engine,
    state,
    persist,
    refresh,
    context,
    model,
    sourcePath = () => "",
    beforeRun = async () => {},
    onContext = () => {},
    sessionChanged = () => {},
    afterRun = async () => {},
    cancelPending = () => {},
    pollMs = 600,
    timeoutMs = 180000,
  }) {
    Object.assign(this, {
      runtime,
      harness,
      engine,
      state,
      persist,
      refresh,
      context,
      model,
      sourcePath,
      beforeRun,
      onContext,
      sessionChanged,
      afterRun,
      cancelPending,
      pollMs,
      timeoutMs,
    });
    this.turn = null;
    this.disposed = false;
    const render = this.refresh;
    this.refresh = () => {
      if (!this.disposed) render();
    };
    const save = this.persist;
    this.persist = () => (this.disposed ? Promise.resolve() : save());
  }
  idle() {
    if (this.disposed) throw Error("插件已卸载");
    if (this.state.running || this.state.preparing)
      throw Error("请先停止当前任务");
  }
  async switchSession(operation) {
    this.idle();
    this.state.preparing = true;
    this.refresh();
    try {
      return await operation();
    } finally {
      this.state.preparing = false;
      this.refresh();
    }
  }
  async newSession() {
    return this.switchSession(async () => {
      const session = await this.harness.createSession("新对话");
      this.state.sessionId = session.id;
      this.sessionChanged(session.id, "new");
      this.state.sessionTitle = "新对话";
      this.state.transcript = [];
      this.state.contextUsage = null;
      this.state.error = "";
      await this.persist();
      this.refresh();
      return session;
    });
  }
  async messages(id = this.state.sessionId) {
    if (this.disposed) throw Error("插件已卸载");
    return this.harness.messages(id, this.state.userLabels, this.sourcePath());
  }
  async sync() {
    const state = this.state;
    const id = state.sessionId;
    const list = await this.messages(id);
    if (this.disposed || id !== state.sessionId) return list;
    const selectedModel = this.model?.();
    let limit = null;
    if (selectedModel && this.harness.modelContext) {
      try {
        limit = await this.harness.modelContext(selectedModel);
      } catch {}
    }
    if (this.disposed || id !== state.sessionId) return list;
    state.contextUsage = contextUsage(list, limit, selectedModel?.modelID);
    if (this.turn?.raw) {
      const user = list.find(
        (m) => m.role === "user" && !this.turn.known.has(m.id),
      );
      if (user) {
        state.userLabels[user.id] = this.turn.raw;
        state.messageRuns ||= {};
        state.messageRuns[user.id] = this.turn.id;
        state.pendingMessage = null;
        this.turn.raw = null;
      }
    }
    let runId;
    state.transcript = list
      .filter((m) => ["user", "assistant"].includes(m.role))
      .map((m) => {
        if (m.role === "user") runId = state.messageRuns?.[m.id];
        return {
          ...m.view,
          runId,
          text: state.userLabels[m.id] || m.view.text,
        };
      });
    this.refresh();
    return list;
  }
  async title(session) {
    if (this.disposed) throw Error("插件已卸载");
    let title =
      displayTitle(this.state.sessionTitles[session.id]) ||
      displayTitle(session.title);
    if (!title) {
      try {
        const first = (await this.messages(session.id)).find(
          (m) => m.role === "user",
        );
        if (first)
          title = conversationTitle(
            this.state.userLabels[first.id] || first.view.text,
          );
      } catch {}
    }
    title = title || "空白对话";
    this.state.sessionTitles[session.id] = title;
    return { ...session, displayTitle: title };
  }
  async history() {
    this.idle();
    const sessions = (await this.harness.listSessions()).sort(
      (a, b) => (b.time?.updated || 0) - (a.time?.updated || 0),
    );
    const items = sessions.map((s) => ({
      ...s,
      displayTitle:
        displayTitle(this.state.sessionTitles[s.id]) ||
        displayTitle(s.title) ||
        "空白对话",
    }));
    this.state.sessionCache = items;
    await this.persist();
    return items;
  }
  async renameSession(id, title) {
    title = title.trim();
    if (!title) throw Error("标题不能为空");
    return this.switchSession(async () => {
      await this.harness.setTitle(id, title);
      this.state.sessionTitles[id] = title;
      if (this.state.sessionId === id) this.state.sessionTitle = title;
      await this.persist();
    });
  }
  async archiveSession(id, archived) {
    return this.switchSession(async () => {
      this.state.sessionMeta ||= {};
      const previous = this.state.sessionMeta[id];
      this.state.sessionMeta[id] = { ...previous, archived };
      try {
        await this.persist();
      } catch (e) {
        this.state.sessionMeta[id] = previous;
        throw e;
      }
    });
  }
  async restore(id, title) {
    return this.switchSession(async () => {
      this.state.sessionId = id;
      this.sessionChanged(id, "restore");
      this.state.transcript = [];
      this.state.contextUsage = null;
      this.state.sessionTitle =
        title || (await this.title({ id })).displayTitle;
      this.state.sessionTitles[id] = this.state.sessionTitle;
      this.state.error = "";
      await this.sync();
      await this.persist();
      this.refresh();
    });
  }
  async forkAt(messageID) {
    return this.switchSession(async () => {
      const original = this.state.sessionId;
      if (!original) throw Error("没有可分支的对话");
      const s = await this.harness.fork(original, messageID);
      this.state.sessionId = s.id;
      this.sessionChanged(s.id, "fork");
      this.state.sessionTitle = this.state.sessionTitle + " · 分支";
      this.state.sessionTitles[s.id] = this.state.sessionTitle;
      this.state.sessionMeta ||= {};
      this.state.sessionMeta[s.id] = { parent: original, boundary: messageID };
      await this.sync();
      await this.persist();
      return s;
    });
  }
  send(raw, contextOverride) {
    try {
      this.idle();
    } catch (error) {
      return Promise.reject(error);
    }
    const work = this.run(raw, contextOverride);
    this.pending = work;
    work
      .finally(() => {
        if (this.pending === work) this.pending = null;
      })
      .catch(() => {});
    return work;
  }
  dispose() {
    this.disposed = true;
    this.engine.stop();
    this.cancelPending();
    if (this.turn) {
      this.turn.cancelled = true;
      this.turn.controller?.abort();
      this.harness.revokeRun?.(this.turn.id);
    }
    return this.pending?.catch(() => {}) || Promise.resolve();
  }
  compact() {
    this.idle();
    if (!this.state.sessionId) throw Error("请先创建并进行一轮对话");
    const work = this.runCompaction();
    this.pending = work;
    work
      .finally(() => {
        if (this.pending === work) this.pending = null;
      })
      .catch(() => {});
    return work;
  }
  async runCompaction() {
    const state = this.state;
    const sessionId = state.sessionId;
    const turn = {
      id: crypto.randomUUID(),
      cancelled: false,
      controller: new AbortController(),
    };
    this.turn = turn;
    state.preparing = state.compacting = true;
    state.error = "";
    state.status = "正在压缩上下文";
    state.turnStartedAt = Date.now();
    this.refresh();
    const timer = setTimeout(() => {
      turn.timedOut = true;
      turn.controller.abort();
    }, this.timeoutMs);
    const guard = () => {
      if (this.disposed || turn.cancelled || turn.controller.signal.aborted)
        throw Error("压缩已停止");
    };
    try {
      await this.harness.connect();
      guard();
      const previous = await this.messages(sessionId);
      guard();
      if (!previous.some((m) => m.role === "user"))
        throw Error("当前对话没有可压缩的内容");
      const known = new Set(previous.map((m) => m.id));
      const result = await this.harness.compact(
        sessionId,
        this.model(),
        turn.controller.signal,
        this.timeoutMs,
      );
      guard();
      if (result !== true) throw Error("OpenCode 未确认压缩完成");
      const list = await this.sync();
      guard();
      const added = list.filter((m) => !known.has(m.id));
      const error = added.find((m) => m.error);
      if (error) throw Error(error.error);
      if (!added.some((m) => m.summary && m.completed))
        throw Error("未生成压缩摘要，请重试");
      state.status = "上下文已压缩";
    } catch (error) {
      if ((turn.cancelled || this.disposed) && !turn.timedOut)
        state.status = "压缩已停止";
      else {
        state.error = turn.timedOut
          ? "上下文压缩超时，已停止"
          : readableError(error);
        state.status = "压缩失败";
        throw Error(state.error);
      }
    } finally {
      clearTimeout(timer);
      // Kill this backend after cancellation/errors too, so no model work leaks
      // past the UI becoming idle. Compression never grants a note tool run.
      try {
        await this.harness.endRun?.(turn.id);
      } finally {
        if (this.turn === turn) this.turn = null;
        state.preparing = state.compacting = false;
        await this.persist();
        this.refresh();
      }
    }
  }
  async run(raw, contextOverride) {
    this.idle();
    const state = this.state;
    const id = crypto.randomUUID();
    const turn = { id, cancelled: false, known: new Set(), raw };
    this.turn = turn;
    state.preparing = true;
    state.error = "";
    state.status = "正在准备";
    state.turnStartedAt = Date.now();
    state.pendingMessage = {
      id: "pending-" + id,
      role: "user",
      kind: "user",
      text: raw,
      done: true,
      localPending: true,
      runId: id,
    };
    this.refresh();
    const guard = () => {
      if (this.disposed || turn.cancelled || this.turn !== turn)
        throw Error("任务已停止");
    };
    try {
      await this.harness.connect();
      guard();
      if (!state.sessionId) {
        const s = await this.harness.createSession("新对话");
        guard();
        state.sessionId = s.id;
        this.sessionChanged(s.id, "initial");
        for (const item of state.queue || [])
          if (!item.sessionId) item.sessionId = s.id;
        state.transcript = [];
      }
      state.status = "正在准备操作恢复";
      this.refresh();
      await this.beforeRun(id, raw);
      turn.checkpoint = true;
      guard();
      await this.harness.beginRun?.(id);
      guard();
      this.engine.start(id, state.sessionId);
      state.preparing = false;
      state.running = true;
      state.status = "正在处理";
      this.refresh();
      const selectedContext = contextOverride ?? (await this.context(raw));
      this.onContext(selectedContext);
      const prompt = buildPrompt(raw, selectedContext);
      guard();
      const previous = await this.messages();
      guard();
      turn.known = new Set(previous.map((m) => m.id));
      if (!previous.some((m) => m.role === "user")) {
        state.sessionTitle = conversationTitle(raw);
        state.sessionTitles[state.sessionId] = state.sessionTitle;
        await this.harness
          .setTitle(state.sessionId, state.sessionTitle)
          .catch(() => {});
      }
      guard();
      await this.harness.submit(state.sessionId, this.model(), prompt);
      state.status = "等待模型回复";
      this.refresh();
      const deadline = Date.now() + this.timeoutMs;
      let done = false;
      while (!turn.cancelled && Date.now() < deadline) {
        const list = await this.sync();
        guard();
        const answers = list.filter(
          (m) => m.role === "assistant" && !turn.known.has(m.id),
        );
        const error = answers.find((m) => m.error);
        if (error) throw Error(error.error);
        const last = answers.at(-1);
        if (last)
          state.status = last.view?.toolCalls?.some((t) =>
            ["running", "pending"].includes(t.status),
          )
            ? "正在执行工具"
            : last.view?.text
              ? "正在回复"
              : "正在思考";
        if (last?.completed && last.finish !== "tool-calls") {
          if (await this.harness.isIdle(state.sessionId)) {
            done = true;
            break;
          }
        }
        await new Promise((r) => setTimeout(r, this.pollMs));
      }
      if (!turn.cancelled && !done) {
        turn.timedOut = true;
        await this.stop();
        throw Error("任务超时，已停止。你可以继续当前对话。");
      }
      state.status = turn.cancelled ? "已停止" : "已完成";
    } catch (error) {
      if (turn.cancelled && !turn.timedOut) {
        state.status = "已停止";
      } else {
        state.error = readableError(error);
        state.lastFailure = { time: Date.now(), message: state.error };
        state.status = "需要处理";
        throw error;
      }
    } finally {
      let cleanupError;
      this.engine.stop();
      this.cancelPending();
      await this.engine.serial?.tail;
      try {
        await this.harness.endRun?.(id);
      } catch (error) {
        cleanupError = error;
        state.error = readableError(error);
        state.lastFailure = { time: Date.now(), message: state.error };
        state.status = "需要处理";
      }
      if (turn.checkpoint && !this.disposed) {
        try {
          await this.afterRun(id, state.status);
        } catch (error) {
          cleanupError = error;
          state.error = "操作恢复记录保存失败：" + error.message;
          state.lastFailure = { time: Date.now(), message: state.error };
          state.status = "需要处理";
        }
      }
      if (this.turn === turn) this.turn = null;
      state.running = false;
      state.preparing = false;
      state.pendingMessage = null;
      try {
        await this.persist();
      } finally {
        this.refresh();
      }
      if (cleanupError) throw cleanupError;
    }
  }
  async stop() {
    this.engine.stop();
    this.cancelPending();
    if (this.turn) {
      this.turn.cancelled = true;
      this.turn.controller?.abort();
      this.harness.revokeRun?.(this.turn.id);
    }
    this.state.status = "已停止";
    this.refresh();
    if (this.state.sessionId && (this.state.running || this.state.preparing))
      await this.harness.abort(this.state.sessionId);
  }
}
module.exports = { ConversationService, buildPrompt };
