# VaultBridge 0.7.4

Windows candidate for Obsidian 1.14.4+ and OpenCode 1.19.0.

- Connection settings now follow model changes made from the sidebar and block conflicting unsaved edits.
- Whole-note and selection-only references are separate, with a content preview and independent removal.
- Resource and Skill path drafts survive tab switches; the visible Skill path is exactly the value saved.
- First-use setup includes pinned Windows downloads, executable selection, npm-path detection and a checksum-verifying installation helper.
- API keys can remain session-only or be saved explicitly through the local OpenCode credential API for reuse after restart. Vault data never stores the key.
- Settings and menus share full-width path/search fields, consistent controls and grouped actions. Card execution shows its DataviewJS privileges and source code before running.
- Windows CI validates build, tests and release files. Tag automation prepares a draft release for review.

Install the three matching release files. Existing users must preserve their plugin directory, ID, data and runtime. The updater backs up old release files and restores them if installation fails.

See [Windows setup](https://github.com/Austrust/obsidian-vault-bridge/blob/windows-readiness-0.7.3/docs/GETTING-STARTED-WINDOWS.md), [validation](https://github.com/Austrust/obsidian-vault-bridge/blob/windows-readiness-0.7.3/TEST_REPORT.md) and [issue resolution](https://github.com/Austrust/obsidian-vault-bridge/blob/windows-readiness-0.7.3/docs/ISSUE-STATUS.md). The release does not claim Linux or macOS acceptance or community-directory approval.
