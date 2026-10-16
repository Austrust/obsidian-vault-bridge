"use strict";
const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs/promises");
const { planUndo, applyUndo } = require("./operation-undo");
const hash = (text) => crypto.createHash("sha256").update(text).digest("hex");
function vaultPath(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\\") ||
    value.includes("\0") ||
    path.posix.isAbsolute(value) ||
    /^[a-z]:/i.test(value)
  )
    throw Error("需要库内相对路径");
  const parts = value.split("/");
  if (parts.some((p) => !p || p === ".." || p === "." || p.startsWith(".")))
    throw Error("不允许隐藏目录或越界路径");
  return value;
}
async function checkPhysical(root, relative) {
  vaultPath(relative);
  const base = await fs.realpath(root);
  let parent = path.join(base, relative);
  while (true) {
    try {
      const actual = await fs.realpath(parent);
      if (actual !== base && !actual.startsWith(base + path.sep))
        throw Error("符号链接指向笔记库之外");
      return;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      const next = path.dirname(parent);
      if (next === parent) throw e;
      parent = next;
    }
  }
}
function replaceExact(content, oldText, newText) {
  if (typeof oldText !== "string" || !oldText || typeof newText !== "string")
    throw Error("替换文本无效");
  const i = content.indexOf(oldText);
  if (i < 0 || content.indexOf(oldText, i + oldText.length) >= 0)
    throw Error("原文不存在或出现多次，请读取并扩大定位文本");
  return content.slice(0, i) + newText + content.slice(i + oldText.length);
}
class Serial {
  constructor() {
    this.tail = Promise.resolve();
  }
  run(fn) {
    const p = this.tail.then(fn);
    this.tail = p.catch(() => {});
    return p;
  }
}
class NoteEngine {
  constructor(storage, journal, changed = () => {}) {
    this.storage = storage;
    this.journal = journal;
    this.changed = changed;
    this.serial = new Serial();
    this.runID = null;
    this.storageForUndo = (entry) => {
      if (entry.workspace) throw Error("外部目录未授权，不能撤销");
      return this.storage;
    };
  }
  start(id, sessionId = null) {
    this.sessionId = sessionId;
    this.runID = id;
  }
  stop() {
    this.runID = null;
  }
  guard(id) {
    if (this.persistenceError)
      throw Error(
        "恢复记录保存失败，已停止写入：" + this.persistenceError.message,
      );
    if (!id || id !== this.runID) throw Error("任务已停止，拒绝后续写入");
  }
  async persistJournal(save = this.changed) {
    try {
      await save();
    } catch (error) {
      this.persistenceError = error;
      this.stop();
      throw error;
    }
  }
  async prepareRecovery() {
    await this.persistJournal();
    this.persistenceError = null;
  }
  async read(p) {
    vaultPath(p);
    const text = await this.storage.read(p);
    return { path: p, text, revision: hash(text) };
  }
  patch(p, revision, oldText, newText, id) {
    return this.serial.run(async () => {
      this.guard(id);
      const before = await this.read(p);
      if (before.revision !== revision)
        throw Error("文档已变化，请重新读取后修改");
      const after = replaceExact(before.text, oldText, newText);
      const entry = {
        id: crypto.randomUUID(),
        path: p,
        kind: "edit",
        runId: id,
        sessionId: this.sessionId,
        before: before.text,
        after,
        time: Date.now(),
        status: "pending",
      };
      this.journal.push(entry);
      await this.persistJournal(); // Persist rollback record before mutation.
      try {
        this.guard(id);
        await this.storage.compareWrite(p, before.text, after, () =>
          this.guard(id),
        );
        entry.status = "applied";
      } catch (e) {
        entry.status = "failed";
        await this.persistJournal();
        throw e;
      }
      await this.persistJournal();
      return { path: p, revision: hash(after), changeId: entry.id };
    });
  }
  create(p, text, id) {
    return this.serial.run(async () => {
      this.guard(id);
      vaultPath(p);
      if (typeof text !== "string" || text.length > 500000)
        throw Error("内容超过 demo 上限");
      const entry = {
        id: crypto.randomUUID(),
        kind: "create",
        runId: id,
        sessionId: this.sessionId,
        path: p,
        before: "",
        after: text,
        time: Date.now(),
        status: "pending",
      };
      this.journal.push(entry);
      await this.persistJournal();
      try {
        this.guard(id);
        await this.storage.create(p, text, () => this.guard(id));
        entry.status = "applied";
      } catch (error) {
        entry.status = "failed";
        await this.persistJournal();
        throw error;
      }
      await this.persistJournal();
      return { path: p, revision: hash(text), changeId: entry.id };
    });
  }
  async recordOperation(entry, operation) {
    Object.assign(entry, {
      id: crypto.randomUUID(),
      sessionId: this.sessionId,
      time: Date.now(),
      status: "pending",
    });
    this.journal.push(entry);
    await this.persistJournal();
    try {
      entry.recoveryPath = await operation();
      entry.status = "applied";
    } catch (error) {
      entry.status = "failed";
      await this.persistJournal();
      throw error;
    }
    await this.persistJournal();
  }
  relocate(p, destination, revision, id, renameOnly = false) {
    return this.serial.run(async () => {
      this.guard(id);
      vaultPath(destination);
      if (!p.endsWith(".md") || !destination.endsWith(".md"))
        throw Error("仅支持 Markdown 笔记");
      if (p === destination) throw Error("目标路径没有变化");
      if (
        renameOnly &&
        path.posix.dirname(p) !== path.posix.dirname(destination)
      )
        throw Error("重命名不能跨目录，请使用移动");
      const before = await this.read(p);
      if (before.revision !== revision) throw Error("文档已变化，请重新读取");
      await this.recordOperation(
        {
          kind: renameOnly ? "rename" : "move",
          path: p,
          destination,
          runId: id,
          before: before.text,
          after: before.text,
        },
        async () => {
          this.guard(id);
          await this.storage.relocate(p, destination, before.text, () =>
            this.guard(id),
          );
        },
      );
      return { path: destination, revision: before.revision };
    });
  }
  deleteNote(p, revision, id) {
    return this.serial.run(async () => {
      this.guard(id);
      if (!p.endsWith(".md")) throw Error("仅支持 Markdown 笔记");
      const before = await this.read(p);
      if (before.revision !== revision) throw Error("文档已变化，请重新读取");
      await this.recordOperation(
        { kind: "delete", path: p, runId: id, before: before.text, after: "" },
        async () => {
          this.guard(id);
          return this.storage.removeCreated(p, before.text, () =>
            this.guard(id),
          );
        },
      );
      return { path: p, status: "trashed" };
    });
  }
  undo(changeId) {
    return this.serial.run(async () => {
      const e = this.journal.find((x) => x.id === changeId);
      if (!e || e.status !== "applied")
        throw Error("没有可撤销的修改；未确认记录需手动检查");
      await this.undoEntries([e]);
      return e;
    });
  }
  undoGuard() {
    if (this.runID) throw Error("请先停止当前任务再撤销");
  }
  runEntries(runId) {
    const entries = this.journal.filter((e) => e.runId === runId);
    if (
      entries.some((e) => ["pending", "undoing", "failed"].includes(e.status))
    )
      throw Error("本轮有未确认的操作，请先检查记录及恢复副本");
    return entries.filter((e) => e.status === "applied").reverse();
  }
  previewUndo(runId) {
    return this.serial.run(async () => {
      const operations = await planUndo(
        this.runEntries(runId),
        this.storageForUndo,
        () => this.undoGuard(),
      );
      return operations.map(({ entry }) => ({ ...entry }));
    });
  }
  undoRun(runId) {
    return this.serial.run(() => this.undoEntries(this.runEntries(runId)));
  }
  async undoEntries(entries) {
    const guard = () => this.undoGuard();
    const operations = await planUndo(entries, this.storageForUndo, guard);
    return applyUndo(operations, () => this.persistJournal(), guard);
  }
}
module.exports = { hash, vaultPath, checkPhysical, replaceExact, NoteEngine };
