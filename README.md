# VaultBridge Agent

An OpenCode-powered agent sidebar for Obsidian. **[Download Windows release 0.7.5](https://github.com/Austrust/obsidian-vault-bridge/releases/tag/0.7.5)**. The release is available for manual installation; community-directory listing is a separate review process.

The [user-readiness audit](docs/USER-READINESS-2026-10-16.md) includes resolution evidence for configuration state, selection scope, onboarding and menu consistency. The 0.7.4 base was merged into `main` through PR #1; Windows CI validates each release.

[中文使用说明](README.zh-CN.md) · [Architecture](ARCHITECTURE.md) · [Current validation](TEST_REPORT.md) · [Issue ledger](docs/ISSUE-STATUS.md) · [MIT license](LICENSE)

## Use

- Use **+** to attach a whole note, only the selected text, external text or a Skill. Click a reference chip to preview its scope. Selection-only attachment does not include unselected text from that note. Type `@` at the caret to search notes; `/` lists available commands.
- Each conversation keeps its own draft and references. Enter sends; Shift+Enter adds a line; IME composition does not send.
- **执行** performs authorized operations. **规划** allows read-only analysis. Select a model from the composer; provider and endpoint are configured in settings.
- Edit a user message inline, then confirm to create a branch and send. Cancelling leaves the original conversation intact. Branching does not revert files.
- Active requests show progress and elapsed time. Additional prompts enter the queue; errors pause it. Stop fences subsequent tool writes.
- Context and output limits inherit OpenCode model configuration. The model picker supports per-endpoint/provider/model overrides; blank fields restore inheritance. Unknown limits are displayed explicitly instead of assuming 64K. The sidebar shows tokens from the last completed request (including cache and output), not cumulative session usage. Use **压缩上下文** or `/compact` to generate a summary; this costs model tokens, preserves history, supports cancellation, and refreshes usage after the next reply.
- Review changes from each turn or the session summary. **最近操作与撤销** previews and reverses recent Agent operations without Git or a whole-vault scan. Later manual edits cause a conflict instead of being overwritten.
- Permission requests show their target, text changes and expiry inside the conversation. They authorize one request and expire after two minutes.
- `/visualize` creates a DataviewJS card. Run it explicitly; save it once and reopen the saved note. DataviewJS has Obsidian privileges and is not sandboxed.

## Install and upgrade

Desktop validation baseline: Windows, Obsidian **1.14.4**, OpenCode **1.19.0**, Node **20+** for development. Other operating systems and versions are outside the current acceptance scope.

Follow the [Windows first-use guide](docs/GETTING-STARTED-WINDOWS.md) to install the three plugin files and the pinned OpenCode 1.19.0 binary. Settings include download links, executable selection and automatic detection, including common npm installations. Node is only needed for development. **应用并测试本地连接** verifies the local service; provider authentication is checked on the first prompt. API keys may remain session-only or be explicitly saved through OpenCode for reuse after restart. Saved keys live in OpenCode's local credential file, not vault data; this is not an OS-encrypted credential store.

For an existing installation, preserve its directory, ID, `data.json` and runtime:

```text
node build.cjs
node scripts/install.cjs "<existing-plugin-directory>" "<backup-directory-outside-plugin>"
```

New installations use the plugin ID and directory `vaultbridge-agent`. The former `vault-bridge` ID is already owned by an unrelated community plugin, so version 0.7.5 uses **VaultBridge Agent** as its community identity. Version 0.7.4 remains available unchanged.

The updater preserves the existing directory and ID for our older `vault-bridge` installations (author `Austrust`) and the legacy `obsidian-agent-demo`. It rejects unrelated or unverified authors using the conflicting ID. It backs up and replaces only the three release files. Reload the plugin after upgrading. Do not install the unrelated directory entry over this plugin, enable both old and new IDs together, or copy data/runtime into another ID as an implicit migration. Existing local installations continue using the manual in-place updater; switching to community-managed updates requires a separate migration.

Dataview with JavaScript queries is required only to run interactive cards. Git is optional and available under advanced settings for manual snapshots or old history.

## Network, accounts and file access

The plugin runs OpenCode with a dedicated data directory, separate from the desktop app and ordinary CLI, to avoid opening an incompatible shared database. On Windows it defaults to `%LOCALAPPDATA%/VaultBridge/AgentData`; an explicit `XDG_DATA_HOME` is used as the parent instead. This location persists across plugin updates. Credential checks use the same isolated store. Existing desktop credentials and databases are not migrated: enter the provider key in plugin settings after upgrading to isolation. Future OpenCode version upgrades still require database migration validation.

Existing installations under `vault-bridge` must use manual updates from this repository. Obsidian's community updater resolves that ID to the unrelated plugin; do not apply its suggested update to this installation. The new `vaultbridge-agent` ID is intended for community-managed installations.

VaultBridge is free under the MIT license. Model requests require access to the configured provider; DeepSeek requires an account, API key and available API credit. Provider charges are separate from this plugin. There is no VaultBridge subscription or developer-operated inference service.

When you send a prompt, a locally installed OpenCode 1.19.0 process communicates with the provider endpoint configured in settings (DeepSeek by default). Conversation text, attached notes or selections, selected Skills, external references and authorized tool results may be sent to that provider. Review its data-handling terms before sending private information. Removing a reference does not remove content already sent in a conversation. OpenCode is a separate application with its own configuration and network behavior; consult its [documentation](https://opencode.ai/docs/). Download links use official GitHub releases. VaultBridge includes no analytics or telemetry collection.

The plugin reads explicitly chosen external folders to supply reference material and Skills. External writes require separate authorization and follow tool permissions and recovery logging. It also reads the selected OpenCode executable and local credential store outside the vault; remembered credentials are stored by OpenCode in its local credential file. The plugin starts its local tool bridge and OpenCode service on loopback with authentication. It does not automatically install or update itself or OpenCode; the optional installation script must be run manually.

DataviewJS cards run only after a user clicks Run, can be inspected first and have Obsidian host privileges. Agent tool permissions do not sandbox card code.

## Develop and validate

```text
node build.cjs
node --test tests/*.test.js
node --check main.js
node scripts/package.cjs
```

Run `node tests/integration.cjs` with `OPENCODE_BIN` pointing to the installed executable. It uses an independent sample and a local scripted model, without paid API requests. The opt-in `tests/live-provider.cjs` uses existing DeepSeek credentials and a paid request only when `VAULTBRIDGE_LIVE_TEST=1` is set. `node tests/ui/server.cjs` serves the real bundle in an Obsidian UI fixture at `http://127.0.0.1:41967/`.

`dist/0.7.5/` contains a local delivery snapshot and source/release hashes. Windows CI builds and tests a clean checkout, verifies the committed bundle and uploads the release files. Version tags prepare a draft GitHub Release for explicit publication. Development history and the released code are preserved on `main`. Runtime credentials, vault data, histories and caches must remain outside source control.
