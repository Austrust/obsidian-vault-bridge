const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { GitHistory } = require('../src/backend/git-history');
test('real Git commits, binary snapshots, move/delete recovery and rescue commit', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vb-git-'));
  let files = new Map([
    ['研究.md', Buffer.from('原文\n')],
    ['附件/image.bin', Buffer.from([0, 255, 32])],
  ]);
  const h = new GitHistory({
    directory: path.join(root, 'history.git'),
    snapshot: async () => new Map([...files].map(([p, b]) => [p, Buffer.from(b)])),
    apply: async (p, b, a) => {
      if (a === undefined) files.delete(p);
      else files.set(p, a);
    },
  });
  try {
    const first = await h.checkpoint('运行前 one');
    files.delete('研究.md');
    files.set('移动/新名.md', Buffer.from('改过\n'));
    const second = await h.checkpoint('运行后 one');
    assert.notEqual(first, second);
    assert.match(await h.diff(second), /研究|\\/);
    assert.equal((await h.list()).length, 2);
    assert((await h.files(first)).get('附件/image.bin').equals(Buffer.from([0, 255, 32])));
    const plan = await h.preview(first);
    assert.equal(plan.paths.length, 2);
    const { rescue } = await h.restore(plan);
    assert.equal(files.get('研究.md').toString(), '原文\n');
    assert(!files.has('移动/新名.md'));
    assert((await h.files(rescue)).has('移动/新名.md'));
    assert.equal((await h.list()).length, 4);
    assert.equal((await h.git(['remote'])).toString(), '');
    await h.git(['fsck', '--full']);
    await new Promise((resolve, reject) =>
      require('node:child_process').execFile(
        'git',
        ['-c', 'core.autocrlf=false', 'clone', h.directory, path.join(root, 'recovery')],
        (e) => (e ? reject(e) : resolve()),
      ),
    );
    assert.equal(await fs.readFile(path.join(root, 'recovery', '研究.md'), 'utf8'), '原文\n');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('Git restore refuses changes made after preview and keeps state on failure', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vb-git-'));
  let files = new Map([['a.md', Buffer.from('a')]]);
  const h = new GitHistory({
    directory: path.join(root, 'repo.git'),
    snapshot: async () => new Map(files),
    apply: async () => {
      throw Error('write error');
    },
  });
  try {
    const first = await h.checkpoint('first');
    files.set('a.md', Buffer.from('b'));
    const plan = await h.preview(first);
    files.set('a.md', Buffer.from('user'));
    await assert.rejects(h.restore(plan), /又发生变化/);
    const plan2 = await h.preview(first);
    await assert.rejects(h.restore(plan2), /恢复前备份/);
    assert.equal((await h.list()).length, 2);
    assert.equal(files.get('a.md').toString(), 'user');
    await assert.rejects(h.files('--all'), /无效/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
