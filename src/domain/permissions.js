"use strict";
const defaults = {
  read_skill_file: "allow",
  patch_external: "ask",
  create_external: "ask",
  list_resources: "allow",
  list_external: "allow",
  read_external: "allow",
  read_note: "allow",
  active_note: "allow",
  search_notes: "allow",
  patch_note: "allow",
  create_note: "allow",
  publish_visualization: "allow",
  move_note: "deny",
  rename_note: "deny",
  delete_note: "deny",
};
const labels = {
  read_skill_file: "读取已选择 Skill 的资料",
  patch_external: "修改外部工作目录文件",
  create_external: "新建外部工作目录文件",
  list_resources: "列出授权资料目录",
  list_external: "浏览外部资料目录",
  read_external: "读取外部资料文件",
  read_note: "读取笔记",
  active_note: "读取当前笔记与选区",
  search_notes: "搜索笔记",
  patch_note: "修改笔记",
  create_note: "新建笔记",
  publish_visualization: "发布可视化",
  move_note: "移动笔记",
  rename_note: "重命名笔记",
  delete_note: "删除笔记（保留恢复副本）",
};
class PermissionGate {
  constructor(settings, ask) {
    this.settings = settings;
    this.ask = ask;
    this.pending = new Set();
  }
  mode(name) {
    const value = this.settings()?.[name] ?? defaults[name] ?? "deny";
    return ["allow", "ask", "deny"].includes(value) ? value : "deny";
  }
  async authorize(name, args, guard) {
    guard();
    let mode = this.mode(name);
    if (mode === "deny") throw Error("权限已拒绝：" + (labels[name] || name));
    if (mode === "ask") {
      const approved = await new Promise((resolve) => {
        let dispose = () => {};
        let done = false;
        const finish = (value) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          this.pending.delete(cancel);
          dispose();
          resolve(value);
        };
        const cancel = () => finish(false);
        const timer = setTimeout(cancel, 120000);
        this.pending.add(cancel);
        try {
          dispose =
            this.ask(
              {
                name,
                label: labels[name] || name,
                args,
                expiresAt: Date.now() + 120000,
              },
              finish,
            ) || (() => {});
          if (done) dispose();
        } catch {
          finish(false);
        }
      });
      if (!approved) throw Error("用户未批准：" + (labels[name] || name));
    }
    guard();
    if (this.mode(name) === "deny") throw Error("权限已撤销");
  }
  cancel() {
    for (const cancel of [...this.pending]) cancel();
  }
}
function permissionPreset(mode) {
  const reads = [
    "read_note",
    "active_note",
    "search_notes",
    "read_skill_file",
    "list_resources",
    "list_external",
    "read_external",
  ];
  return Object.fromEntries(
    Object.keys(labels).map((key) => [
      key,
      mode === "review"
        ? "ask"
        : mode === "readonly"
          ? reads.includes(key)
            ? "allow"
            : "deny"
          : defaults[key],
    ]),
  );
}
function inferPreset(permissions = {}) {
  return (
    ["readonly", "standard", "review"].find((mode) =>
      Object.entries(permissionPreset(mode)).every(
        ([key, value]) => (permissions[key] ?? defaults[key]) === value,
      ),
    ) || "custom"
  );
}
module.exports = {
  PermissionGate,
  permissionDefaults: defaults,
  permissionLabels: labels,
  permissionPreset,
  inferPreset,
};
