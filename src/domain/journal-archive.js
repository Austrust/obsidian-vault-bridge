"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
/** Explicit archival never deletes Git commits or unconfirmed recovery entries. */
async function archiveJournal({
  journal,
  directory,
  persist,
  guard,
  keep = 100,
}) {
  guard();
  const candidates = journal.filter((e) =>
    ["applied", "undone", "failed"].includes(e.status),
  );
  const recentRunIds = [
    ...new Set(
      journal
        .slice()
        .reverse()
        .map((e) => e.runId)
        .filter(Boolean),
    ),
  ].slice(0, 20);
  const protectedRuns = new Set(recentRunIds);
  const protectedIds = new Set(candidates.slice(-keep).map((e) => e.id));
  for (const e of journal)
    if (
      protectedIds.has(e.id) ||
      !["applied", "undone", "failed"].includes(e.status)
    )
      if (e.runId) protectedRuns.add(e.runId);
  const selected = candidates.filter(
    (e) => !protectedIds.has(e.id) && !protectedRuns.has(e.runId),
  );
  if (!selected.length) return null;
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(
    directory,
    Date.now() + "-" + crypto.randomUUID() + ".json",
  );
  guard();
  await fs.writeFile(
    file,
    JSON.stringify({ schemaVersion: 1, entries: selected }, null, 2),
    {
      flag: "wx",
      mode: 0o600,
    },
  );
  guard();
  const saved = [...journal],
    ids = new Set(selected.map((e) => e.id));
  journal.splice(0, journal.length, ...journal.filter((e) => !ids.has(e.id)));
  try {
    await persist();
  } catch (error) {
    journal.splice(0, journal.length, ...saved);
    throw error;
  }
  return { file, count: selected.length };
}
module.exports = { archiveJournal };
