# VaultBridge Agent 0.7.7

Hardens file access boundaries while keeping external references, note edits, recovery, OpenCode, optional Git history and Copy actions available.

- On Windows, vault and external-file operations reject alternate data streams, reserved device names and names normalized by Windows (trailing dots or spaces). Ordinary Unicode filenames and nested folders remain supported.
- Recovery-directory case variants are reserved consistently across external reads, creates, listings, snapshots and vault access. Recovery originals remain available for users to inspect manually.
- OpenCode, executable diagnostics and optional Git history explicitly use `shell: false` and argument arrays.
- Copy remains user-triggered and write-only. Hosts without Electron can use the browser clipboard API; denied or unavailable clipboard access shows a failure notice instead of an unhandled rejection or a success message.

Validation: 108 automated tests passed with no skips, build and syntax checks passed, and real OpenCode 1.19.0 integration passed using an isolated sample and local scripted provider, including read/edit/create, undo, restart, saved credentials, authentication/network failure, timeout and stop. No user notes or live-provider requests were used in this release's tests. The existing local installation containing the separate PR #2 data-isolation fix was preserved.

The community scanner can still disclose filesystem, process, vault enumeration and clipboard capabilities because these features remain present. These disclosures are not a claim that review has failed or passed. [Obsidian explains that warnings do not block submission](https://docs.obsidian.md/community-directory/manage-entry); [external filesystem access must be disclosed](https://docs.obsidian.md/community-directory/developer-policies), as it is in our README.

The public ID remains `vaultbridge-agent`. Release attachments retain verified GitHub provenance. Windows baseline: Obsidian 1.14.4 and OpenCode 1.19.0.
