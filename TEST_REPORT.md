# 0.7.6 validation

0.7.6 changes release metadata, the release workflow and README disclosures in response to the community review. `main.js` and `styles.css` are byte-identical to 0.7.5. The release workflow builds and tests before generating and verifying GitHub provenance attestations. Only the three supported Obsidian files are attached to the Release; checksums remain in the CI artifact and local package.

## 0.7.5 acceptance record

Version 0.7.5 changes the public ID to `vaultbridge-agent` and display name to VaultBridge Agent after the directory rejected the conflicting `vault-bridge` ID. No backend behavior or data migration is changed.

105 automated tests passed, zero failures or skips. The updater accepts the new ID and preserves both legacy IDs, data and runtime; a new regression proves it refuses an unrelated author under `vault-bridge` without writing backups or plugin files. The real Obsidian installation reports 0.7.5 / VaultBridge Agent while retaining its legacy ID and unchanged data. Eight light/dark, width and zoom layout combinations passed with the longer name; screenshot inspection confirmed title truncation keeps actions visible. Installation backed up the three release files first.

The real provider, runtime failure and comprehensive menu tests below were performed for 0.7.4. They are retained evidence for the unchanged backend, not new paid provider runs for this metadata and naming update.

## 0.7.4 acceptance record

Validated on Windows with Obsidian 1.14.4, OpenCode 1.19.0 and Node 24.19.0 on 2026-10-16. Release 0.7.4 is publicly available and PR #1 is merged into main. Community-directory approval is separate from these checks.

## Automated checks

104 tests passed, zero failures and zero skips. Coverage includes operation undo, later user-edit conflicts, interrupted writes, run fencing, queue failures, credential routing, session context, artifact persistence and Windows filesystem/process behavior. New regressions cover connection-draft reconciliation, visible Skill/resource drafts, selection-only scope, remembered credential acknowledgement and injected upgrade failure restoring old files while preserving user data.

The production bundle was rebuilt using `node build.cjs`. Windows CI repeats build, syntax checks, tests and package generation from a clean checkout, and rejects a committed bundle that does not match the sources.

## Runtime and provider acceptance

- Downloaded the official Windows x64 OpenCode 1.19.0 archive into a new installation directory through `scripts/setup-opencode.ps1`. SHA-256 and executable version passed. Existing runtime installations were preserved.
- The real OpenCode integration suite used isolated configuration, credential and runtime directories with a local scripted provider. Read/edit/create, artifact handling, permission policy, undo, branch, restart and saved-credential endpoint/model changes passed.
- Credentials were saved through the real local authentication API, then reused after restarting the isolated runtime. Authentication rejection, network failure, timeout and explicit stop all ended the run. Failed startup released the child process and MCP resources.
- An opt-in real DeepSeek request with `deepseek-flash` read a fictional sample through the production `read_note` bridge and returned its expected marker. No user notes were supplied; writes were denied and the journal stayed empty. A separate request using an intentionally invalid credential returned HTTP 401.

The fresh-directory test is evidence for a new OpenCode installation and isolated runtime setup on this Windows device. It is not a test of a newly installed Windows OS or other operating systems. Network/timeout/stop fault injection used the real runtime with a local provider; it did not deliberately disrupt the user's network.

## Native Obsidian acceptance

Official CLI development commands exercised the installed 0.7.4 UI using an independent in-memory host. No user notes were deleted or rolled back.

- Eight native behavior assertions passed: selection preview excludes unselected text; resource/Skill drafts survive tab switches; saved Skill path equals the visible value; history initially shows 20 of 25 sessions; settings follow external model changes; conflicting drafts block saving; reset loads current configuration; cards show code and execution privileges before running.
- Twenty-one native captures covered light/dark chat, selection preview, resource/Skill/workspace tabs, model/history pickers, five settings groups, undo and review. Each measured zero horizontal overflow. Full-width paths/search, aligned history titles, grouped buttons and basic/advanced connection fields were visually inspected.
- Eight layout combinations passed: light/dark themes with 320/360/420 px widths and 100/125/150% zoom. The 320 × 360 / 125% sample included multiline input, an error, a queued prompt and approval. Send stayed inside the sidebar and above the status bar. The runner unmaximizes before resizing and rejects a measured height that differs from the requested height, preventing a false pass on a maximized window.
- The final upgrade backed up release files, installed 0.7.4, reloaded the plugin and preserved `data.json`. Installed files match the source bundle and styles. Test hosts, modals, width, window geometry, zoom and theme were restored.

The previous 0.7.3 native keyboard acceptance remains relevant: slash navigation, Shift+Enter, single Enter send, keyboard menu placement, default-deny approval focus and nested review/undo Escape handling. These are retained regressions, not claims of new keyboard runs in this round.

## Reproduce and evidence

```text
node build.cjs
npm run check
npm test
node scripts/package.cjs
```

For integration, set `OPENCODE_BIN` to OpenCode 1.19.0 and run `node tests/integration.cjs`. `tests/live-provider.cjs` is explicitly gated by `VAULTBRIDGE_LIVE_TEST=1`, consumes a paid request and reads existing local DeepSeek credentials without printing them. Native helpers require the official host CLI and always need fixture/layout restoration by the caller. `tests/native-user-readiness.cjs` handles its own fixture cleanup.

Raw logs, screenshots and machine-specific installation records stay under ignored `docs/local-validation/`; they are excluded from source control and release packages. Public results are summarized here and in the [issue ledger](docs/ISSUE-STATUS.md). The release workflow checks tag/manifest agreement and prepares a draft with the three release files plus hashes; draft preparation is not public publication.
