const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PermissionGate } = require('../src/domain/permissions');
const { NoteTools } = require('../src/backend/note-tools');
const { NoteEngine, hash } = require('../src/domain/note-engine');
test('permission defaults deny destructive actions and unknown tools', async () => {
  const gate = new PermissionGate(
    () => ({}),
    () => {
      throw Error('unexpected');
    },
  );
  await gate.authorize('read_note', {}, () => {});
  for (const name of ['delete_note', 'move_note', 'rename_note', 'bash'])
    await assert.rejects(
      gate.authorize(name, {}, () => {}),
      /拒绝/,
    );
});
test('ask approves once, rejects close/cancel and rechecks live policy', async () => {
  let finish,
    closed = 0;
  const settings = { delete_note: 'ask' };
  const gate = new PermissionGate(
    () => settings,
    (_, done) => {
      finish = done;
      return () => closed++;
    },
  );
  let allowed = gate.authorize('delete_note', { path: 'a.md' }, () => {});
  finish(true);
  await allowed;
  assert.equal(closed, 1);
  allowed = gate.authorize('delete_note', {}, () => {});
  gate.cancel();
  await assert.rejects(allowed, /未批准/);
  allowed = gate.authorize('delete_note', {}, () => {});
  settings.delete_note = 'deny';
  finish(true);
  await assert.rejects(allowed, /撤销/);
});
test('tool gate prevents dispatch and cancellation invalidates an approval', async () => {
  let calls = 0,
    finish;
  const engine = {
    runID: 'r',
    guard(id) {
      if (this.runID !== id) throw Error('stopped');
    },
    deleteNote: () => calls++,
  };
  const settings = { delete_note: 'ask' };
  const gate = new PermissionGate(
    () => settings,
    (_, done) => {
      finish = done;
    },
  );
  const tools = new NoteTools({ engine, permissions: gate });
  const call = tools.call('delete_note', { path: 'a.md', revision: 'x' }, engine.runID);
  engine.runID = null;
  finish(true);
  await assert.rejects(call, /stopped/);
  assert.equal(calls, 0);
});
test('move, rename and trash enforce revisions, paths and run fence', async () => {
  const notes = new Map([['a.md', 'text']]);
  const engine = new NoteEngine(
    {
      read: async (p) => {
        if (!notes.has(p)) throw Error('missing');
        return notes.get(p);
      },
      relocate: async (p, d, t, g) => {
        g();
        if (notes.has(d)) throw Error('exists');
        notes.delete(p);
        notes.set(d, t);
      },
      removeCreated: async (p, t, g) => {
        g();
        assert.equal(notes.get(p), t);
        notes.delete(p);
      },
    },
    [],
  );
  engine.start('r');
  await assert.rejects(engine.relocate('a.md', 'folder/b.md', hash('text'), 'r', true), /跨目录/);
  await assert.rejects(engine.relocate('a.md', 'b.md', 'bad', 'r'), /变化/);
  await engine.relocate('a.md', 'b.md', hash('text'), 'r', true);
  await engine.relocate('b.md', 'folder/b.md', hash('text'), 'r');
  assert(notes.has('folder/b.md'));
  engine.stop();
  await assert.rejects(engine.deleteNote('folder/b.md', hash('text'), 'r'), /停止/);
  engine.start('next');
  await engine.deleteNote('folder/b.md', hash('text'), 'next');
  assert.equal(notes.size, 0);
});
