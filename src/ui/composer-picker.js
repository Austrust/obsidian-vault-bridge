"use strict";
const commands = [
  { value: "/visualize", label: "生成交互视图", detail: "输入需求后发送" },
  { value: "/resources", label: "引用外部资料", detail: "浏览已授权目录" },
  { value: "/skills", label: "选择 Skill", detail: "加入本轮上下文" },
  { value: "/history", label: "历史对话", detail: "查找与恢复会话" },
  { value: "/new", label: "新对话", detail: "开始独立的空白会话" },
  { value: "/stop", label: "停止任务", detail: "保留已完成的操作记录" },
];
function tokenAt(text, caret) {
  const prefix = text.slice(0, caret);
  const match = prefix.match(/(?:^|\s)([@/])([^\s@/]*)$/);
  if (!match || (match[1] === "/" && prefix.trimStart()[0] !== "/"))
    return null;
  return {
    kind: match[1],
    query: match[2],
    start: caret - match[2].length - 1,
    end: caret,
  };
}
function replaceToken(text, token, replacement) {
  return text.slice(0, token.start) + replacement + text.slice(token.end);
}
class ComposerPicker {
  constructor(view, container) {
    this.view = view;
    this.el = container.createDiv("vb-composer-picker");
    this.el.setAttribute("role", "listbox");
    this.el.setAttribute("aria-label", "引用与命令建议");
    this.el.id = "vb-picker-" + Math.random().toString(36).slice(2);
    view.input.setAttribute("aria-controls", this.el.id);
    view.input.setAttribute("aria-autocomplete", "list");
    view.input.addEventListener("blur", () => this.close());
    view.input.addEventListener("click", () => this.update());
    this.close();
  }
  close() {
    this.el.hidden = true;
    this.items = [];
    this.view.input.setAttribute("aria-expanded", "false");
    this.view.input.removeAttribute("aria-activedescendant");
  }
  update() {
    const { input, p, app } = this.view;
    this.token = tokenAt(input.value, input.selectionStart);
    if (!this.token) return this.close();
    const query = this.token.query.toLowerCase();
    const notes =
      app.vault?.getMarkdownFiles?.() ||
      [...p.mentions].map((path) => ({ path }));
    this.items = (
      this.token.kind === "@"
        ? notes
            .filter((n) => n.path.toLowerCase().includes(query))
            .map((n) => ({
              value: n.path,
              label: n.path.split("/").pop(),
              detail: n.path,
            }))
        : commands.filter(
            (c) => c.value.includes(query) || c.label.includes(query),
          )
    ).slice(0, 30);
    this.index = 0;
    this.el.empty();
    this.el.hidden = false;
    input.setAttribute("aria-expanded", "true");
    if (!this.items.length)
      this.el.createDiv({ cls: "na-muted", text: "没有匹配的项目" });
    this.items.forEach((item, index) => {
      const row = this.el.createEl("button", {
        cls: "vb-picker-option",
        attr: { role: "option", tabindex: "-1" },
      });
      row.id = this.el.id + "-" + index;
      row.createSpan({ text: item.label });
      row.createEl("small", { text: item.detail });
      row.onmousedown = (event) => event.preventDefault();
      row.onclick = () => this.choose(index);
    });
    this.highlight();
  }
  highlight() {
    [...this.el.querySelectorAll("[role=option]")].forEach((row, i) => {
      row.setAttribute("aria-selected", String(i === this.index));
      if (i === this.index) {
        this.view.input.setAttribute("aria-activedescendant", row.id);
        row.scrollIntoView({ block: "nearest" });
      }
    });
  }
  key(event) {
    if (this.el.hidden || event.isComposing) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
      return true;
    }
    if (["ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      if (this.items.length)
        this.index =
          (this.index +
            (event.key === "ArrowDown" ? 1 : -1) +
            this.items.length) %
          this.items.length;
      this.highlight();
      return true;
    }
    if (event.key === "Enter" && this.items.length) {
      event.preventDefault();
      this.choose(this.index);
      return true;
    }
    return false;
  }
  choose(index) {
    const item = this.items[index];
    if (!item) return;
    const { input, p } = this.view;
    const replacement = this.token.kind === "@" ? "" : item.value + " ";
    if (this.token.kind === "@") p.mentions.add(item.value);
    input.value = replaceToken(input.value, this.token, replacement);
    input.setSelectionRange(
      this.token.start + replacement.length,
      this.token.start + replacement.length,
    );
    p.draft = input.value;
    this.close();
    this.view.renderContext();
    this.view.resizeInput();
    input.focus();
    void p.persist().catch((e) => p.fail(e));
  }
}
module.exports = { ComposerPicker, tokenAt, replaceToken, commands };
