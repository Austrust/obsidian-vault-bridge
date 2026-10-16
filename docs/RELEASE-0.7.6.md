# VaultBridge Agent 0.7.6

Addresses the release recommendations from the Obsidian community review.

- The release workflow generates GitHub build-provenance attestations for `main.js`, `manifest.json` and `styles.css`, then verifies them before preparing the release.
- Release attachments contain only those three Obsidian plugin files. The checksum report remains in local packages and CI artifacts.
- README disclosures explain executable launching, external filesystem access, vault path enumeration and user-triggered clipboard writes. The plugin does not read the clipboard.

The runtime bundle and styles are unchanged from 0.7.5. Windows baseline: Obsidian 1.14.4 and OpenCode 1.19.0. Existing legacy installations retain their ID and runtime when using the manual in-place updater. The public ID remains `vaultbridge-agent`.

Verify downloaded assets with `gh attestation verify main.js --repo Austrust/obsidian-vault-bridge` (and the same command for the other release files). Community review status is separate from GitHub publication.
