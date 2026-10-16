const path = require("node:path");
const os = require("node:os");

// Stable across plugin upgrades and outside the vault. Never open the desktop
// app's database: its schema may differ from our pinned OpenCode runtime.
function runtimeEnvironment(env = process.env, platform = process.platform) {
  const base =
    env.XDG_DATA_HOME ||
    (platform === "win32"
      ? env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local")
      : path.join(os.homedir(), ".local", "share"));
  return {
    ...env,
    XDG_DATA_HOME: path.join(base, "VaultBridge", "AgentData"),
  };
}

module.exports = { runtimeEnvironment };
