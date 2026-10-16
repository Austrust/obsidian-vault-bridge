const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  hash,
  vaultPath,
  checkPhysical,
  replaceExact,
  NoteEngine,
  startBridge,
} = require('../core');
function fixture() {
  const notes = new Map([['研究.md', '目标：旧内容\n']]);
  const journal = [];
  const s = {
    read: async (p) => {
      if (!notes.has(p)) throw Error('missing');
      return notes.get(p);
    },
    compareWrite: async (p, b, a, g) => {
      g();
      if (notes.get(p) !== b) throw Error('conflict');
      notes.set(p, a);
    },
    create: async (p, t, g) => {
      g();
      if (notes.has(p)) throw Error('exists');
      notes.set(p, t);
    },
  };
  const e = new NoteEngine(s, journal);
  e.start('turn');
  return { e, notes, journal, s };
}
test('拒绝路径越界及隐藏配置', () => {
  for (const p of [
    '../a.md',
    '/tmp/a.md',
    'a/../../b',
    '.obsidian/x',
    'a\\b',
    'a//b',
    'C:/x',
    'a/.private/x',
  ])
    assert.throws(() => vaultPath(p));
  assert.equal(vaultPath('项目/研究.md'), '项目/研究.md');
});
test('阻止符号链接越界', async () => {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'na-'));
  try {
    await fs.mkdir(path.join(d, 'vault'));
    await fs.symlink(os.tmpdir(), path.join(d, 'vault', 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(checkPhysical(path.join(d, 'vault'), 'escape/a.md'));
    await checkPhysical(path.join(d, 'vault'), 'new/a.md');
  } finally {
    await fs.rm(d, { recursive: true, force: true });
  }
});
test('唯一替换及修改撤销', async () => {
  const { e, notes, journal } = fixture();
  const r = await e.read('研究.md');
  await e.patch(r.path, r.revision, '旧内容', '新内容', 'turn');
  assert.equal(notes.get(r.path), '目标：新内容\n');
  e.stop();
  await e.undo(journal[0].id);
  assert.equal(notes.get(r.path), r.text);
});
test('并发修改冲突不覆盖用户内容', async () => {
  const { e, notes } = fixture();
  const r = await e.read('研究.md');
  notes.set(r.path, '用户正在写');
  await assert.rejects(e.patch(r.path, r.revision, '旧内容', '新内容', 'turn'), /文档已变化/);
  assert.equal(notes.get(r.path), '用户正在写');
});
test('停止后拒绝写入及已排队写入', async () => {
  const { e, notes } = fixture();
  const r = await e.read('研究.md');
  const p = e.patch(r.path, r.revision, '旧内容', '新内容', 'turn');
  e.stop();
  await assert.rejects(p, /停止/);
  assert.equal(notes.get(r.path), r.text);
});
test('撤销不覆盖后续编辑', async () => {
  const { e, notes, journal } = fixture();
  const r = await e.read('研究.md');
  await e.patch(r.path, r.revision, '旧内容', '新内容', 'turn');
  e.stop();
  notes.set(r.path, '后续人工内容');
  await assert.rejects(e.undo(journal[0].id));
  assert.equal(notes.get(r.path), '后续人工内容');
});
test('串行写入第二次过期 revision 失败', async () => {
  const { e } = fixture();
  const r = await e.read('研究.md');
  const a = e.patch(r.path, r.revision, '旧内容', '一', 'turn');
  const b = e.patch(r.path, r.revision, '旧内容', '二', 'turn');
  await a;
  await assert.rejects(b);
});
test('拒绝歧义和不存在替换', () => {
  assert.throws(() => replaceExact('aa aa', 'aa', 'b'));
  assert.throws(() => replaceExact('aa', 'bb', 'b'));
});
test('MCP 身份验证、工具列表与参数验证', async () => {
  const bridge = await startBridge(async (n, a) => ({ name: n, args: a }));
  try {
    assert.equal((await fetch(bridge.url, { method: 'POST', body: '{}' })).status, 401);
    const rpc = async (method, params) => {
      const r = await fetch(bridge.url, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + bridge.token },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      return r.json();
    };
    assert.equal((await rpc('initialize')).result.serverInfo.name, 'obsidian-note-agent');
    const listed = (await rpc('tools/list')).result.tools;
    assert.equal(listed.length, 15);
    assert(listed.some((t) => t.name === 'read_external'));
    assert(listed.some((t) => t.name === 'patch_external'));
    assert.equal(
      (await rpc('tools/call', { name: 'read_note', arguments: { path: 2 } })).result.isError,
      true,
    );
    assert.equal(
      (await rpc('tools/call', { name: 'read_note', arguments: { path: '研究.md' } })).result
        .isError,
      undefined,
    );
  } finally {
    await bridge.close();
  }
});
