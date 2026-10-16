const { lineDiff } = require("./domain/diff");
function turnSummaries(messages, journal, sessionId) {
  const anchors = new Map();
  for (const m of messages) {
    if (!m.runId || m.localPending || m.kind === "work") continue;
    if (m.role === "user" || (m.role === "assistant" && m.kind !== "progress"))
      anchors.set(m.runId, m.id);
  }
  const groups = new Map();
  for (const e of journal) {
    if (e.sessionId !== sessionId || !anchors.has(e.runId)) continue;
    if (!groups.has(e.runId)) groups.set(e.runId, []);
    groups.get(e.runId).push(e);
  }
  const summaries = new Map();
  for (const [runId, entries] of groups) {
    let plus = 0,
      minus = 0;
    for (const e of entries)
      for (const row of lineDiff(e.before || "", e.after || "")) {
        if (row.kind === "add") plus++;
        if (row.kind === "remove") minus++;
      }
    summaries.set(anchors.get(runId), {
      runId,
      files: new Set(
        entries.map((e) => (e.workspace || "vault") + "/" + e.path),
      ).size,
      operations: entries.length,
      plus,
      minus,
      undone: entries.every((e) => e.status === "undone"),
    });
  }
  return summaries;
}
function relativeTime(time, now = Date.now()) {
  if (!time) return "";
  const minutes = Math.max(0, Math.floor((now - time) / 60000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return minutes + " 分钟前";
  if (minutes < 1440) return Math.floor(minutes / 60) + " 小时前";
  if (minutes < 10080) return Math.floor(minutes / 1440) + " 天前";
  return new Date(time).toLocaleDateString();
}
module.exports = { turnSummaries, relativeTime };
