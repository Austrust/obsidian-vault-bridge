// Older records without an explicit session remain in the global history.
function sessionChanges(journal, sessionId) {
  if (!sessionId) return [];
  return journal
    .filter((e) => e.sessionId === sessionId)
    .slice()
    .reverse();
}
module.exports = { sessionChanges };
