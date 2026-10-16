'use strict';
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const textTypes = new Set([
  '.md',
  '.txt',
  '.csv',
  '.json',
  '.yaml',
  '.yml',
  '.js',
  '.ts',
  '.py',
  '.html',
  '.css',
  '.tex',
  '.bib',
  '.xml',
  '.log',
]);
// Roots are user-configured. No shell, writes, hidden paths or symlink traversal.
class Resources {
  constructor(settings) {
    this.settings = settings;
  }
  isText(relative) {
    return (
      textTypes.has(path.extname(relative).toLowerCase()) &&
      !relative.split('/').includes('VaultBridge Recovery')
    );
  }
  async listRootCheck(root) {
    if (!(await fs.stat(root)).isDirectory()) throw Error('需要文件夹路径');
  }
  roots() {
    return (this.settings().externalFolders || []).map((root) => ({
      id: crypto.createHash('sha256').update(root).digest('hex').slice(0, 16),
      path: root,
    }));
  }
  async resolve(root, relative = '') {
    if (!path.isAbsolute(root)) throw Error('请选择绝对目录路径');
    if (
      path.isAbsolute(relative) ||
      relative.includes('\\') ||
      relative.includes('\0') ||
      relative
        .split('/')
        .some((x) => x === '..' || x.startsWith('.') || x === 'VaultBridge Recovery')
    )
      throw Error('资料路径越界或隐藏');
    const base = await fs.realpath(root);
    let target = base;
    for (const part of relative.split('/').filter(Boolean)) {
      target = path.join(target, part);
      if ((await fs.lstat(target)).isSymbolicLink()) throw Error('不读取符号链接');
    }
    const actual = await fs.realpath(target);
    if (actual !== base && !actual.startsWith(base + path.sep)) throw Error('资料路径越界');
    return actual;
  }
  async readAt(root, relative) {
    const target = await this.resolve(root, relative);
    if (!textTypes.has(path.extname(target).toLowerCase()))
      throw Error('仅支持文本资料；PDF、Word 等请先转换为文本');
    const f = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await f.stat();
      if (!stat.isFile() || stat.size > 256000) throw Error('仅支持不超过 256 KB 的普通文本文件');
      const buffer = Buffer.alloc(256001);
      const { bytesRead } = await f.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 256000 || buffer.subarray(0, bytesRead).includes(0))
        throw Error('资料过大或不是文本');
      return buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      await f.close();
    }
  }
  root(id) {
    const r = this.roots().find((r) => r.id === id);
    if (!r) throw Error('资料目录未授权');
    return r.path;
  }
  async list(id, relative = '') {
    const target = await this.resolve(this.root(id), relative);
    return (await fs.readdir(target, { withFileTypes: true }))
      .filter((e) => !e.name.startsWith('.') && !e.isSymbolicLink())
      .slice(0, 200)
      .map((e) => ({
        path: [relative, e.name].filter(Boolean).join('/'),
        directory: e.isDirectory(),
      }));
  }
  async read(id, relative) {
    const text = await this.readAt(this.root(id), relative);
    return {
      root: id,
      path: relative,
      text,
      revision: crypto.createHash('sha256').update(text).digest('hex'),
    };
  }
  async skills() {
    const root = this.settings().skillFolder;
    if (!root) return [];
    const base = await this.resolve(root);
    const entries = await fs.readdir(base, { withFileTypes: true });
    const out = [];
    if (entries.some((e) => e.name === 'SKILL.md' && e.isFile()))
      out.push({ id: 'SKILL.md', name: path.basename(base) });
    for (const e of entries.slice(0, 200))
      if (e.isDirectory() && !e.isSymbolicLink() && !e.name.startsWith('.')) {
        try {
          await this.resolve(root, e.name + '/SKILL.md');
          out.push({ id: e.name + '/SKILL.md', name: e.name });
        } catch {}
      }
    return out;
  }
  async skillFile(id, relative) {
    if (!(await this.skills()).some((s) => s.id === id)) throw Error('Skill 不存在');
    if (
      relative.split('/').some((x) => x === '..' || x.startsWith('.')) ||
      path.isAbsolute(relative)
    )
      throw Error('Skill 资料路径越界');
    const directory = path.posix.dirname(id);
    return {
      path: relative,
      text: await this.readAt(
        this.settings().skillFolder,
        [directory === '.' ? '' : directory, relative].filter(Boolean).join('/'),
      ),
    };
  }
  async skill(id) {
    if (!(await this.skills()).some((s) => s.id === id)) throw Error('Skill 不存在');
    return { id, instructions: await this.readAt(this.settings().skillFolder, id) };
  }
}
module.exports = { Resources };
