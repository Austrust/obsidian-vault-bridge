// Independent filesystem sample; never accepts a user vault path.
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const { NoteEngine } = require("../src/domain/note-engine");
(async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "vaultbridge-preparation-"),
  );
  const notes = path.join(root, "sample-vault");
  await fs.mkdir(notes);
  const attachment = await fs.open(
    path.join(notes, "large-attachment.bin"),
    "w",
  );
  await attachment.truncate(201 * 1024 * 1024);
  await attachment.close();
  const state = {
    journal: [],
    transcript: Array.from({ length: 1000 }, (_, id) => ({
      id,
      text: "独立历史消息".repeat(40),
    })),
  };
  let storageCalls = 0;
  const storage = new Proxy(
    {},
    {
      get() {
        return () => {
          storageCalls++;
          throw Error("Preparation must not scan notes");
        };
      },
    },
  );
  const engine = new NoteEngine(storage, state.journal, () =>
    fs.writeFile(path.join(root, "sample-data.json"), JSON.stringify(state)),
  );
  const results = [];
  let created = 0;
  for (const count of [100, 1000, 10000]) {
    while (created < count) {
      const batch = Array.from(
        { length: Math.min(100, count - created) },
        (_, i) => path.join(notes, "note-" + (created + i) + ".md"),
      );
      await Promise.all(
        batch.map((file) => fs.writeFile(file, "独立性能样本")),
      );
      created += batch.length;
    }
    const samples = [];
    for (let i = 0; i < 30; i++) {
      const started = performance.now();
      await engine.prepareRecovery();
      samples.push(performance.now() - started);
    }
    const sorted = [...samples].sort((a, b) => a - b);
    results.push({
      noteFiles: count,
      attachmentMiB: 201,
      firstMs: samples[0],
      p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
      samples: samples.length,
      storageCalls,
    });
  }
  assert.equal(storageCalls, 0);
  console.log(
    JSON.stringify(
      {
        scope:
          "prepareRecovery + local JSON persistence; excludes runtime startup, model, and UI",
        retainedSampleRoot: root,
        persistedBytes: (await fs.stat(path.join(root, "sample-data.json")))
          .size,
        results,
      },
      null,
      2,
    ),
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
