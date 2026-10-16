# VaultBridge

An OpenCode-powered agent sidebar for Obsidian. Current Windows release candidate: **0.7.4**. A public release has not been published.

The [user-readiness audit](docs/USER-READINESS-2026-10-16.md) now includes resolution evidence for configuration state, selection scope, onboarding and menu consistency. Windows build and release automation prepare a reviewable candidate; public distribution remains a separate step.

[中文使用说明](README.zh-CN.md) · [Architecture](ARCHITECTURE.md) · [Current validation](TEST_REPORT.md) · [Issue ledger](docs/ISSUE-STATUS.md) · [MIT license](LICENSE)

## Use

- Use **+** to attach a whole note, only the selected text, external text or a Skill. Click a reference chip to preview its scope. Selection-only attachment does not include unselected text from that note. Type `@` at the caret to search notes; `/` lists available commands.
- Each conversation keeps its own draft and references. Enter sends; Shift+Enter adds a line; IME composition does not send.
- **执行** performs authorized operations. **规划** allows read-only analysis. Select a model from the composer; provider and endpoint are configured in settings.
- Edit a user message inline, then confirm to create a branch and send. Cancelling leaves the original conversation intact. Branching does not revert files.
- Active requests show progress and elapsed time. Additional prompts enter the queue; errors pause it. Stop fences subsequent tool writes.
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

Both `vault-bridge` and the legacy `obsidian-agent-demo` are supported by the updater. It backs up and replaces only the three release files. Reload the plugin after upgrading. Never copy one installation's data or runtime into another ID as an implicit migration.

Dataview with JavaScript queries is required only to run interactive cards. Git is optional and available under advanced settings for manual snapshots or old history.

## Develop and validate

```text
node build.cjs
node --test tests/*.test.js
node --check main.js
node scripts/package.cjs
```

Run `node tests/integration.cjs` with `OPENCODE_BIN` pointing to the installed executable. It uses an independent sample and a local scripted model, without paid API requests. The opt-in `tests/live-provider.cjs` uses existing DeepSeek credentials and a paid request only when `VAULTBRIDGE_LIVE_TEST=1` is set. `node tests/ui/server.cjs` serves the real bundle in an Obsidian UI fixture at `http://127.0.0.1:41967/`.

`dist/0.7.4/` contains a local delivery snapshot and source/release hashes. Windows CI builds and tests a clean checkout, verifies the committed bundle and uploads the release files. Version tags prepare a draft GitHub Release. Development history is based on the existing upstream repository; the Windows candidate is maintained on a separate branch. Runtime credentials, vault data, histories and caches must remain outside source control.
