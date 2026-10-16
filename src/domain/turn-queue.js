"use strict";
const crypto = require("node:crypto");
class TurnQueue {
  constructor({
    state,
    service,
    persist,
    refresh,
    context = async () => undefined,
  }) {
    Object.assign(this, { state, service, persist, refresh, context });
    this.paused = true;
  }
  async add(text) {
    if (!text.trim()) return;
    if ((this.state.queue || []).length >= 20) throw Error("队列最多 20 条");
    this.state.queue ||= [];
    const sessionId = this.state.sessionId;
    const context = await this.context(text);
    const item = {
      id: crypto.randomUUID(),
      sessionId: sessionId || this.state.sessionId,
      text: text.trim(),
      context,
    };
    if (this.service.disposed) throw Error("插件已卸载");
    this.state.queue.push(item);
    try {
      await this.persist();
    } catch (e) {
      this.state.queue = this.state.queue.filter((x) => x !== item);
      throw e;
    }
    this.paused = false;
    this.refresh();
    if (!this.service.pending && !this.state.running && !this.state.preparing)
      void this.drain().catch((e) => {
        this.paused = true;
        this.state.error = e.message;
        this.refresh();
      });
  }
  async remove(id) {
    this.state.queue = this.state.queue.filter((x) => x.id !== id);
    await this.persist();
    this.refresh();
  }
  pause() {
    this.paused = true;
    this.refresh();
  }
  async drain() {
    if (this.draining || this.paused || this.service.disposed) return;
    this.draining = true;
    try {
      while (!this.paused && !this.service.disposed) {
        if (this.state.running || this.state.preparing) break;
        const item = (this.state.queue || []).find(
          (x) => x.sessionId === this.state.sessionId,
        );
        if (!item) break;
        if (item.attemptFailed) {
          this.paused = true;
          this.state.error =
            "上一条任务可能已修改文件。请检查或撤销后移除该项，再继续队列；需要重试时请重新发送。";
          break;
        }
        // Remove before delivery: a restart must never automatically repeat a task.
        this.state.queue = this.state.queue.filter((x) => x !== item);
        try {
          await this.persist();
        } catch (e) {
          this.state.queue.unshift(item);
          this.paused = true;
          throw e;
        }
        this.refresh();
        try {
          await this.service.send(item.text, item.context);
        } catch (e) {
          item.attemptFailed = true;
          this.state.queue.unshift(item);
          this.paused = true;
          this.state.error = e.message;
          await this.persist();
          break;
        }
      }
    } finally {
      this.draining = false;
      this.refresh();
    }
  }
  resume() {
    this.paused = false;
    return this.drain();
  }
}
module.exports = { TurnQueue };
