const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { createRequire } = require("node:module");
const { validateHealth } = require("../src/backend/opencode-runtime");

test("runtime health requires the tested OpenCode version", () => {
  assert.doesNotThrow(() =>
    validateHealth({ healthy: true, version: "1.19.0" }),
  );
  for (const version of [undefined, "1.18.0", "1.20.0", "2.0.0"])
    assert.throws(
      () => validateHealth({ healthy: true, version }),
      /仅验证 1\.19\.0/,
    );
  assert.throws(
    () => validateHealth({ healthy: false, version: "1.19.0" }),
    /健康检查失败/,
  );
});

test("unsupported runtime closes its bridge before any tool registration", async () => {
  const filename = path.resolve(
    __dirname,
    "../src/backend/opencode-runtime.js",
  );
  const localRequire = createRequire(filename);
  let closed = 0;
  let configured = 0;
  let spawnedEnv;
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.exitCode = 0;
  const context = {
    module: { exports: {} },
    process,
    URL,
    setTimeout,
    clearTimeout,
    require(name) {
      if (name === "node:fs/promises") return { mkdir: async () => {} };
      if (name === "node:child_process")
        return {
          spawn: (_file, _args, options) => {
            spawnedEnv = options.env;
            return proc;
          },
        };
      if (name === "./mcp-server")
        return { startBridge: async () => ({ close: async () => closed++ }) };
      if (name === "./opencode-client")
        return {
          agentConfig: {},
          OpenCodeClient: class {
            async request() {
              return { healthy: true, version: "0.1.0" };
            }
            async configure() {
              configured++;
            }
          },
        };
      return localRequire(name);
    },
  };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), context, { filename });
  const states = [];
  const runtime = new context.module.exports.OpenCodeRuntime({
    directory: "unused",
    env: { XDG_DATA_HOME: "desktop-data" },
    execute() {},
    settings: () => ({
      executable: "fixture",
      provider: "fixture",
      model: "fixture",
      baseURL: "http://127.0.0.1/v1",
    }),
    onState: (state) => states.push(state),
  });
  await assert.rejects(runtime.connect(), /版本不受支持/);
  assert.equal(
    spawnedEnv.XDG_DATA_HOME,
    path.join("desktop-data", "VaultBridge", "AgentData"),
  );
  assert.equal(configured, 0);
  assert.equal(closed, 1);
  assert.equal(runtime.resources, null);
  assert.equal(runtime.client, null);
  assert.equal(states.at(-1), "error");
});
