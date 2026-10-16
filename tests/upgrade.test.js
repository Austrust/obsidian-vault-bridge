const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { install } = require("../scripts/install.cjs");
const { pack } = require("../scripts/package.cjs");
test("upgrade preserves both supported plugin IDs, user data and runtime history, with release backup", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vb-upgrade-test-"));
  t.after(async () => {
    if (
      !path
        .resolve(root)
        .startsWith(path.resolve(os.tmpdir()) + path.sep + "vb-upgrade-test-")
    )
      throw Error("unsafe cleanup");
    await fs.rm(root, { recursive: true, force: true });
  });
  for (const id of ["vault-bridge", "obsidian-agent-demo"]) {
    const target = path.join(root, id);
    await fs.mkdir(path.join(target, "runtime", "history.git"), {
      recursive: true,
    });
    const data = '{"settings":{"provider":"sample"},"journal":[{"id":"old"}]}';
    await fs.writeFile(path.join(target, "data.json"), data);
    await fs.writeFile(
      path.join(target, "runtime", "history.git", "HEAD"),
      "old-head",
    );
    await fs.writeFile(
      path.join(target, "manifest.json"),
      JSON.stringify({ id, version: "0.1.0" }),
    );
    await fs.writeFile(path.join(target, "main.js"), "old-main");
    await fs.writeFile(path.join(target, "styles.css"), "old-css");
    const result = await install(target, path.join(root, "backups"));
    assert.equal(result.id, id);
    assert(result.dataUnchanged);
    assert.equal(
      JSON.parse(await fs.readFile(path.join(target, "manifest.json"), "utf8"))
        .id,
      id,
    );
    assert.equal(
      await fs.readFile(path.join(target, "data.json"), "utf8"),
      data,
    );
    assert.equal(
      await fs.readFile(
        path.join(target, "runtime", "history.git", "HEAD"),
        "utf8",
      ),
      "old-head",
    );
    assert.equal(
      await fs.readFile(path.join(result.backup, "main.js"), "utf8"),
      "old-main",
    );
  }
  const first = pack(path.join(root, "package-a"));
  const second = pack(path.join(root, "package-b"));
  assert.deepEqual(first, second);
  assert.deepEqual((await fs.readdir(path.join(root, "package-a"))).sort(), [
    "checksums.json",
    "main.js",
    "manifest.json",
    "styles.css",
  ]);
});

test("failed upgrade restores every old release file and retains user data", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vb-upgrade-failure-"));
  t.after(async () => {
    if (
      !path
        .resolve(root)
        .startsWith(
          path.resolve(os.tmpdir()) + path.sep + "vb-upgrade-failure-",
        )
    )
      throw Error("unsafe cleanup");
    await fs.rm(root, { recursive: true, force: true });
  });
  const target = path.join(root, "vault-bridge");
  await fs.mkdir(target);
  const originals = {
    "manifest.json": JSON.stringify({ id: "vault-bridge", version: "0.1.0" }),
    "main.js": "old-main",
    "styles.css": "old-css",
    "data.json": '{"retained":true}',
  };
  for (const [file, text] of Object.entries(originals))
    await fs.writeFile(path.join(target, file), text);
  const originalWrite = fs.writeFile;
  const resolvedTarget = await fs.realpath(target);
  let failed = false;
  fs.writeFile = async (file, ...args) => {
    if (file === path.join(resolvedTarget, "styles.css") && !failed) {
      failed = true;
      throw Error("simulated disk failure");
    }
    return originalWrite(file, ...args);
  };
  try {
    await assert.rejects(
      install(target, path.join(root, "backups")),
      /simulated disk failure/,
    );
  } finally {
    fs.writeFile = originalWrite;
  }
  for (const [file, text] of Object.entries(originals))
    assert.equal(await fs.readFile(path.join(target, file), "utf8"), text);
});
