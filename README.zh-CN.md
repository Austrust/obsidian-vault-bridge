# VaultBridge

桌面版 Obsidian 插件：在原生侧边栏对话，让 OpenCode Agent 读取、修改和创建 Markdown 笔记，通过 DataviewJS 显示交互卡片，并把成果保存回笔记库。插件没有收费或 Pro 解锁逻辑；远程模型 API 费用由你的供应商收取。

这是可运行的功能 Demo。已在隔离测试库完成真实 Obsidian、OpenCode 和 Dataview 联调，另已使用真实 DeepSeek Flash API 验证 OpenCode → MCP 读取虚拟笔记 → 返回测试标记的调用链。

## 安装

1. 安装桌面版 Obsidian 和 OpenCode。本次实测 OpenCode 1.19.0；可执行文件必须能单独运行 `opencode --version`。
2. 将安装包中的 `vault-bridge` 文件夹放入 `<笔记库>/.obsidian/plugins/`，确保目录下直接包含 `manifest.json`、`main.js`、`styles.css`。
3. 在 Obsidian 的第三方插件设置中启用 **VaultBridge**。
4. 如需可视化，在社区插件中安装 Dataview，并在其设置中打开 **Enable JavaScript Queries**。
5. 打开 VaultBridge 设置，填写 OpenCode 可执行文件的**绝对路径**。桌面应用不一定继承终端 PATH。
6. 供应商默认 `deepseek`，模型默认 `deepseek-flash`，API Base URL 默认 `https://api.deepseek.com/v1`。填写自己的 API Key，然后连接。若供应商改变模型名称，以实际可用模型为准。
7. 点击左侧机器人图标，或运行命令 **VaultBridge: 打开原生 Agent 侧边栏**。

API Key 不写入此插件的 `data.json`，重启 Obsidian 后需重新填写；也可使用 OpenCode 已配置的供应商凭据。填写 Key 时，通过启动环境传给 OpenCode。供应商、模型和 URL 修改后需要先在设置中断开，再连接。

无需 API 也能点击 **体验示例卡片 → 运行卡片**，检查侧边栏和 DataviewJS 渲染。

## 使用

### 编辑笔记

打开笔记，在侧边栏输入：

> @DeepSeek 把当前笔记的研究目标改写得更具体，保留原有标题和任务列表。

输入 `@` 可选择助手或笔记；也可以点击 **@ 笔记**，选择后以引用标签附加。`@DeepSeek` 是助手入口，实际调用模型由设置决定，Demo 暂不支持多助手切换。

选中文本后点击 **附加选区**，或运行 **将当前笔记或选区交给 Agent** 命令，然后输入修改要求。Enter 发送，Shift+Enter 换行；中文输入法选字时按 Enter 不会发送。仅在正文写下 `@DeepSeek` 不会自动执行。

Agent 修改已存在笔记前必须先读取内容和 revision。若你在它工作期间又编辑了笔记，过期修改会失败，避免覆盖新内容。侧边栏底部保留修改前后全文和 **撤销此修改**；撤销也会检查后续编辑。新建笔记不会覆盖现有文件，Demo 的撤销按钮仅针对内容修改，不删除新建笔记。

### 可视化命令

引用笔记后输入：

> /visualize 根据这篇笔记生成任务进度面板，用滑块演示不同完成比例。

也可通过 Obsidian 命令 **Visualize：当前笔记生成可视化** 附加当前文档，并补充指令。该命令已在插件内实现，不依赖付费能力或另一个命令插件。

Agent 返回的卡片提供：

- **查看 DataviewJS 源码**：查看将要执行的脚本。
- **运行卡片**：用 Dataview 的 `executeJs` 显示交互界面。
- **保存到笔记**：在 `Agent Artifacts/` 下新建带 `dataviewjs` 代码块的 Markdown 笔记；再次点击不会覆盖已有成果。
- **继续修改**：把卡片 ID 带入下一次 `/visualize` 指令，模型生成新的卡片版本。

DataviewJS 与普通 Obsidian 插件代码一样具有较高权限，并非沙箱。Demo 要求卡片只做展示和交互，但这属于给模型的约束，并不构成代码隔离。对话中不自动运行 Dataview；点击运行是执行入口。保存后的笔记遵循 Dataview 自身的自动执行设置。卡片源码会保留，滑块等临时状态在重渲染或重启后可能重置。

### 会话与停止

**新对话** 创建 OpenCode 会话，**恢复历史** 选择当前插件运行目录中的会话。插件保存卡片、会话 ID、对话缓存和修改记录，OpenCode 保存自己的会话历史。

**停止** 先阻断本轮新的文档写入，再请求 OpenCode 中止。已经完成的修改仍可通过记录撤销。工具调用过程会显示工具名。Demo 每 600 毫秒刷新一次消息，单轮最多等待 180 秒。

## 实现结构

```text
Obsidian 原生侧边栏
  ├─ @ 引用 / 选区 / /visualize / 会话 / 修改记录
  ├─ 本机 HTTP → 插件启动的 OpenCode serve
  │                 └─ 模型 API + Agent 执行循环
  └─ 本机 MCP ← OpenCode 调用笔记工具
       ├─ active_note / search_notes / read_note
       ├─ patch_note / create_note
       └─ publish_visualization → DataviewJS 卡片 → Markdown 成果
```

OpenCode 在插件的 `runtime/` 目录工作，笔记通过 MCP 工具访问。VaultBridge 的工具权限只开放这六个桥接工具，不向模型开放原生 shell 和文件写入工具。插件管理独立 OpenCode 子进程，使用随机本机端口及认证；退出或断开时结束该进程，不操作其他 OpenCode 实例。

文件路径检查限制库内 Markdown，拒绝隐藏目录、越界路径和指向库外的符号链接。活动笔记优先读写 Obsidian 编辑缓冲区，其他笔记使用 Vault API。卡片执行的 JavaScript 不受这套 MCP 文件权限限制。

源码分层便于后续替换成更原生的 harness：

| 文件 | 作用 |
| --- | --- |
| `src/plugin.js` | Obsidian 界面、命令、编辑器适配、会话流程、卡片 |
| `core.js` | 文档版本检查、撤销、MCP、OpenCode HTTP 客户端 |
| `build.cjs` | 将核心模块内联为 Obsidian 可加载的 `main.js` |
| `tests/core.test.js` | 冲突、停止、路径、撤销与 MCP 测试 |
| `tests/integration.cjs` | 真实 OpenCode + 本地模拟模型的工具链测试 |

构建无需第三方 npm 依赖；运行插件也不需要另外安装 Node.js。OpenCode 需要单独安装。开发测试使用 Node.js 20 或更新版本：

```sh
node build.cjs
node --check main.js
node --test tests/core.test.js
OPENCODE_BIN=/absolute/path/to/opencode node tests/integration.cjs
```

最后一个命令会启动本机测试服务及 OpenCode，使用临时目录和脚本化模型响应，不调用付费模型 API。

## 当前边界

- 仅支持桌面版。本次实测 Linux、Obsidian 1.14.4、OpenCode 1.19.0；Dataview 安装包 manifest 版本为 0.5.68。
- 已验证功能链路及真实 Flash API 工具调用，不代表模型总能正确改写或生成可运行的 DataviewJS。首次真实 API 使用建议从一篇测试笔记开始。
- 搜索为直接扫描 Markdown，最多返回 20 条；尚无全文索引、RAG 或大型库性能优化。
- 暂无多助手、卡片状态持久化、可视化沙箱、移动端和通用插件命令注册系统。
- 修改记录保存全文，长时间使用会增加插件数据体积。没有自动清理策略。
- 当前最低 Obsidian 版本声明不代表完整兼容矩阵；以本次实测版本为准。
- 自动化编辑测试在独立测试库完成；真实 API 连通性测试只使用虚拟笔记。

详细验证结果见 `TEST_REPORT.md`。

## 0.1.1 交互更新

模型返回的 reasoning 片段在「思考过程」中折叠显示，支持流式更新及历史恢复；模型没有返回思考内容时不显示该区块。新会话按首条提问生成标题，旧会话在恢复历史时自动提取标题并附带时间。输入区为 Obsidian 状态栏保留空间。

## 0.2.0 对话显示更新

对话可以选中复制，并提供「复制 Markdown」「复制思考」按钮。正文采用正常 Markdown 排版，表格可横向滚动，代码缩进保持原样。工具调用中的临时输出放入「执行过程 · 非最终回答」，默认折叠；最终输出标记为「最终回答」。流式回答标记为生成中，选中文字时暂停替换该正文区域，取消选择后显示最新内容。

## 0.2.0 界面与架构更新

侧栏采用简洁的对话布局、统一输入区和跟随 Obsidian 主题的配色。每轮思考与工具调用合并为可展开的执行记录；工具详情展示参数、结果或错误。引用、历史、复制、撤销与可视化入口保留。

后端拆分为进程管理、会话服务、笔记工具和状态存储模块，便于后续接入其他运行后端。详见 [架构说明](ARCHITECTURE.md)。同一插件 ID 下的旧配置和对话可直接读取。早期 Demo 原位升级应保留原插件 ID 与 runtime 目录。

## 0.2.1 自动连接

打开或恢复侧栏时自动启动 OpenCode，无需先点连接；仅建立本地服务连接，不发送模型请求。设置里可以关闭自动连接。手动断开后，本次插件运行期间不会自动重连；手动点击连接或重新加载插件即可恢复。发送消息仍会按需建立连接。
