const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const digest = (data) => crypto.createHash("sha256").update(data).digest("hex");
function sourceFiles(directory) {
  return fs
    .readdirSync(path.join(root, directory), { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? sourceFiles(directory + "/" + e.name)
        : [directory + "/" + e.name],
    );
}
function pack(output) {
  const version = JSON.parse(
    fs.readFileSync(path.join(root, "manifest.json")),
  ).version;
  const sources = [
    ...sourceFiles("src"),
    "build.cjs",
    "styles.css",
    "manifest.json",
    "package.json",
    "versions.json",
  ].sort();
  const sourceHashes = Object.fromEntries(
    sources.map((name) => [
      name,
      digest(fs.readFileSync(path.join(root, name))),
    ]),
  );
  const release = ["main.js", "manifest.json", "styles.css"];
  fs.mkdirSync(output, { recursive: true });
  for (const name of release)
    fs.copyFileSync(path.join(root, name), path.join(output, name));
  const report = {
    version,
    sourceDigest: digest(JSON.stringify(sourceHashes)),
    sourceHashes,
    releaseHashes: Object.fromEntries(
      release.map((name) => [
        name,
        digest(fs.readFileSync(path.join(output, name))),
      ]),
    ),
  };
  fs.writeFileSync(
    path.join(output, "checksums.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  return report;
}
if (require.main === module)
  console.log(
    JSON.stringify(
      pack(
        process.argv[2] ||
          path.join(
            root,
            "dist",
            JSON.parse(fs.readFileSync(path.join(root, "manifest.json")))
              .version,
          ),
      ),
      null,
      2,
    ),
  );
module.exports = { pack };
