const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { runtimeEnvironment } = require("../src/backend/runtime-environment");
const { credentialStatus } = require("../src/backend/setup-diagnostics");

test("Windows uses a stable private store without mutating the host environment", () => {
  const env = { LOCALAPPDATA: "local-app-data", PATH: "unchanged" };
  const result = runtimeEnvironment(env, "win32");
  assert.equal(
    result.XDG_DATA_HOME,
    path.join(env.LOCALAPPDATA, "VaultBridge", "AgentData"),
  );
  assert.equal(result.PATH, env.PATH);
  assert.equal(env.XDG_DATA_HOME, undefined);
});

test("credential checks use the runtime store and ignore desktop credentials", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vaultbridge-storage-"));
  try {
    const env = { XDG_DATA_HOME: root };
    const desktop = path.join(root, "opencode");
    await fs.mkdir(desktop);
    const existing = JSON.stringify({ desktop: { key: "fixture" } });
    await fs.writeFile(path.join(desktop, "auth.json"), existing);
    assert.match(await credentialStatus("desktop", "", env), /未检测到/);
    const privateStore = path.join(
      runtimeEnvironment(env).XDG_DATA_HOME,
      "opencode",
    );
    await fs.mkdir(privateStore, { recursive: true });
    await fs.writeFile(
      path.join(privateStore, "auth.json"),
      JSON.stringify({ plugin: { key: "fixture" } }),
    );
    assert.match(await credentialStatus("plugin", "", env), /已检测到/);
    assert.equal(
      await fs.readFile(path.join(desktop, "auth.json"), "utf8"),
      existing,
    );
    assert.match(await credentialStatus("plugin", "session", env), /本次运行/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
