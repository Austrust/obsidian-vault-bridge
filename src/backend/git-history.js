'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { vaultPath } = require('../domain/note-engine');
const blobId = (bytes) =>
  crypto
    .createHash('sha1')
    .update('blob ' + bytes.length + '\0')
    .update(bytes)
    .digest('hex');
const manifest = (files) => new Map([...files].map(([p, b]) => [p, blobId(b)]));
const same = (a, b) => a.size === b.size && [...a].every(([p, id]) => b.get(p) === id);
class GitHistory {
  constructor({ directory, snapshot, apply, executable = () => 'git' }) {
    Object.assign(this, { directory, snapshot, apply, executable });
    this.tail = Promise.resolve();
  }
  serial(fn) {
    const p = this.tail.then(fn);
    this.tail = p.catch(() => {});
    return p;
  }
  async git(args, input, extraEnv = {}, { maxBytes = 256 * 1024 * 1024, truncate = false } = {}) {
    return new Promise((resolve, reject) => {
      const env = { ...process.env };
      for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
      Object.assign(
        env,
        {
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
          GIT_TERMINAL_PROMPT: '0',
          GIT_AUTHOR_NAME: 'VaultBridge',
          GIT_AUTHOR_EMAIL: 'vaultbridge@localhost',
          GIT_COMMITTER_NAME: 'VaultBridge',
          GIT_COMMITTER_EMAIL: 'vaultbridge@localhost',
        },
        extraEnv,
      );
      const p = spawn(
        this.executable(),
        [
          '--git-dir=' + this.directory,
          '-c',
          'core.hooksPath=' + path.join(this.directory, 'disabled-hooks'),
          ...args,
        ],
        { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false },
      );
      const out = [],
        err = [];
      let size = 0;
      const timer = setTimeout(() => p.kill(), 120000);
      p.on('error', (e) => {
        clearTimeout(timer);
        reject(Error('Git 无法启动：' + e.message));
      });
      p.stdout.on('data', (b) => {
        size += b.length;
        if (truncate) {
          const available = Math.max(0, maxBytes - (size - b.length));
          if (available) out.push(b.subarray(0, available));
        } else if (size > maxBytes) p.kill();
        else out.push(b);
      });
      p.stderr.on('data', (b) => {
        if (err.length < 100) err.push(b);
      });
      p.on('close', (code) => {
        clearTimeout(timer);
        if (size > maxBytes && !truncate) reject(Error('Git 输出超过限制'));
        else if (code === 0)
          resolve(
            Buffer.concat([
              ...out,
              ...(truncate && size > maxBytes
                ? [Buffer.from('\n…diff 显示已截断；完整内容可用 Git 查看。')]
                : []),
            ]),
          );
        else reject(Error('Git 操作失败：' + Buffer.concat(err).toString().slice(0, 800)));
      });
      p.stdin.on('error', () => {});
      p.stdin.end(input);
    });
  }
  async init() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      await fs.access(path.join(this.directory, 'HEAD'));
    } catch {
      await this.git(['init', '--bare']);
      await this.git(['symbolic-ref', 'HEAD', 'refs/heads/checkpoints']);
    }
  }
  async head() {
    try {
      return (await this.git(['rev-parse', '--verify', 'refs/heads/checkpoints']))
        .toString()
        .trim();
    } catch {
      return null;
    }
  }
  async commitFiles(files, label) {
    await this.init();
    const index = path.join(this.directory, 'index-' + crypto.randomUUID());
    const env = { GIT_INDEX_FILE: index };
    try {
      await this.git(['read-tree', '--empty'], null, env);
      let records = '';
      for (const [name, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
        vaultPath(name);
        const oid = (await this.git(['hash-object', '-w', '--stdin'], bytes)).toString().trim();
        records += '100644 ' + oid + '\t' + name + '\0';
      }
      await this.git(['update-index', '-z', '--index-info'], records, env);
      const tree = (await this.git(['write-tree'], null, env)).toString().trim();
      const parent = await this.head();
      const commit = (
        await this.git(['commit-tree', tree, ...(parent ? ['-p', parent] : [])], label + '\n')
      )
        .toString()
        .trim();
      await this.git(['update-ref', 'refs/heads/checkpoints', commit, parent || '0'.repeat(40)]);
      return commit;
    } finally {
      await fs.rm(index, { force: true });
    }
  }
  checkpoint(label) {
    return this.serial(async () => this.commitFiles(await this.snapshot(), label));
  }
  async list(limit = 100) {
    await this.init();
    if (!(await this.head())) return [];
    const data = (
      await this.git([
        'log',
        'refs/heads/checkpoints',
        '-n',
        String(limit),
        '--format=%H%x00%ct%x00%s',
      ])
    ).toString();
    return data
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [id, time, label] = line.split('\0');
        return { id, time: Number(time) * 1000, label };
      });
  }
  async tree(commit) {
    if (!/^[a-f0-9]{40}$/.test(commit)) throw Error('无效 Git 版本');
    await this.git(['merge-base', '--is-ancestor', commit, 'refs/heads/checkpoints']);
    const records = (await this.git(['ls-tree', '-rz', commit]))
      .toString()
      .split('\0')
      .filter(Boolean);
    const result = new Map();
    for (const record of records) {
      const tab = record.indexOf('\t'),
        name = record.slice(tab + 1),
        [mode, type, oid] = record.slice(0, tab).split(' ');
      vaultPath(name);
      if (mode !== '100644' || type !== 'blob') throw Error('不支持的 Git 文件类型');
      result.set(name, oid);
    }
    return result;
  }
  async files(commit) {
    const files = new Map();
    for (const [p, oid] of await this.tree(commit))
      files.set(p, await this.git(['cat-file', 'blob', oid]));
    return files;
  }
  async diff(commit) {
    if (!/^[a-f0-9]{40}$/.test(commit)) throw Error('无效 Git 版本');
    await this.git(['merge-base', '--is-ancestor', commit, 'refs/heads/checkpoints']);
    const parent = (await this.git(['rev-list', '--parents', '-n', '1', commit]))
      .toString()
      .trim()
      .split(' ')[1];
    return (
      await this.git(
        [
          'show',
          '--format=fuller',
          '--stat',
          '--patch',
          '--no-ext-diff',
          '--no-textconv',
          ...(parent ? [] : ['--root']),
          commit,
        ],
        undefined,
        {},
        { maxBytes: 120000, truncate: true },
      )
    ).toString();
  }
  async preview(commit) {
    const target = await this.tree(commit);
    const current = manifest(await this.snapshot());
    const paths = [...new Set([...current.keys(), ...target.keys()])]
      .sort()
      .filter((p) => current.get(p) !== target.get(p));
    return { commit, target, current, paths };
  }
  restore(plan) {
    return this.serial(async () => {
      const now = await this.snapshot();
      if (!same(manifest(now), plan.current)) throw Error('预览后文件又发生变化，请重新预览再回退');
      const target = await this.tree(plan.commit);
      const paths = [...new Set([...now.keys(), ...target.keys()])].filter(
        (p) => (now.has(p) ? blobId(now.get(p)) : undefined) !== target.get(p),
      );
      const rescue = await this.commitFiles(now, '恢复前备份 ' + plan.commit.slice(0, 8));
      try {
        // Remove first, deepest paths first. A file blocking a new directory is
        // preserved before that directory is created. Empty folders are not deleted.
        paths.sort(
          (a, b) =>
            Number(target.has(a)) - Number(target.has(b)) ||
            b.split('/').length - a.split('/').length ||
            a.localeCompare(b),
        );
        for (const p of paths) {
          const after = target.has(p)
            ? await this.git(['cat-file', 'blob', target.get(p)])
            : undefined;
          await this.apply(p, now.get(p), after);
          now.delete(p);
        }
        now.clear();
        const restored = await this.snapshot();
        if (!same(manifest(restored), target)) throw Error('回退期间出现并发修改');
        await this.commitFiles(restored, '恢复到 ' + plan.commit.slice(0, 8));
        return { rescue };
      } catch (error) {
        throw Error(
          error.message + '；恢复前备份：' + rescue + '。已停止后续写入，请在 Git 历史中检查。',
        );
      }
    });
  }
}
module.exports = { GitHistory, blobId };
