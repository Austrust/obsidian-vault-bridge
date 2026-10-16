"use strict";
const crypto = require("node:crypto");
const { vaultPath } = require("./note-engine");
class ArtifactService {
  constructor({ state, adapter, persist, refresh, guard, runId = () => null }) {
    Object.assign(this, { state, adapter, persist, refresh, guard, runId });
    this.saving = new Map();
  }
  async publish(args) {
    this.guard();
    const artifact = {
      id: crypto.randomUUID(),
      sessionId: this.state.sessionId,
      runId: this.runId(),
      title: args.title.slice(0, 120),
      code: args.code,
      sourcePath: args.sourcePath,
      time: Date.now(),
    };
    this.state.artifacts.push(artifact);
    await this.persist();
    this.refresh();
    return {
      artifactId: artifact.id,
      status: "saved",
      render: "DataviewJS card awaiting Run click",
    };
  }
  save(artifact) {
    if (this.saving.has(artifact.id)) return this.saving.get(artifact.id);
    const work = this.saveOnce(artifact).finally(() =>
      this.saving.delete(artifact.id),
    );
    this.saving.set(artifact.id, work);
    return work;
  }
  async saveOnce(artifact) {
    this.guard();
    const folder = vaultPath(this.state.settings.artifactFolder);
    const name =
      artifact.title.replace(/[\\/:*?"<>|\[\]#\r\n]/g, "-").slice(0, 50) ||
      "可视化";
    const p =
      artifact.savedPath || `${folder}/${name}-${artifact.id.slice(0, 8)}.md`;
    if (artifact.savedPath && (await this.adapter.readOptional?.(p)) != null)
      return p;
    const longest = Math.max(
      2,
      ...(artifact.code.match(/`+/g) || []).map((s) => s.length),
    );
    const fence = "`".repeat(longest + 1);
    const source = artifact.sourcePath
      ? "[[" + artifact.sourcePath + "]]"
      : "对话";
    const text = `# ${artifact.title.replace(/[\r\n]/g, " ")}\n\n来源：${source}\n\n${fence}dataviewjs\n${artifact.code}\n${fence}\n`;
    const existing = await this.adapter.readOptional?.(p);
    if (existing != null && existing !== text)
      throw Error("成果保存位置已有不同内容，请先打开检查：" + p);
    if (existing == null) await this.adapter.create(p, text, this.guard);
    artifact.savedPath = p;
    await this.persist();
    this.refresh();
    return p;
  }
}
module.exports = { ArtifactService };
