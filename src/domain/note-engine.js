'use strict';
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs/promises');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
function vaultPath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || path.posix.isAbsolute(value) || /^[a-z]:/i.test(value)) throw Error('需要库内相对路径');
  const parts = value.split('/');
  if (parts.some(p => !p || p === '..' || p === '.' || p.startsWith('.'))) throw Error('不允许隐藏目录或越界路径');
  return value;
}
async function checkPhysical(root, relative) {
  vaultPath(relative);
  const base = await fs.realpath(root);
  let parent = path.join(base, relative);
  while (true) {
    try {
      const actual = await fs.realpath(parent);
      if (actual !== base && !actual.startsWith(base + path.sep)) throw Error('符号链接指向笔记库之外');
      return;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      const next = path.dirname(parent); if (next === parent) throw e; parent = next;
    }
  }
}
function replaceExact(content, oldText, newText) {
  if (typeof oldText !== 'string' || !oldText || typeof newText !== 'string') throw Error('替换文本无效');
  const i = content.indexOf(oldText);
  if (i < 0 || content.indexOf(oldText, i + oldText.length) >= 0) throw Error('原文不存在或出现多次，请读取并扩大定位文本');
  return content.slice(0, i) + newText + content.slice(i + oldText.length);
}
class Serial {
  constructor() { this.tail = Promise.resolve(); }
  run(fn) { const p = this.tail.then(fn); this.tail = p.catch(() => {}); return p; }
}
class NoteEngine {
  constructor(storage, journal, changed = () => {}) { this.storage = storage; this.journal = journal; this.changed = changed; this.serial = new Serial(); this.runID = null; }
  start(id) { this.runID = id; }
  stop() { this.runID = null; }
  guard(id) { if (!id || id !== this.runID) throw Error('任务已停止，拒绝后续写入'); }
  async read(p) { vaultPath(p); const text = await this.storage.read(p); return { path: p, text, revision: hash(text) }; }
  patch(p, revision, oldText, newText, id) {
    return this.serial.run(async () => {
      this.guard(id); const before = await this.read(p);
      if (before.revision !== revision) throw Error('文档已变化，请重新读取后修改');
      const after = replaceExact(before.text, oldText, newText);
      const entry = { id: crypto.randomUUID(), path: p, before: before.text, after, time: Date.now(), status: 'pending' };
      this.journal.push(entry); await this.changed(); // Persist rollback record before mutation.
      this.guard(id);
      try { await this.storage.compareWrite(p, before.text, after, () => this.guard(id)); entry.status = 'applied'; }
      catch (e) { entry.status = 'failed'; await this.changed(); throw e; }
      await this.changed(); return { path: p, revision: hash(after), changeId: entry.id };
    });
  }
  create(p, text, id) {
    return this.serial.run(async () => {
      this.guard(id); vaultPath(p);
      if (typeof text !== 'string' || text.length > 500000) throw Error('内容超过 demo 上限');
      await this.storage.create(p, text, () => this.guard(id)); return { path: p, revision: hash(text) };
    });
  }
  undo(changeId) {
    return this.serial.run(async () => {
      if (this.runID) throw Error('请先停止当前任务再撤销');
      const e = this.journal.find(x => x.id === changeId);
      if (!e || !['applied', 'pending'].includes(e.status)) throw Error('没有可撤销的修改');
      await this.storage.compareWrite(e.path, e.after, e.before, () => { if (this.runID) throw Error('新任务已开始'); });
      e.status = 'undone'; await this.changed(); return e;
    });
  }
}
module.exports={hash,vaultPath,checkPhysical,replaceExact,NoteEngine};
