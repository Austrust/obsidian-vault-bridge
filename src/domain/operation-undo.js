"use strict";

// Plan only the files touched by the selected operations, in reverse order.
// A virtual file map also validates dependent edit -> move -> delete sequences.
async function planUndo(entries, storageFor, guard) {
  if (!entries.length) throw Error("没有可撤销的修改");
  const files = new Map();
  const operations = [];
  for (const entry of entries) {
    guard();
    if (entry.status !== "applied")
      throw Error("操作结果未确认，不能自动撤销：" + entry.path);
    const storage = storageFor(entry);
    const key = (p) => JSON.stringify([entry.workspace || "", p]);
    const read = async (p, absenceAllowed = false) => {
      if (!files.has(key(p))) {
        if (absenceAllowed && !storage.readOptional)
          throw Error("存储适配器不支持安全检查路径是否存在");
        files.set(
          key(p),
          await (storage.readOptional
            ? storage.readOptional(p)
            : storage.read(p)),
        );
      }
      return files.get(key(p));
    };
    const expect = async (p, text) => {
      if ((await read(p, text === undefined)) !== text)
        throw Error("文件存在后续修改或路径被占用，未撤销：" + p);
    };
    const kind = entry.kind || "edit";
    if (kind === "move" || kind === "rename") {
      await expect(entry.destination, entry.after);
      await expect(entry.path, undefined);
      files.set(key(entry.destination), undefined);
      files.set(key(entry.path), entry.before);
    } else if (kind === "delete") {
      await expect(entry.path, undefined);
      files.set(key(entry.path), entry.before);
    } else if (kind === "edit" || kind === "create") {
      await expect(entry.path, entry.after);
      files.set(key(entry.path), kind === "create" ? undefined : entry.before);
    } else throw Error("不支持撤销此操作：" + kind);
    operations.push({ entry, storage, kind });
  }
  guard();
  return operations;
}

async function applyUndo(operations, persist, guard) {
  let completed = 0;
  for (const { entry, storage, kind } of operations) {
    guard();
    // Persist intent before touching files. On restart, "undoing" is ambiguous
    // and must never be replayed automatically (especially a creation removal).
    entry.status = "undoing";
    try {
      await persist();
    } catch (error) {
      entry.status = "applied";
      throw Error(`撤销记录保存失败；已撤销 ${completed} 项：${error.message}`);
    }
    try {
      guard();
      if (kind === "create") {
        entry.undoRecoveryPath = await storage.removeCreated(
          entry.path,
          entry.after,
          guard,
        );
      } else if (kind === "delete") {
        await storage.create(entry.path, entry.before, guard);
      } else if (kind === "move" || kind === "rename") {
        await storage.relocate(
          entry.destination,
          entry.path,
          entry.after,
          guard,
        );
      } else
        await storage.compareWrite(
          entry.path,
          entry.after,
          entry.before,
          guard,
        );
      entry.status = "undone";
      entry.undoneAt = Date.now();
      completed++;
      await persist();
    } catch (error) {
      // Keep the original snapshots and an explicit uncertain state. Never
      // claim all-or-nothing when a filesystem operation can partially fail.
      if (entry.status !== "undone") entry.status = "undoing";
      entry.undoError = error.message;
      await persist().catch(() => {});
      throw Error(
        `撤销中断，已撤销 ${completed} 项；请检查 ${entry.path} 及恢复目录：${error.message}`,
      );
    }
  }
  return { count: completed };
}

function recentRuns(journal, sessionId, limit = 20) {
  const groups = new Map();
  for (const e of journal.slice().reverse()) {
    if (!e.runId || (sessionId && e.sessionId !== sessionId)) continue;
    if (!groups.has(e.runId))
      groups.set(e.runId, { id: e.runId, time: e.time, entries: [] });
    groups.get(e.runId).entries.push(e);
  }
  return [...groups.values()].slice(0, limit);
}
module.exports = { planUndo, applyUndo, recentRuns };
