const { Modal } = require("obsidian");
const { renderDiff } = require("./change-history");
function renderPermission(c, request, finish, expand) {
  c.addClass("vb-approval", "vb-surface");
  c.createEl("h3", { text: request.label });
  if (expand) {
    const open = c.createEl("button", { text: "展开审批预览" });
    open.onclick = expand;
  }
  const args = request.args || {};
  const target =
    args.path || args.sourcePath || args.query || args.root || "当前任务";
  c.createEl("p", {
    text:
      "目标：" + target + (args.destination ? " → " + args.destination : ""),
  });
  if (args.oldText !== undefined || args.newText !== undefined)
    renderDiff(c, { before: args.oldText || "", after: args.newText || "" });
  const details = c.createEl("details");
  details.createEl("summary", { text: "完整请求参数" });
  details.createEl("pre", {
    text: JSON.stringify(args, null, 2),
    cls: "vb-permission-details",
  });
  const hint = c.createEl("p", { cls: "na-muted" });
  const buttons = [];
  const expiresAt = request.expiresAt || Date.now() + 120000;
  const update = () => {
    const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
    hint.textContent = remaining
      ? "仅批准这一次 · " + remaining + " 秒后自动拒绝"
      : "请求已到期";
    if (!remaining) for (const b of buttons) b.disabled = true;
  };
  for (const [label, value] of [
    ["拒绝", false],
    ["允许一次", true],
  ]) {
    const b = c.createEl("button", { text: label });
    buttons.push(b);
    b.onclick = () => {
      for (const button of buttons) button.disabled = true;
      finish(value);
    };
  }
  update();
  const timer = setInterval(update, 1000);
  return { dispose: () => clearInterval(timer), deny: buttons[0] };
}
class PermissionModal extends Modal {
  constructor(app, request, finish) {
    super(app);
    this.request = request;
    this.resolve = finish;
    this.completed = false;
    this.closed = false;
  }
  onOpen() {
    this.rendered = renderPermission(this.contentEl, this.request, (value) =>
      this.finish(value),
    );
  }
  open() {
    super.open();
    // Obsidian applies its own initial focus after onOpen returns.
    if (!this.closed) this.rendered?.deny.focus();
  }
  finish(value) {
    if (this.completed) return;
    this.completed = true;
    this.resolve(value);
    if (!this.closed) this.close();
  }
  onClose() {
    this.closed = true;
    this.rendered?.dispose();
    if (!this.completed) {
      this.completed = true;
      this.resolve(false);
    }
    this.contentEl.empty();
  }
}
module.exports = { PermissionModal, renderPermission };
