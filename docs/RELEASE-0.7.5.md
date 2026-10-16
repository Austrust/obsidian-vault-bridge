# VaultBridge Agent 0.7.5

Windows release for Obsidian 1.14.4+ and OpenCode 1.19.0.

- Uses the unique community plugin ID `vaultbridge-agent` and name **VaultBridge Agent**. The former `vault-bridge` ID belongs to an unrelated file-transfer plugin in the community directory.
- Keeps the 0.7.4 features and fixes. Sidebar naming is updated with truncation for narrow layouts.
- The in-place updater supports the new ID and preserves our legacy IDs, user data and runtime directories. It refuses to overwrite an unrelated author using `vault-bridge`.

New installations: download the three release files into `.obsidian/plugins/vaultbridge-agent/`. Existing users: use the manual in-place updater with the existing directory and a separate backup directory. Do not enable the old and new IDs together or install the unrelated community entry over this plugin. No automatic data migration is performed. The 0.7.4 release remains unchanged.

See [Windows setup](https://github.com/Austrust/obsidian-vault-bridge/blob/main/docs/GETTING-STARTED-WINDOWS.md) and [validation](https://github.com/Austrust/obsidian-vault-bridge/blob/main/TEST_REPORT.md). Community submission and approval are separate from this GitHub release.
