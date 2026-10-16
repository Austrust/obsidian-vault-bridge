# Architecture · 0.7.3 · Windows workspace

VaultBridge separates the Obsidian interface from agent execution and note mutations. The release remains a single `main.js`; development uses small CommonJS modules with no bundler dependencies.

## Boundaries

| Module | Responsibility |
| --- | --- |
| `src/plugin.js` | Composition root, commands and lifecycle barrier |
| `src/ui/` | Chat view, settings, example card; no HTTP or process management |
| `src/presentation.js` | Pure message normalization, titles and grouped execution records |
| `src/backend/conversation-service.js` | Session lifecycle using the normalized harness contract, cancellation and polling |
| `src/backend/opencode-runtime.js` | Owned process, authenticated local connection, MCP registration and cleanup |
| `src/backend/opencode-client.js` | HTTP protocol and agent configuration |
| `src/backend/mcp-server.js` | Authenticated note-tool transport and schemas |
| `src/backend/note-tools.js` | Tool dispatch against injected note and card adapters |
| `src/domain/note-engine.js` | Revision checks, write serialization, run fencing and undo |
| `src/domain/workspace-store.js` | Versioned persistence snapshots and ordered writes |

The UI receives a host facade for actions and state. ConversationService receives runtime, note engine, state, persistence, context and model adapters. This supports tests without Obsidian or a paid API.

## Lifecycle

A runtime connection is shared while startup is in progress. Each connection generation fences cancelled startups. A failed launch releases its MCP server and child process. Disconnect closes resources; an unexpected process exit invalidates the active note run. A subsequent connection can start a fresh process.

A conversation reserves the workspace before asynchronous connection begins. Stop cancels that turn and immediately fences writes, then requests OpenCode abort. Session switches also reserve the workspace. Completion, error and cancellation release the run lock. Timeouts surface as errors rather than successful cancellation.

Note mutation guarantees remain in NoteEngine, independently of the UI or model. Reads return revisions; edits compare revisions and current editor/file content. Undo checks for subsequent user edits. New notes also persist a pending creation record before writing. User-triggered undo checks content and preserves the file in the reserved VaultBridge Recovery directory; failed or unconfirmed creations cannot be removed automatically.

## State compatibility

`schemaVersion: 2` snapshots retain settings, journal, artifacts, transcript, session ID, user labels and session titles. Existing unversioned data is read without discarding those fields. Runtime connection flags and the session-only API key are not persisted. Legacy cached tool strings remain displayable.

Keep the same plugin ID and runtime directory when upgrading in place. Changing from the original `obsidian-agent-demo` ID to `vault-bridge` is a separate migration: OpenCode session lookup depends on its working directory. Do not silently move it during a UI update.

## Local diff and history

`src/domain/diff.js` computes line-level differences with a bounded LCS and a replacement fallback for large edits. Context folding happens only in presentation; full snapshots remain in the journal. `src/ui/change-history.js` renders text-only diffs with lazy expansion and 20-record pagination. Legacy edit records without a kind remain readable. Creation records add `kind: create` and the originating run ID.

## Extension points

New note tools belong in the tool schema and NoteTools dispatcher, with mutation checks in NoteEngine. New presentation types belong in message normalization and the UI. A future harness adapter can implement connection/request/abort behavior and normalize messages to the same presentation model. ConversationService now uses the normalized Harness contract in src/contracts.js. OpenCodeSessions owns all session HTTP routes and message conversion. A second backend must implement this contract, including trusted run binding and cancellation; no second backend is bundled.

A future streaming transport can replace polling inside ConversationService. Storage migrations should be added at WorkspaceStore, preserving existing fields and versioned fixtures. Card execution remains explicitly user-triggered DataviewJS and is not sandboxed. No new agent permissions were added by this refactor.

## Git and permission boundaries

GitHistory owns a local bare repository, temporary indexes, blob/tree/commit creation and compare-and-swap ref updates. It uses argv-based Git processes (no shell), disables hooks and global/system Git configuration, and clears inherited Git environment overrides. Snapshots come from an injected Obsidian binary/editor adapter. GitHistory has no remote or push code. Restores validate the preview, commit a rescue snapshot, apply checked file operations sequentially and commit the result; partial failure reports the rescue SHA.

ConversationService verifies journal persistence before NoteEngine.start and waits for queued mutations to settle before final persistence. There are no automatic Git checkpoints. Recovery persistence failures fence writes; cleanup failures reject the turn so TurnQueue pauses. A failed delivery is marked as attempted and cannot be replayed simply by resuming the queue. PermissionGate authorizes every MCP operation before dispatch; deny wins, ask grants only one request and checks the run fence again. OpenCode still denies native tools and allows only the note bridge.

Policy defaults preserve existing operations and deny newly added move/rename/delete. Only user-interface callbacks can change settings; there is no model tool for policy modification, Git reset or bypassing recovery logging. DataviewJS retains Obsidian privileges and is outside this boundary.


## 0.5 ownership and storage

`VaultAdapter` centralizes editor/vault operations. Text restoration shares the same compare-write path as ordinary edits. Destructive file removal and binary replacement preserve the original by rename into `VaultBridge Recovery/<uuid>/...`, then verify it. New destination creation is exclusive at the Vault API boundary. Concurrent changes to a renamed file remain in the recovery copy; conflicts are surfaced rather than silently overwritten. This is preservation, not a filesystem-wide transaction or OS sandbox. Recovery copies are excluded from snapshots and tool access, and never automatically deleted.

`ArtifactService` owns artifact persistence and Markdown export; `SessionHistory` owns its picker. `OpenCodeSessions` converts protocol messages to `{id,role,finish,completed,error,view}`. The runtime owns one process and bridge token per run, revokes before cancellation, closes transport and waits for termination (2s TERM / 5s bounded cleanup). It emits only allowlisted stderr error categories. Normal runs disconnect after finishing; sending reconnects automatically with the existing session directory.

`ConversationService.dispose()` revokes the run, disables refresh/save/post-run callbacks and returns the pending turn drain. Plugin unload marks the VaultAdapter inactive, discards queued store snapshots, and places a drain barrier on the app using a shared Symbol. Reload awaits that barrier before loading data. Already-started store writes and queued file operations settle before replacement instances load; no new post-unload snapshot is promised.

Git previews retain blob IDs only. Restore re-reads the authoritative target tree, verifies the current manifest, creates a rescue commit, and loads target blobs one at a time. The UI discards prior preview panels and ignores stale async preview results. Snapshot capture is still a sequential full scan, not a point-in-time atomic filesystem snapshot. Journal archival is explicit and writes a complete archive before removing entries from active state; persistence failure restores the in-memory list.

## 0.5.1 session history

NoteEngine binds journal entries to runId and sessionId. The conversation panel uses that explicit ownership; old entries without ownership remain available in global history. `operation-undo.js` validates a reverse operation plan against a virtual file map, then applies checked inverses through storage adapters. This handles dependent create/edit/move/rename/delete sequences without reading unrelated files. `undoing` is persisted before inverse writes, and `undone` after success. Uncertain or failed rounds require inspection rather than blind replay. The plugin reservation and shared serial queue exclude overlapping Agent work; external/manual writers are checked but not globally locked.

SessionHistory supports title changes and reversible local archive metadata stored in WorkspaceStore.sessionMeta. Archiving does not delete OpenCode sessions, journals or Git commits. Mutation of session metadata uses the conversation reservation to reject active runs.

## 0.6 workspace capabilities

TurnQueue stores per-session deferred prompts with captured context; restart is paused and failures stop automatic delivery. ConversationService supports a context override and fork-before-message through the normalized harness. Forking never reverts files. WorkspaceStore preserves draft, queue and redacted lastFailure alongside prior fields.

Resources owns bounded text reads and explicit local Skill discovery. ExternalWorkspace reuses the mutation serial queue and run fence, writes a pending journal entry before mutation, and preserves replaced originals. Its readOptional/compareWrite/create/removeCreated adapter supports the same operation undo as the vault. Explicit user recovery may target a still-authorized root without reenabling Agent writes. Independent GitHistory remains optional for manual snapshots only. PermissionGate controls external tools and planning mode denies write tools. Changing the preferred resource root resets external write authorization. The harness working directory remains stable.

`UndoHistory` previews the latest 20 rounds with file operations. Full logs retain single-operation undo and original snapshots. Explicit archival keeps complete recent/unresolved rounds; it never splits a run or deletes recovery files. See [current recovery scope and test evidence](docs/OPERATION-RECOVERY.md).

## 0.7 session presentation and delivery

0.7.2 verifies `{ healthy, version }` from `/global/health` before MCP registration; the tested support set is exactly OpenCode 1.19.0. Failed compatibility checks use the existing cleanup path. Protocol source: [OpenCode server reference](https://opencode.ai/docs/zh-cn/server).

AgentView initially mounts the latest 100 presentation items, with explicit 100-item expansion; complete transcript data is retained. Cards whose originating runs are outside the window wait until those messages are loaded. Incoming messages preserve an expanded reading window; explicit sending follows the tail. Scroll requests share one animation frame to prevent hundreds of redundant callbacks and layout-induced loss of the follow-tail intent. History lists render 20 rows per page. HTTP response bodies are bounded to 10 MB; polling remains whole-session retrieval within that bound, not network pagination. Browser performance evidence is separate from native Obsidian verification.

0.7.2 stages connection changes in a validated settings draft. `configureConnection` reserves the conversation lifecycle through disconnect, persistence and optional reconnect; failed persistence restores the former settings and in-memory key. `/provider` supplies model metadata, explicitly distinguished from a successful remote inference. Saved-credential routing to a changed endpoint/model is covered by a real OpenCode test with isolated credentials.

`presentation-turns` anchors file summaries to the final answer and filters journal ownership by both session and run. Expanded approvals share the original expiry and resolve once, with denial focused initially. Queue context capture reserves submission without overwriting subsequent typing. Jump controls participate in normal sidebar layout so multiline input and zoom do not cause overlap.

SessionComposer stores independent draft, note references, selection, Skills and external references by session. An implicit first session adopts the unsent composer; explicit new sessions start empty; forks copy context. Pending messages are volatile and replaced by the acknowledged user message; messageRuns persists turn ownership. Journal and artifact displays use both session and run ownership.

The composer has a caret-aware mention/command list. Message editing creates a branch only after confirmation. Review opens a scoped modal instead of consuming fixed sidebar height. Errors, queue and approvals live in the scrolling conversation. PermissionGate supplies a two-minute expiry; closing the view or stopping denies pending requests. The fallback modal uses the same target/diff renderer.

Runtime provider configuration is always emitted even when OpenCode supplies stored credentials; an empty session key never overrides stored authentication. Setup diagnostics use argv-based executable probing and report credential presence only. Model switching is idle-only and restarts the owned service. ArtifactService serializes per-card saves, reopens existing exports and refuses conflicting content.

scripts/install.cjs upgrades only the three release files, preserves the existing supported plugin ID, backs up prior release files and reports data.json hash stability. scripts/package.cjs copies only the three release files and deterministic source/release SHA-256 manifests. The Windows candidate preserves the existing upstream Git history and also includes deterministic source and release hashes.

## 0.7.3 native host acceptance

Keyboard-triggered menus use the trigger button rectangle, including after asynchronous callbacks clear currentTarget. Pointer activation retains pointer positioning. PermissionModal sets its initial deny focus after the host Modal.open focus pass. ChangeHistory keeps filtering in filterScope, preserving Modal.scope for keyboard dispatch and Escape. Native CLI checks exercise real Obsidian Markdown, menus, settings windows and keyboard input; native-fixture.cjs replaces only the view host with an in-memory sample, and native-layout.cjs measures both themes and zoom levels. Production rendering and file mutations do not depend on these test helpers.
