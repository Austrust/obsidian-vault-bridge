# Demo 验证记录

验证日期：2026-10-14。测试在独立生成的笔记库中进行。

## 自动化核心测试

9 项通过：库内路径限制、符号链接越界、精确修改与撤销、人工编辑冲突、停止后的排队写入阻断、撤销冲突、串行过期 revision、歧义替换拒绝、MCP 认证与工具参数验证。

## 真实 OpenCode 联调

使用 OpenCode 1.19.0 实际可执行文件，启动其 HTTP 服务并注册插件 MCP。供应商为本机脚本化 OpenAI-compatible SSE 服务，依次发出工具调用。

验证六个笔记工具对模型可见；完成读取 → 携带 revision 修改 → 发布可视化 → 创建笔记 → 最终回复。修改结果、创建结果、卡片记录、撤销、会话列表及中止端点均通过断言。

此测试验证实际 harness、协议与工具编排；没有验证 DeepSeek 远程服务或模型推理质量。中止端点可调用与停止后的写入拒绝分别完成验证，没有测试真实远程模型所有中止时序。

## 真实 Obsidian 界面联调

使用 Obsidian 1.14.4、Dataview、真实 OpenCode；模型仍由上述本机模拟服务提供。

通过项：

1. 插件可安装、加载、卸载及重载；修复了 Obsidian 加载器无法解析相对 `require('./core')` 的问题，发布版已合并为单文件。
2. 原生侧边栏正常显示，打开笔记后能附加其最新内容。
3. 从输入框发送指令，Agent 实际修改测试笔记，创建任务清单并返回卡片。
4. 点击运行卡片，滑块从 30% 调整到 75% 后显示同步变化。
5. 保存卡片创建含 DataviewJS 的 Markdown 笔记，笔记页面能独立显示交互界面。
6. 撤销后恢复原文，恢复 OpenCode 历史后保留对话。
7. 不使用 API 的示例复利卡片正常显示。

截图为真实测试窗口，另附 `obsidian-demo-preview.png`。

## 未覆盖

真实 DeepSeek 文档改写质量；Windows/macOS；超大笔记库性能；长期会话及数据增长；断电恢复；所有 DataviewJS 脚本；恶意可视化代码隔离。Demo 不提供 JavaScript 沙箱。

## 后续真实 API 验证

使用真实 DeepSeek Flash API，通过 OpenCode 1.19.0 调用 MCP read_note，读取仅含测试标记的虚拟笔记并正确返回标记。没有发送实际笔记库内容。用户随后反馈插件正常使用。

此仓库版本调整了品牌名称、插件 ID 和默认模型；核心编辑协议未改变。更名后的构建及核心测试另行运行。

## 0.1.1 回归验证

- 13 项 Node 测试通过：原有 9 项，加上 Enter/Shift+Enter/IME、标题提取、思考内容独立更新与历史映射、无思考内容的降级。
- 真实 OpenCode 1.19.0 + 本地模拟 SSE 模型联调通过：会话 PATCH 标题可读回，reasoning_content 转为 reasoning part 并可从历史接口读取；原有编辑、新建、撤销、卡片和会话测试继续通过。
- 浏览器界面测试使用实际打包 AgentView 和 Obsidian API shim。展开思考区后更新内容，展开状态保留；Shift+Enter 保留换行而不发送，Enter 正常发送；两条旧会话显示不同标题与时间。
- 360 × 460 像素侧栏、32 像素模拟状态栏：发送按钮底部 436，状态栏顶部 448，间距 12 像素。此次布局验证使用模拟 Obsidian 容器，并非所有原生主题/窗口组合的兼容性测试。
- 可复现界面：先 `node build.cjs`，再 `node tests/ui/server.cjs`，浏览器访问 http://127.0.0.1:41967 。fixture 不连接模型，也不读取笔记库。

## 0.1.2 回归验证（2026-10-15）

- 16 项 Node 测试通过；新增过程消息与最终回答分类、未完成/中断状态、Markdown 表格及代码原文保留测试。
- 实际打包 AgentView 的浏览器 fixture 验证：Markdown 复制回调收到完整表格源码与代码缩进；表格为 3 行 3 列；段落间距约 9px；正文 user-select 为 text，white-space 为 normal。
- 过程消息默认折叠并明确标记非最终回答；正文选中期间更新未替换 DOM，取消选择后补上最新内容。
- 浏览器 fixture 使用 Marked 17.0.5 作为 GFM 渲染替身，以及 Electron clipboard 的记录替身；生产代码继续使用 Obsidian MarkdownRenderer 与 Electron 系统剪贴板。本轮没有在原生 Obsidian 中自动验证系统剪贴板或全部主题。
- 要复现 Markdown fixture，将 VAULTBRIDGE_MARKED_PATH 指向本机 marked/lib/marked.umd.js 后运行 node tests/ui/server.cjs。不设置该变量时，fixture 仅作纯文本界面测试。测试渲染器不随插件分发。

## 0.2.0 重构与界面验证（2026-10-15）

- 25 项 Node 测试：原有编辑与协议回归，以及旧状态兼容、快照写入、执行记录分组、连接中取消、错误释放、并行发送拒绝、会话切换互斥和超时报告。
- 真实 OpenCode 1.19.0 + 本地模拟 SSE 模型：通过新的 Runtime 与 ConversationService 完成读取、修改、新建、可视化、思考映射、标题、历史、撤销、共享连接及断开后重连。无效可执行路径启动失败后释放资源。
- 实际打包 AgentView 浏览器 fixture：执行记录、思考和工具参数/结果展开；完整 Markdown 复制；表格渲染；Enter 发送；Shift+Enter 换行；深色主题；320 × 500 侧栏没有横向溢出，发送按钮位于模拟状态栏之上；生成时按钮切换为停止。
- 界面 fixture 使用 Obsidian API、图标与剪贴板替身，Markdown 使用 Marked。此次未在原生 Obsidian 中自动复测所有界面行为，也未调用真实付费模型。原生主题样式及不同平台仍需要实际使用验证。

## 0.2.1 自动连接验证（2026-10-15）

- 29 项 Node 测试通过，新增自动连接、关闭开关、手动断开抑制、卸载抑制、失败后的手动恢复，以及中止失败时仍清理服务。
- 自动连接入口位于侧栏 onOpen，包含 Obsidian 恢复已打开侧栏的场景；连接启动不会发送模型请求。已有 Runtime 启动锁复用并发连接请求。
- 真实 OpenCode 与本地模拟模型的完整集成回归通过。此次没有在原生 Obsidian 中自动重载插件验证。
