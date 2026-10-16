"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { GitHistory } = require("../backend/git-history");
const { hash, replaceExact, vaultPath } = require("./note-engine");
class ExternalWorkspace {
  constructor({
    root,
    resources,
    directory,
    engine,
    journal,
    persist,
    guard,
    executable,
  }) {
    Object.assign(this, { root, resources, engine, journal, persist, guard });
    this.history = new GitHistory({
      directory,
      snapshot: () => this.snapshot(),
      apply: (...args) => this.apply(...args),
      executable,
    });
  }
  async snapshot() {
    const files = new Map();
    let size = 0;
    let count = 0;
    const walk = async (relative = "") => {
      const dir = await this.resources.resolve(this.root, relative);
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        if (
          e.name.startsWith(".") ||
          e.name === "VaultBridge Recovery" ||
          e.isSymbolicLink()
        )
          continue;
        if (++count > 10000)
          throw Error("外部工作目录超过 10000 项，请选择更小的目录");
        const p = [relative, e.name].filter(Boolean).join("/");
        if (e.isDirectory()) await walk(p);
        else if (e.isFile() && this.resources.isText(p)) {
          const text = await this.resources.readAt(this.root, p);
          size += Buffer.byteLength(text);
          if (size > 50 * 1024 * 1024)
            throw Error("外部工作目录文本超过 50 MB");
          files.set(p, Buffer.from(text));
        }
      }
    };
    await walk();
    return files;
  }
  async apply(relative, before, after, runGuard = () => {}) {
    const guard = () => {
      this.guard();
      runGuard();
    };
    guard();
    vaultPath(relative);
    if (
      !this.resources.isText(relative) ||
      (after && (after.length > 256000 || after.includes(0)))
    )
      throw Error("外部写入仅支持 256 KB 以内的文本");
    const parent = path.posix.dirname(relative);
    const dir = await this.resources.resolve(
      this.root,
      parent === "." ? "" : parent,
    );
    const target = path.join(dir, path.posix.basename(relative));
    let backup;
    if (before !== undefined) {
      const current = Buffer.from(
        await this.resources.readAt(this.root, relative),
      );
      if (!current.equals(before)) throw Error("外部文件已变化，拒绝覆盖");
      // Preserve the original first, then create exclusively. Concurrent files are never overwritten.
      const recovery = path.join(this.root, "VaultBridge Recovery");
      try {
        await fs.mkdir(recovery);
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
      }
      if ((await fs.lstat(recovery)).isSymbolicLink())
        throw Error("恢复目录不能是符号链接");
      backup = path.join(
        recovery,
        crypto.randomUUID() + "-" + path.basename(relative),
      );
      guard();
      await fs.rename(target, backup);
      const moved = await fs.readFile(backup);
      if (!moved.equals(before))
        throw Error("外部文件在写入前变化，原文件已保留：" + backup);
    }
    try {
      guard();
      if (after !== undefined)
        await fs.writeFile(target, after, { flag: "wx" });
    } catch (error) {
      throw Error(error.message + (backup ? "；原文件保存在 " + backup : ""));
    }
    return backup;
  }
  async readOptional(relative) {
    this.guard();
    vaultPath(relative);
    try {
      return await this.resources.readAt(this.root, relative);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      // A missing root is an error, not an empty workspace.
      await this.resources.resolve(this.root);
      return undefined;
    }
  }
  compareWrite(p, before, after, guard) {
    return this.apply(p, Buffer.from(before), Buffer.from(after), guard);
  }
  create(p, text, guard) {
    return this.apply(p, undefined, Buffer.from(text), guard);
  }
  removeCreated(p, expected, guard) {
    return this.apply(p, Buffer.from(expected), undefined, guard);
  }
  async mutate(args, run, sessionId, create = false) {
    return this.engine.serial.run(async () => {
      this.engine.guard(run);
      this.guard();
      const before = create
        ? undefined
        : await this.resources.readAt(this.root, args.path);
      if (!create && hash(before) !== args.revision)
        throw Error("外部文件已变化，请重新读取");
      const after = create
        ? args.text
        : replaceExact(before, args.oldText, args.newText);
      const entry = {
        id: crypto.randomUUID(),
        kind: create ? "create" : "edit",
        workspace: this.root,
        path: args.path,
        runId: run,
        sessionId,
        before: before || "",
        after,
        time: Date.now(),
        status: "pending",
      };
      this.journal.push(entry);
      await this.engine.persistJournal(this.persist);
      try {
        this.engine.guard(run);
        entry.recoveryPath = await this.apply(
          args.path,
          before === undefined ? undefined : Buffer.from(before),
          Buffer.from(after),
          () => this.engine.guard(run),
        );
        entry.status = "applied";
      } catch (e) {
        entry.status = "failed";
        await this.engine.persistJournal(this.persist);
        throw e;
      }
      await this.engine.persistJournal(this.persist);
      return { path: args.path, revision: hash(after), workspace: this.root };
    });
  }
}
module.exports = { ExternalWorkspace };
