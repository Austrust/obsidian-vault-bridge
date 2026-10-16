# VaultBridge Agent 0.7.8

Includes the merged OpenCode data-isolation fix (PR #2) and model context controls (PR #3).

- OpenCode uses a dedicated, stable data directory, avoiding incompatible databases shared with the desktop app or ordinary CLI. Credential checks use this same isolated store.
- Context and output limits inherit model configuration; optional overrides are scoped to endpoint, provider and model. Unknown limits are shown explicitly.
- The sidebar displays token usage from the last completed request, including cache and output, instead of a cumulative session total.
- Use **压缩上下文** or `/compact` to summarize the conversation with the selected model. Compaction costs model tokens, supports stop and timeout, preserves the original transcript, and refreshes usage after the next reply.

## Upgrade

Upgrading from shared OpenCode storage requires entering the provider key again in plugin settings. Existing desktop/CLI databases and credentials are preserved but are not automatically migrated; their sessions may not appear in the isolated store. On Windows the default data root is `%LOCALAPPDATA%/VaultBridge/AgentData`; an explicit `XDG_DATA_HOME` supplies the parent instead.

Keep the existing plugin directory, ID, `data.json` and runtime for manual in-place updates. The public ID remains `vaultbridge-agent`. The updater backs up and replaces only the three release files. This release does not automatically update an existing installation or move user data.

## Validation

118 automated tests passed with zero failures or skips. Both real OpenCode 1.19.0 integration suites passed using independent samples and local scripted providers, covering note operations and undo, credential isolation, restart and failure handling, model limits, token usage, compaction and retained history. No user vault changes or paid inference were used. The release workflow rebuilds and verifies GitHub provenance for `main.js`, `manifest.json` and `styles.css`.

Windows baseline: Obsidian 1.14.4 and OpenCode 1.19.0. Filesystem, process and write-only clipboard capabilities remain disclosed. Community review remains a separate process; publication does not imply approval.
