const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { validateFileNames } = require("../src/domain/file-path");
const { vaultPath } = require("../src/domain/note-engine");
const { Resources } = require("../src/domain/resources");
const { ExternalWorkspace } = require("../src/domain/external-workspace");
const { VaultAdapter } = require("../src/adapters/vault-adapter");

test("Windows ordinary-file paths reject streams, devices and normalized aliases", () => {
  for (const p of [
    "a.txt:hidden.md",
    "dir/NUL.txt",
    "CON.md",
    "com¹.log",
    "LPT9/file.txt",
    "dir./a.md",
    "dir /a.md",
    "a?.md",
    "a\u0001.md",
  ])
    assert.throws(() => validateFileNames(p, "win32"), /Windows/);
  for (const p of [
    "项目/研究 1.md",
    "folder/a.b.md",
    "COM10.md",
    "console.txt",
  ])
    assert.doesNotThrow(() => validateFileNames(p, "win32"));
  assert.doesNotThrow(() => validateFileNames("report:2026.md", "linux"));
});

test("recovery aliases stay out of external tools and vault access", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vb-access-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "VaultBridge Recovery"));
  await fs.writeFile(
    path.join(root, "VaultBridge Recovery", "original.md"),
    "saved",
  );
  await fs.writeFile(path.join(root, "normal.md"), "normal");
  const resources = new Resources(() => ({ externalFolders: [root] }));
  const id = resources.roots()[0].id;
  assert.deepEqual(
    (await resources.list(id)).map((e) => e.path),
    ["normal.md"],
  );
  const workspace = new ExternalWorkspace({ root, resources, guard() {} });
  const vault = new VaultAdapter({ root, vault: {}, editor: () => null });
  for (const p of [
    "VaultBridge Recovery/original.md",
    "vaultbridge recovery/original.md",
    "VAULTBRIDGE RECOVERY/new.md",
  ]) {
    await assert.rejects(resources.read(id, p), /越界或隐藏/);
    await assert.rejects(workspace.create(p, "wrong"), /外部写入/);
    await assert.rejects(vault.read(p), /恢复副本/);
  }
  assert.equal(
    await fs.readFile(
      path.join(root, "VaultBridge Recovery", "original.md"),
      "utf8",
    ),
    "saved",
  );
  await workspace.create("new.md", "new");
  assert.equal((await resources.read(id, "new.md")).text, "new");
  if (process.platform === "win32") {
    for (const p of ["normal.md:stream.md", "NUL.md", "dir./new.md"]) {
      assert.throws(() => vaultPath(p), /Windows/);
      await assert.rejects(resources.read(id, p), /Windows/);
      await assert.rejects(workspace.create(p, "wrong"), /Windows/);
    }
    assert.equal(
      await fs.readFile(path.join(root, "normal.md"), "utf8"),
      "normal",
    );
    await assert.rejects(fs.access(path.join(root, "normal.md:stream.md")), {
      code: "ENOENT",
    });
  }
});
