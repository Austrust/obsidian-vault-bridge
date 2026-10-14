# VaultBridge

**A free, open-source agent workspace for Obsidian, powered by OpenCode.**

Bring your own API key. No subscriptions, Pro tiers, or feature gates in the plugin. Model providers may charge for API usage.

[中文安装与使用说明](README.zh-CN.md) · [MIT license](LICENSE) · [Test report](TEST_REPORT.md)

## What it does

- Native sidebar chat with an OpenCode agent.
- `@DeepSeek` assistant entry, note references, and editor selections as context.
- Read, search, create, and edit Markdown notes through a local MCP bridge.
- Revision checks to prevent stale edits from overwriting your changes, with a before/after record and conflict-aware undo.
- `/visualize` generates interactive DataviewJS cards; run them in chat and save them as notes.
- Collapsible model-provided reasoning, titled session history, cancellation, and a no-API interactive example.

**Status:** early desktop preview, version 0.1.1. Tested on Linux with Obsidian 1.14.4 and OpenCode 1.19.0. Not yet listed in the Obsidian community plugin directory.

## Install

1. Install [OpenCode](https://opencode.ai). Confirm its executable runs independently.
2. Download or clone this repository. Copy `main.js`, `manifest.json`, and `styles.css` into `<vault>/.obsidian/plugins/vault-bridge/`.
3. Reload Obsidian and enable **VaultBridge** in Community plugins.
4. For interactive cards, install [Dataview](https://github.com/blacksmithgu/obsidian-dataview) and enable **JavaScript Queries**.
5. In VaultBridge settings, enter the absolute path to your OpenCode executable, provider, model, and API base URL. Defaults are `deepseek`, `deepseek-flash`, and `https://api.deepseek.com/v1`.
6. Enter your API key for the current Obsidian session, or reuse credentials configured through OpenCode. Click **连接** (Connect), then open the robot icon in the ribbon.

The UI currently uses Chinese labels. Click **体验示例卡片** → **运行卡片** to try a card without an API key.

If you used the earlier local Demo (`obsidian-agent-demo`), disable it before enabling VaultBridge. This first public version uses a new plugin ID and does not automatically migrate old settings or chat history.

## Use

```text
@DeepSeek Rewrite the goal in the current note while preserving its headings.
/visualize Create an interactive progress panel from the referenced note.
```

Use the `@` picker to attach notes. Attach a selection with **附加选区**. Send with Enter; use Shift+Enter for a newline. IME composition does not send. `@DeepSeek` is an entry label; the actual provider and model come from settings. Mentions written in a note do not execute automatically.

Cards have controls to inspect their source, run, save to a new note, and request a revised version. The plugin also registers Obsidian commands for opening the sidebar, attaching a note/selection, and starting a visualization.

## Architecture and data

```text
Obsidian sidebar → local OpenCode HTTP service → your model provider
                         ↓ MCP tool calls
                 Obsidian note bridge
                 ├─ revision-checked edits
                 └─ DataviewJS cards → Markdown artifacts
```

VaultBridge starts and stops its own local OpenCode process. Its agent is allowed to use six note tools; native shell and file-writing tools are denied. Notes are accessed through the bridge rather than by setting OpenCode's working directory to the vault root.

The plugin does not persist the session-only API key in its settings. OpenCode manages its own saved provider credentials. Chat, card source, and edit records are stored in plugin data; OpenCode stores session history. Referenced or tool-read note content is sent to the configured model provider.

**DataviewJS is not sandboxed.** A card's JavaScript runs with Obsidian privileges. Source inspection and an explicit Run button are provided, but model instructions are not a security boundary. Saved DataviewJS blocks follow Dataview's execution settings.

## Development

No third-party npm packages are required to build or run the unit tests. Node.js 20+ is needed for development; installed plugins use Obsidian's runtime.

```sh
node build.cjs
node --check main.js
node --test tests/core.test.js
OPENCODE_BIN=/absolute/path/to/opencode node tests/integration.cjs
```

`src/plugin.js` contains the UI and Obsidian adapter. `core.js` contains revision checks, undo, the MCP bridge, and the OpenCode client. `build.cjs` produces the committed standalone `main.js`.

The integration test uses real OpenCode with a local scripted model server. It does not contact a paid model API. Real DeepSeek Flash tool calling was also checked separately against a virtual test note.

## Current limits

Desktop only; Linux is the tested platform. No multi-assistant routing, JavaScript sandbox, large-vault search index, persistent widget state, or automatic edit-history pruning yet. Undo covers edits, not newly created notes. Message updates are polled and each turn has a three-minute timeout.

## License

MIT. OpenCode and Dataview are separately installed dependencies with their own licenses. Neither dependency's source code or binary is bundled here.
