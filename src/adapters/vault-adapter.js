"use strict";
const path = require("node:path");
const crypto = require("node:crypto");
const { vaultPath, checkPhysical } = require("../domain/note-engine");
// Recovery files remain visible and are never automatically removed.
const RECOVERY = "VaultBridge Recovery";

class VaultAdapter {
  constructor({ root, vault, editor, guard = () => {} }) {
    Object.assign(this, { root, vault, editor, guard });
  }
  async check(p) {
    this.guard();
    vaultPath(p);
    if (p === RECOVERY || p.startsWith(RECOVERY + "/"))
      throw Error("恢复副本目录由用户管理，Agent 不能修改");
    await checkPhysical(this.root, p);
    this.guard();
  }
  async read(p) {
    await this.check(p);
    if (!p.endsWith(".md")) throw Error("只支持 Markdown 笔记");
    const editor = this.editor(p);
    if (editor) return editor.getValue();
    const file = this.vault.getAbstractFileByPath(p);
    if (!file || file.children) throw Error("笔记不存在");
    return this.vault.read(file);
  }
  async readOptional(p) {
    await this.check(p);
    if (!this.vault.getAbstractFileByPath(p)) return undefined;
    return this.read(p);
  }
  async compareWrite(p, before, after, guard = () => {}) {
    await this.check(p);
    guard();
    const editor = this.editor(p);
    if (editor) {
      if (editor.getValue() !== before)
        throw Error("编辑缓冲区发生变化，未写入");
      editor.replaceRange(
        after,
        { line: 0, ch: 0 },
        editor.offsetToPos(before.length),
      );
    } else {
      const file = this.vault.getAbstractFileByPath(p);
      if (!file || file.children) throw Error("笔记不存在");
      await this.vault.process(file, (current) => {
        this.guard();
        guard();
        if (current !== before) throw Error("文件发生变化，未写入");
        return after;
      });
    }
  }
  async mkdir(folder, guard = () => {}) {
    if (folder === ".") return;
    vaultPath(folder);
    const parts = folder.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join("/");
      await checkPhysical(this.root, p);
      this.guard();
      guard();
      const existing = this.vault.getAbstractFileByPath(p);
      if (existing && !existing.children) throw Error("文件阻挡目录：" + p);
      if (!existing) await this.vault.createFolder(p);
    }
  }
  async create(p, text, guard) {
    await this.check(p);
    if (!p.endsWith(".md")) throw Error("仅允许创建 .md 笔记");
    await this.mkdir(path.posix.dirname(p), guard);
    this.guard();
    guard();
    await this.vault.create(p, text);
  }
  async relocate(p, destination, expected, guard) {
    await this.check(p);
    await this.check(destination);
    await this.mkdir(path.posix.dirname(destination), guard);
    const file = this.vault.getAbstractFileByPath(p);
    if (!file || this.vault.getAbstractFileByPath(destination))
      throw Error("源文件不存在或目标已存在");
    if ((await this.read(p)) !== expected) throw Error("笔记已有后续编辑");
    this.guard();
    guard();
    await this.vault.rename(file, destination);
  }
  async removeCreated(p, expected, guard) {
    await this.check(p);
    if ((await this.read(p)) !== expected)
      throw Error("笔记已有后续编辑，未移除");
    return this.preserve(p, Buffer.from(expected), guard);
  }
  async bytes(p) {
    const file = this.vault.getAbstractFileByPath(p);
    if (!file || file.children) throw Error("文件不存在：" + p);
    const editor = p.endsWith(".md") ? this.editor(p) : null;
    return editor
      ? Buffer.from(editor.getValue())
      : Buffer.from(await this.vault.readBinary(file));
  }
  // Rename the original rather than overwrite it. A late writer's bytes stay in
  // this recovery file, even when it holds an already-open file descriptor.
  async preserve(p, expected, guard = () => {}) {
    await this.check(p);
    if (!(await this.bytes(p)).equals(expected))
      throw Error("文件有后续变化：" + p);
    const destination = `${RECOVERY}/${crypto.randomUUID()}/${p}`;
    await this.mkdir(path.posix.dirname(destination), guard);
    const file = this.vault.getAbstractFileByPath(p);
    this.guard();
    guard();
    await this.vault.rename(file, destination);
    const actual = await this.bytes(destination);
    if (!actual.equals(expected)) {
      // Do not overwrite a newly recreated original path or destroy the recovery copy.
      throw Error("保留原文件时发现并发修改；原内容保存在 " + destination);
    }
    return destination;
  }
  async apply(p, before, after) {
    await this.check(p);
    const file = this.vault.getAbstractFileByPath(p);
    if (before === undefined && file) throw Error("目标已存在：" + p);
    if (before !== undefined && !file) throw Error("文件已移除：" + p);
    if (before !== undefined && after !== undefined && p.endsWith(".md")) {
      const oldText = before.toString("utf8"),
        newText = after.toString("utf8");
      if (
        !Buffer.from(oldText).equals(before) ||
        !Buffer.from(newText).equals(after)
      )
        throw Error("Markdown 不是有效 UTF-8，未覆盖：" + p);
      return this.compareWrite(p, oldText, newText);
    }
    let recovery;
    if (before !== undefined) recovery = await this.preserve(p, before);
    if (after === undefined) return;
    await this.mkdir(path.posix.dirname(p));
    this.guard();
    // createBinary refuses an existing path: never replace a concurrent new file.
    try {
      await this.vault.createBinary(
        p,
        after.buffer.slice(
          after.byteOffset,
          after.byteOffset + after.byteLength,
        ),
      );
    } catch (error) {
      throw Error(
        error.message + (recovery ? "；原文件保存在 " + recovery : ""),
      );
    }
  }
  async snapshot() {
    const files = new Map();
    let size = 0;
    for (const file of this.vault.getFiles()) {
      if (
        file.path.split("/").some((x) => x.startsWith(".")) ||
        file.path.startsWith(RECOVERY + "/")
      )
        continue;
      await this.check(file.path);
      const bytes = await this.bytes(file.path);
      size += bytes.length;
      if (size > 200 * 1024 * 1024) throw Error("Git 快照超过 200 MiB 上限");
      files.set(file.path, bytes);
    }
    return files;
  }
}
module.exports = { VaultAdapter, RECOVERY };
