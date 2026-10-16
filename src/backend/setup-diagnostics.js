const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const version = (executable) =>
  new Promise((resolve, reject) => {
    execFile(
      executable,
      ["--version"],
      { windowsHide: true, timeout: 10000, maxBuffer: 8192 },
      (error, stdout) => {
        if (error)
          return reject(Error("无法运行 OpenCode，请检查可执行文件路径"));
        const match = stdout.match(/\b\d+\.\d+\.\d+\b/);
        if (!match) return reject(Error("无法识别 OpenCode 版本"));
        resolve(match[0]);
      },
    );
  });
async function detectExecutable(configured, env = process.env) {
  const candidates = [
    ...new Set(
      [
        configured,
        env.LOCALAPPDATA &&
          path.join(
            env.LOCALAPPDATA,
            "VaultBridge",
            "opencode",
            "node_modules",
            "opencode-ai",
            "bin",
            "opencode.exe",
          ),
        ...(env.PATH || "")
          .split(path.delimiter)
          .filter(Boolean)
          .map((p) =>
            path.join(
              p,
              process.platform === "win32" ? "opencode.exe" : "opencode",
            ),
          ),
      ].filter(Boolean),
    ),
  ];
  for (const executable of candidates) {
    try {
      await fs.access(executable);
      return { executable, version: await version(executable) };
    } catch {}
  }
  throw Error("未找到可运行的 OpenCode，请填写已安装的可执行文件路径");
}
async function credentialStatus(provider, sessionKey, env = process.env) {
  if (sessionKey) return "本次运行输入的 API Key";
  const file = path.join(
    env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"),
    "opencode",
    "auth.json",
  );
  try {
    const auth = JSON.parse(await fs.readFile(file, "utf8"));
    if (auth[provider]) return "已检测到 OpenCode 保存的供应商凭据";
  } catch {}
  return "未检测到保存的凭据；也可使用 OpenCode 支持的环境变量配置";
}
module.exports = { detectExecutable, credentialStatus, version };
