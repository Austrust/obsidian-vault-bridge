"use strict";
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const net = require("node:net");
const crypto = require("node:crypto");
const { Diagnostics } = require("./diagnostics");
const { runtimeEnvironment } = require("./runtime-environment");
const { startBridge } = require("./mcp-server");
const { OpenCodeClient, agentConfig } = require("./opencode-client");
const { validateConnection } = require("../domain/connection-settings");
const { modelLimit, validateModelLimit } = require("../domain/model-context");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const supportedVersion = "1.19.0";
function validateHealth(health) {
  if (health?.healthy !== true)
    throw Error("OpenCode 健康检查失败，请重启本地服务");
  if (health.version !== supportedVersion)
    throw Error(
      "OpenCode 版本不受支持：本版仅验证 " +
        supportedVersion +
        "，请在连接设置中选择该版本的可执行文件",
    );
}
function runtimeConfig(settings, key) {
  validateConnection({ executable: "opencode", ...settings });
  const url = new URL(settings.baseURL);
  if (!["http:", "https:"].includes(url.protocol))
    throw Error("API 地址需要使用 http 或 https");
  if (!settings.provider?.trim() || !settings.model?.trim())
    throw Error("请填写供应商和模型 ID");
  return {
    agent: { note_agent: agentConfig },
    default_agent: "note_agent",
    permission: { "*": "deny", "note_agent_*": "allow" },
    share: "disabled",
    provider: {
      [settings.provider]: {
        npm: "@ai-sdk/openai-compatible",
        name: settings.provider,
        options: { baseURL: settings.baseURL, ...(key ? { apiKey: key } : {}) },
        models: {
          [settings.model]: {
            name: settings.model,
            ...(Object.keys(modelLimit(settings)).length
              ? { limit: validateModelLimit(modelLimit(settings)) }
              : {}),
          },
        },
      },
    },
  };
}
class OpenCodeRuntime {
  constructor({
    directory,
    execute,
    settings,
    apiKey = () => "",
    onState = () => {},
    onExit = () => {},
    env = process.env,
  }) {
    Object.assign(this, {
      directory,
      execute,
      settings,
      apiKey,
      onState,
      onExit,
      env,
    });
    this.client = null;
    this.generation = 0;
    this.resources = null;
    this.connecting = null;
    this.activeRun = null;
    this.closing = null;
  }
  async connect() {
    if (this.closing) await this.closing;
    if (this.connecting) return this.connecting;
    if (this.client) {
      try {
        validateHealth(await this.client.request("/global/health"));
        return this.client;
      } catch {
        await this.disconnect();
      }
    }
    const generation = ++this.generation;
    this.connecting = this.start(generation)
      .catch(async (error) => {
        if (generation === this.generation) {
          await this.cleanup();
          this.onState("error", error.message);
        }
        throw error;
      })
      .finally(() => {
        if (generation === this.generation) this.connecting = null;
      });
    return this.connecting;
  }
  async start(generation) {
    const guard = () => {
      if (generation !== this.generation) throw Error("连接已取消");
    };
    this.onState("connecting", "正在连接 OpenCode");
    await fs.mkdir(this.directory, { recursive: true });
    guard();
    const run = this.activeRun;
    const bridge = await startBridge((name, args) => {
      if (!run || this.activeRun !== run || generation !== this.generation)
        throw Error("工具请求所属任务已失效");
      return this.execute(name, args, run);
    });
    if (generation !== this.generation) {
      await bridge.close();
      guard();
    }
    const resources = { bridge, proc: null };
    this.resources = resources;
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const port = server.address().port;
        server.close(() => resolve(port));
      });
    });
    guard();
    const settings = this.settings(),
      key = this.apiKey(),
      password = crypto.randomBytes(24).toString("hex");
    const config = runtimeConfig(settings, key);
    const client = new OpenCodeClient(
      `http://127.0.0.1:${port}`,
      this.directory,
      password,
    );
    const proc = spawn(
      settings.executable,
      ["serve", "--hostname", "127.0.0.1", "--port", String(port)],
      {
        cwd: this.directory,
        env: {
          ...runtimeEnvironment(this.env),
          OPENCODE_SERVER_PASSWORD: password,
          OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    resources.proc = proc;
    const diagnostics = new Diagnostics();
    resources.diagnostics = diagnostics;
    let exitError = null;
    proc.once("error", (e) => {
      exitError = e;
    });
    proc.once("exit", (code) => {
      exitError = Error(
        "OpenCode 已退出（" +
          code +
          "）" +
          (diagnostics.summary() ? "：" + diagnostics.summary() : ""),
      );
      if (this.resources === resources && this.client) {
        this.client = null;
        this.onExit(exitError);
        this.onState("error", exitError.message);
        void this.cleanup().catch(() => {});
      }
    });
    proc.stdout?.on("data", () => {});
    proc.stderr?.on("data", (chunk) => diagnostics.ingest(chunk));
    let health = null;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      guard();
      if (exitError) throw exitError;
      try {
        health = await client.request("/global/health");
        break;
      } catch {}
      await sleep(300);
    }
    guard();
    if (!health)
      throw Error(
        "连接超时，请检查 OpenCode 路径" +
          (diagnostics.summary() ? "：" + diagnostics.summary() : ""),
      );
    validateHealth(health);
    const result = await client.configure(bridge);
    guard();
    if (result?.note_agent?.status !== "connected")
      throw Error("笔记工具连接失败");
    this.client = client;
    this.onState("connected", "已连接");
    return client;
  }
  async request(...args) {
    const client = this.client || (await this.connect());
    return client.request(...args);
  }
  async beginRun(id) {
    // Each run owns its process and MCP token. Old model loops cannot pick up
    // a replacement bridge configuration belonging to the next run.
    await this.disconnect();
    this.activeRun = id;
    await this.connect();
  }
  revokeRun(id) {
    if (this.activeRun === id) this.activeRun = null;
  }
  async endRun(id) {
    this.revokeRun(id);
    await this.disconnect();
  }
  async cleanup() {
    if (this.closing) return this.closing;
    const resources = this.resources;
    this.resources = null;
    this.client = null;
    this.closing = (async () => {
      await resources?.bridge?.close();
      resources?.diagnostics?.clear();
      const proc = resources?.proc;
      if (
        !proc ||
        proc.exitCode !== null ||
        proc.signalCode !== null ||
        !proc.pid
      )
        return;
      await new Promise((resolve, reject) => {
        const done = () => {
          clearTimeout(term);
          clearTimeout(kill);
          resolve();
        };
        proc.once("exit", done);
        const term = setTimeout(() => proc.kill("SIGKILL"), 2000);
        const kill = setTimeout(() => {
          proc.removeListener("exit", done);
          reject(Error("OpenCode 未能退出，请检查进程"));
        }, 5000);
        proc.kill("SIGTERM");
      });
    })();
    try {
      await this.closing;
    } finally {
      this.closing = null;
    }
  }
  async disconnect() {
    this.generation++;
    this.activeRun = null;
    const pending = this.connecting;
    this.connecting = null;
    await this.cleanup();
    // Cancelled startup must release a bridge it had not yet published.
    if (pending) await pending.catch(() => {});
    this.onState("disconnected", "已断开");
  }
}
module.exports = {
  OpenCodeRuntime,
  runtimeConfig,
  validateHealth,
  supportedVersion,
};
