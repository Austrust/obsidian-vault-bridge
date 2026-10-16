const fs = require("node:fs/promises");
const path = require("node:path");
const { runtimeEnvironment } = require("./runtime-environment");
const { execFile } = require("node:child_process");
const version = (executable, env = process.env) =>
  new Promise((resolve, reject) => {
    execFile(
      executable,
      ["--version"],
      { windowsHide: true, timeout: 10000, maxBuffer: 8192, env },
      (error, stdout) => {
        if (error)
          return reject(Error("无法运行 OpenCode，请检查可执行文件路径"));
        const match = stdout.match(/\b\d+\.\d+\.\d+\b/);
        if (!match) return reject(Error("无法识别 OpenCode 版本"));
        resolve(match[0]);
      },
    );
  });
function executableCandidates(
  configured,
  env = process.env,
  platform = process.platform,
) {
  const binary = platform === "win32" ? "opencode.exe" : "opencode";
  const prefixes = [
    env.APPDATA && path.join(env.APPDATA, "npm"),
    env.npm_config_prefix,
    ...(env.PATH || "").split(path.delimiter),
    configured && path.dirname(configured),
  ].filter(Boolean);
  const candidates = [
    ...new Set(
      [
        configured,
        env.LOCALAPPDATA &&
          path.join(
            env.LOCALAPPDATA,
            "VaultBridge",
            "OpenCode",
            "1.19.0",
            binary,
          ),
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
        ...prefixes.flatMap((p) => [
          path.join(p, binary),
          path.join(p, "node_modules", "opencode-ai", "bin", binary),
          path.join(p, "node_modules", "opencode-windows-x64", "bin", binary),
          path.join(p, "node_modules", "opencode-windows-arm64", "bin", binary),
        ]),
      ].filter(Boolean),
    ),
  ];
  return candidates.filter((p) => !/\.(cmd|bat|ps1)$/i.test(p));
}
async function detectExecutable(configured, env = process.env) {
  let unsupported;
  for (const executable of executableCandidates(configured, env)) {
    try {
      await fs.access(executable);
      const found = { executable, version: await version(executable, env) };
      if (found.version === "1.19.0") return found;
      unsupported ||= found;
    } catch {}
  }
  if (unsupported) return unsupported;
  throw Error(
    "未找到 OpenCode 1.19.0。展开安装引导，下载并解压后选择 opencode.exe。",
  );
}
async function credentialStatus(provider, sessionKey, env = process.env) {
  if (sessionKey) return "本次运行输入的 API Key";
  const file = path.join(
    runtimeEnvironment(env).XDG_DATA_HOME,
    "opencode",
    "auth.json",
  );
  try {
    const auth = JSON.parse(await fs.readFile(file, "utf8"));
    if (auth[provider]) return "已检测到 OpenCode 保存的供应商凭据";
  } catch {}
  return "未检测到保存的凭据；也可使用 OpenCode 支持的环境变量配置";
}
module.exports = {
  detectExecutable,
  credentialStatus,
  version,
  executableCandidates,
};
