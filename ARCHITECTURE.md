# Architecture · 0.2.0

VaultBridge separates the Obsidian interface from agent execution and note mutations. The release remains a single `main.js`; development uses small CommonJS modules with no bundler dependencies.

## Boundaries

| Module | Responsibility |
| --- | --- |
| `src/plugin.js` | Composition root, Obsidian vault/editor adapters, commands and card persistence |
| `src/ui/` | Chat view, settings, example card; no HTTP or process management |
| `src/presentation.js` | Pure message normalization, titles and grouped execution records |
| `src/backend/conversation-service.js` | Session lifecycle, prompt context, cancellation and message polling |
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

Note mutation guarantees remain in NoteEngine, independently of the UI or model. Reads return revisions; edits compare revisions and current editor/file content. Undo checks for subsequent user edits. Creating a note is not undoable through the edit journal.

## State compatibility

`schemaVersion: 2` snapshots retain settings, journal, artifacts, transcript, session ID, user labels and session titles. Existing unversioned data is read without discarding those fields. Runtime connection flags and the session-only API key are not persisted. Legacy cached tool strings remain displayable.

Keep the same plugin ID and runtime directory when upgrading in place. Changing from the original `obsidian-agent-demo` ID to `vault-bridge` is a separate migration: OpenCode session lookup depends on its working directory. Do not silently move it during a UI update.

## Extension points

New note tools belong in the tool schema and NoteTools dispatcher, with mutation checks in NoteEngine. New presentation types belong in message normalization and the UI. A future harness adapter can implement connection/request/abort behavior and normalize messages to the same presentation model. The current ConversationService still speaks OpenCode session routes; a different protocol will require an adapter, not just a settings change.

A future streaming transport can replace polling inside ConversationService. Storage migrations should be added at WorkspaceStore, preserving existing fields and versioned fixtures. Card execution remains explicitly user-triggered DataviewJS and is not sandboxed. No new agent permissions were added by this refactor.
