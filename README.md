# VaultBridge

An OpenCode-powered agent sidebar for Obsidian. Current Windows release candidate: **0.7.3**. A public release has not been published.

The latest [user-readiness audit](docs/USER-READINESS-2026-10-16.md) identifies open configuration-state, selection-scope, onboarding and interface issues. Earlier issue closure applies to its original review scope, not general release readiness.

[中文使用说明](README.zh-CN.md) · [Architecture](ARCHITECTURE.md) · [Current validation](TEST_REPORT.md) · [Issue ledger](docs/ISSUE-STATUS.md) · [MIT license](LICENSE)

## Use

- Use **+** to attach notes, the current selection, external text or a Skill. Type `@` at the caret to search notes; `/` lists available commands.
- Each conversation keeps its own draft and references. Enter sends; Shift+Enter adds a line; IME composition does not send.
- **执行** performs authorized operations. **规划** allows read-only analysis. Select a model from the composer; provider and endpoint are configured in settings.
- Edit a user message inline, then confirm to create a branch and send. Cancelling leaves the original conversation intact. Branching does not revert files.
- Active requests show progress and elapsed time. Additional prompts enter the queue; errors pause it. Stop fences subsequent tool writes.
- Review changes from each turn or the session summary. **最近操作与撤销** previews and reverses recent Agent operations without Git or a whole-vault scan. Later manual edits cause a conflict instead of being overwritten.
- Permission requests show their target, text changes and expiry inside the conversation. They authorize one request and expire after two minutes.
- `/visualize` creates a DataviewJS card. Run it explicitly; save it once and reopen the saved note. DataviewJS has Obsidian privileges and is not sandboxed.

## Install and upgrade

Desktop validation baseline: Windows, Obsidian **1.14.4**, OpenCode **1.19.0**, Node **20+** for development. Other operating systems and versions are outside the current acceptance scope.

New installation: copy `main.js`, `manifest.json`, `styles.css` into `<vault>/.obsidian/plugins/vault-bridge/`, enable VaultBridge, then configure your installed OpenCode executable and model in settings. **自动检测安装** locates the runtime; credential presence is reported automatically. **应用并测试本地连接** verifies the local service; provider authentication is checked on the first prompt. Startup requires the tested OpenCode 1.19.0 health response before registering note tools. A session API key remains in memory; existing OpenCode credentials are reused.

For an existing installation, preserve its directory, ID, `data.json` and runtime:

```text
node build.cjs
node scripts/install.cjs "<existing-plugin-directory>" "<backup-directory-outside-plugin>"
```

Both `vault-bridge` and the legacy `obsidian-agent-demo` are supported by the updater. It backs up and replaces only the three release files. Reload the plugin after upgrading. Never copy one installation's data or runtime into another ID as an implicit migration.

Dataview with JavaScript queries is required only to run interactive cards. Git is optional and available under advanced settings for manual snapshots or old history.

## Develop and validate

```text
node build.cjs
node --test tests/*.test.js
node --check main.js
node scripts/package.cjs
```

Run `node tests/integration.cjs` with `OPENCODE_BIN` pointing to the installed executable. It uses an independent sample and a local scripted model, without paid API requests. `node tests/ui/server.cjs` serves the real bundle in an Obsidian UI fixture at `http://127.0.0.1:41967/`.

`dist/0.7.3/` contains a local delivery snapshot and source/release hashes. Development history is based on the existing upstream repository; the Windows candidate is maintained on a separate branch. Runtime credentials, vault data, histories and caches must remain outside source control.
