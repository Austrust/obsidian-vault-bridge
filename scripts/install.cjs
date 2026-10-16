// In-place upgrade only. Never enumerate or copy vault content or runtime data.
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const files = ["main.js", "manifest.json", "styles.css"];
const digest = (data) => crypto.createHash("sha256").update(data).digest("hex");
async function install(
  pluginDirectory,
  backupRoot,
  source = path.resolve(__dirname, ".."),
) {
  const target = await fs.realpath(pluginDirectory);
  const oldManifest = JSON.parse(
    await fs.readFile(path.join(target, "manifest.json"), "utf8"),
  );
  if (
    !["vaultbridge-agent", "vault-bridge", "obsidian-agent-demo"].includes(
      oldManifest.id,
    ) ||
    path.basename(target) !== oldManifest.id
  )
    throw Error(
      "Target must be an existing VaultBridge plugin directory with a matching ID",
    );
  // The old ID is also owned by an unrelated community plugin. Never overwrite it.
  if (oldManifest.id === "vault-bridge" && oldManifest.author !== "Austrust")
    throw Error(
      "The legacy vault-bridge ID belongs to another or unverified author; refusing to overwrite it",
    );
  const backup = path.resolve(
    backupRoot,
    "upgrade-" +
      new Date().toISOString().replace(/[:.]/g, "-") +
      "-" +
      crypto.randomUUID().slice(0, 8),
  );
  if (backup === target || backup.startsWith(target + path.sep))
    throw Error("Backup must be outside the plugin directory");
  const payloads = new Map(
    await Promise.all(
      files.map(async (name) => [
        name,
        await fs.readFile(path.join(source, name)),
      ]),
    ),
  );
  const manifest = JSON.parse(payloads.get("manifest.json").toString());
  manifest.id = oldManifest.id;
  payloads.set(
    "manifest.json",
    Buffer.from(JSON.stringify(manifest, null, 2) + "\n"),
  );
  const dataHash = async () => {
    try {
      return digest(await fs.readFile(path.join(target, "data.json")));
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  };
  const before = await dataHash();
  await fs.mkdir(backup, { recursive: true });
  for (const name of files)
    await fs.copyFile(path.join(target, name), path.join(backup, name));
  try {
    for (const [name, data] of payloads)
      await fs.writeFile(path.join(target, name), data);
    for (const [name, data] of payloads)
      if (digest(await fs.readFile(path.join(target, name))) !== digest(data))
        throw Error("Release verification failed: " + name);
  } catch (error) {
    for (const name of files)
      await fs.copyFile(path.join(backup, name), path.join(target, name));
    throw error;
  }
  // A running host can persist data independently; never overwrite its newer state.
  const unchanged = before === (await dataHash());
  const result = {
    target,
    backup,
    id: manifest.id,
    version: manifest.version,
    dataUnchanged: unchanged,
    hashes: Object.fromEntries(
      [...payloads].map(([name, data]) => [name, digest(data)]),
    ),
  };
  await fs.writeFile(
    path.join(backup, "upgrade-report.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  return result;
}
if (require.main === module) {
  const [target, backup] = process.argv.slice(2);
  if (!target || !backup)
    throw Error(
      "Usage: node scripts/install.cjs <existing-plugin-directory> <backup-root>",
    );
  install(target, backup)
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
}
module.exports = { install };
