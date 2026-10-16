# 0.7.3 validation

Validated on Windows with Obsidian 1.14.4 (application and installer), OpenCode 1.19.0 and Node 24.19.0. This is a release candidate, not a published general-availability release.

## Automated checks

99 tests passed, zero failures and zero skips. Coverage includes journal-based undo, dependent file operations, later user-edit conflicts, interrupted operations, run fencing, queue failures, credential routing, session context, artifact persistence, safe upgrades and Windows filesystem/process behavior.

0.7.3 adds keyboard menu positioning, post-open approval focus, and preservation of Obsidian's Modal keyboard scope. The full suite was rerun after the final change. Real OpenCode integration and performance measurements were performed on the unchanged 0.7.2 backend using isolated samples and a local scripted model; this is not a new verification of a paid model provider.

## Native Obsidian acceptance

Official CLI development commands exercised the actual host UI. Test sends and persistence used an independent in-memory host. No user notes were deleted or rolled back.

- Light/dark themes, 320/360/420 px sidebars and 100/125/150% zoom passed. A 320 × 360 / 125% stress sample kept multiline input, queue and approval usable without horizontal overflow or status-bar obstruction.
- Markdown tables and code blocks rendered. Slash-menu arrow navigation, Enter selection, Shift+Enter newline, and a single Enter send passed.
- All five settings groups opened. Invalid endpoint input disabled saving; restoring the existing configuration and testing the local connection succeeded. The model directory returned two entries, explicitly distinguished from remote inference validation.
- History displayed 20 of 25 sample sessions, expanded to 25, and renamed a sample. Resources, Skills and workspace tabs had no overflow.
- Native inspection found and fixed keyboard menus at the top-left corner, host focus overriding the default deny button, and review filters overwriting Modal.scope. Final Enter denied exactly once; two Escape presses closed nested review/undo modals from 2 to 1 to 0. No new errors were captured after the final retest.
- The final installed plugin reported 0.7.3 and matched the three packaged release hashes. Upgrade preserved data.json. Test objects were removed and the original layout, zoom and theme restored.

## Evidence handling

The full 99-test suite also passed against a clean export of the exact staged files. Rebuilding that export reproduced main.js byte for byte. Screenshots, machine-specific installation records and native acceptance attachments remain local and are not published in this repository. The [original issue ledger](docs/ISSUE-STATUS.md) summarizes the previous scoped review.

## Reproduce

```text
node build.cjs
node --test tests/*.test.js
node --check main.js
node scripts/package.cjs
```

For integration, set OPENCODE_BIN to an installed OpenCode 1.19.0 executable and run `node tests/integration.cjs`. `tests/ui/server.cjs` serves the bundle with an Obsidian shim. Native helpers `tests/native-fixture.cjs` and `tests/native-layout.cjs` are invoked explicitly through the host CLI, with the fixture's restore method called when finished.

Cross-platform acceptance, onboarding from a clean machine, provider-specific live inference and distribution readiness require their own evidence; this report does not certify them.
