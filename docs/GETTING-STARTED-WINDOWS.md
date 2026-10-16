# Windows 首次使用

支持基线：Obsidian 1.14.4 或更高版本、OpenCode **1.19.0**。插件在 Windows 上验收；开发工具 Node.js 不是普通用户的运行依赖。

## 1. 安装插件

从 [VaultBridge 0.7.5 Release](https://github.com/Austrust/obsidian-vault-bridge/releases/tag/0.7.5) 下载 `main.js`、`manifest.json`、`styles.css`，放入笔记库的 `.obsidian/plugins/vaultbridge-agent/`，然后在 Obsidian 的第三方插件设置中启用 VaultBridge。三个文件应来自同一版本；社区目录审核通过前请使用此手动安装方式。

已有安装时，保留原目录和原插件 ID，包括旧版 `obsidian-agent-demo`。先备份三个发行文件，再更新；不要删除或覆盖 `data.json`、`runtime`、`journal-archive`。开发者可使用 `scripts/install.cjs` 完成带备份和失败恢复的原位更新。

## 2. 安装受支持的 OpenCode

在 VaultBridge 设置的“连接 → 安装与高级连接配置”展开首次安装引导。

1. 多数 Windows 电脑下载 [x64 1.19.0 压缩包](https://github.com/anomalyco/opencode/releases/download/v1.19.0/opencode-windows-x64.zip)；ARM 电脑使用 [ARM64 压缩包](https://github.com/anomalyco/opencode/releases/download/v1.19.0/opencode-windows-arm64.zip)。架构可在 Windows“设置 → 系统 → 系统信息”查看。
2. 解压到固定目录，例如 `%LOCALAPPDATA%/VaultBridge/OpenCode/1.19.0`。不要把可执行文件留在临时目录。
3. 点击“选择可执行文件”，选择解压出的 `opencode.exe`。成功后显示“OpenCode 1.19.0 已就绪”。已安装的用户可点击“自动检测安装”，它也会查找常见 npm 安装目录。
4. 需要手动填路径时，在高级配置填写完整文件路径；版本不匹配时选择 1.19.0，而不是随意升级到最新版。

可选：从检出的源码目录运行以下 PowerShell 脚本。它下载同一官方固定版本，核对 SHA-256，解压并检查版本；已有其他文件的目标目录不会被覆盖：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-opencode.ps1
# ARM64：在上面的命令后添加 -Architecture arm64
```

下载失败可重新下载或重试脚本；摘要不匹配时脚本停止。OpenCode 的其他版本目前不在本插件的兼容范围内。官方来源：[安装说明](https://opencode.ai/docs/)、[1.19.0 发行页](https://github.com/anomalyco/opencode/releases/tag/v1.19.0)。

## 3. 连接 DeepSeek

选择 DeepSeek 模板，保留默认模型 `deepseek-flash`，填写你自己的 API Key。自定义供应商需同时填写供应商 ID、模型 ID 和完整 API 地址，不能沿用其他供应商的默认值。

凭据有两种方式：

- **仅本次运行**：Key 留在插件内存，重启或重载后需要重新输入。
- **保存在本机，下次继续使用**：应用时保存到 VaultBridge 专用 OpenCode 凭据文件，不与 OpenCode GUI 或普通 CLI 共用；不会写入插件 `data.json` 或随笔记库同步。这不是操作系统密码库加密存储。

插件使用独立数据库，默认位于 `%LOCALAPPDATA%/VaultBridge/AgentData/opencode/`；若设置了 `XDG_DATA_HOME`，则使用该目录下的 `VaultBridge/AgentData/opencode/`。插件更新保留这个位置。GUI 与插件固定版本的数据库格式可能不同，因此不自动复制、迁移或删除 GUI 数据。首次升级到隔离版本时，请在插件中重新填写并按需保存 API Key。未来升级 OpenCode 版本时，仍需单独验证数据库迁移兼容性。

点击“应用并测试本地连接”。本地连接正常后，返回侧栏发送“你好”，收到模型回复才完成供应商验证。已保存凭据时输入框可以留空；点击“检查已保存凭据”可重新读取保存状态。保存状态不是远程鉴权结果。

长期配置完成后，可重启 Obsidian，再发送一条简单问题验证继续使用。普通终端的 `opencode auth login` 使用另一数据目录，不会更新插件的独立凭据；请通过插件设置保存。

## 4. 第一次处理笔记

先用一篇独立样本笔记试用。侧栏 `+` 菜单可选择“引用整篇当前笔记”或“仅引用当前选区”；点击引用标签可预览实际范围，点击旁边的 × 移除。选区是附加时的快照；全文在发送时重新读取。Agent 后续读写行为继续受工具权限控制。

建议先切到规划模式，确认回复后再使用执行模式。需要恢复文件时，从“更多 → 最近操作与撤销”预览并确认；这会检查后续人工修改，不需要 Git。创建对话分支只改变对话，不撤销文件。

交互卡片需要 Dataview 并开启 JavaScript 查询。先查看代码和卡片旁的权限说明，再主动运行；DataviewJS 有 Obsidian 的执行权限，不属于 Agent 工具权限沙箱。

## 遇到问题

| 提示 | 处理 |
| --- | --- |
| 找不到 OpenCode | 展开安装引导，确认已解压并选择真正的 `opencode.exe`，不是 npm 的 `.cmd` 包装脚本 |
| 版本不受支持 | 选择 1.19.0 的可执行文件 |
| 本地连接正常但无法回复 | 检查供应商 Key、模型权限、余额、API 地址和网络；本地连接不验证这些条件 |
| 凭据保存失败 | Key 仍仅供本次运行使用；确认 OpenCode 正常后重试，成功前不要依赖重启复用 |
| 配置已在其他入口更改 | 点击“放弃草稿，载入当前配置”后重新修改，避免覆盖侧栏新选的模型 |
| 超时或停止 | 等待停止完成，再继续对话；已完成的文件修改可单独预览撤销 |

对话、选中的笔记/选区、外部资料和所选 Skill 会发送至你配置的供应商。移除引用不会从已发送的历史中删除内容。诊断反馈应遮蔽 Key 和私人笔记内容。
