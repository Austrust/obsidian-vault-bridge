'use strict';
const { vaultPath } = require('../domain/note-engine');
class NoteTools {
  constructor({
    engine,
    files,
    read,
    active,
    publish,
    permissions,
    resources,
    external,
    skillFile,
  }) {
    Object.assign(this, {
      engine,
      files,
      read,
      active,
      publish,
      permissions,
      resources,
      external,
      skillFile,
    });
  }
  async call(name, args, run) {
    this.engine.guard(run);
    if (!run) throw Error('没有进行中的任务');
    if (this.permissions)
      await this.permissions.authorize(name, args, () => this.engine.guard(run));
    if (name === 'patch_external' || name === 'create_external')
      return this.external(name, args, run);
    if (name === 'read_skill_file') return this.skillFile(args.skill, args.path);
    if (name === 'list_resources') return this.resources.roots();
    if (name === 'list_external') return this.resources.list(args.root, args.path);
    if (name === 'read_external') return this.resources.read(args.root, args.path);
    if (name === 'active_note') {
      const a = this.active();
      return a ? { ...(await this.engine.read(a.path)), selection: a.selection } : null;
    }
    if (name === 'read_note') return this.engine.read(args.path);
    if (name === 'search_notes') {
      const q = args.query.toLowerCase(),
        results = [];
      for (const f of this.files()) {
        if (results.length >= 20) break;
        try {
          vaultPath(f.path);
          const text = await this.read(f.path);
          const at = text.toLowerCase().indexOf(q);
          if (f.path.toLowerCase().includes(q) || at >= 0)
            results.push({
              path: f.path,
              excerpt: text.slice(Math.max(0, at - 70), Math.max(0, at) + 240),
            });
        } catch {}
      }
      return { results, limit: 20 };
    }
    if (name === 'patch_note')
      return this.engine.patch(args.path, args.revision, args.oldText, args.newText, run);
    if (name === 'create_note') return this.engine.create(args.path, args.text, run);
    if (name === 'move_note' || name === 'rename_note')
      return this.engine.relocate(
        args.path,
        args.destination,
        args.revision,
        run,
        name === 'rename_note',
      );
    if (name === 'delete_note') return this.engine.deleteNote(args.path, args.revision, run);
    if (name === 'publish_visualization') {
      this.engine.guard(run);
      if (args.code.length > 100000) throw Error('卡片代码过长');
      if (args.sourcePath) vaultPath(args.sourcePath);
      return this.publish(args);
    }
    throw Error('未知工具');
  }
}
module.exports = { NoteTools };
