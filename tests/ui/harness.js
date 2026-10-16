Element.prototype.empty = function () {
  this.replaceChildren();
};
Element.prototype.addClass = function (...c) {
  this.classList.add(...c);
};
Element.prototype.createEl = function (tag, options = {}) {
  const e = document.createElement(tag);
  if (typeof options === "string") options = { cls: options };
  if (options.cls) e.className = options.cls;
  if (options.text !== undefined) e.textContent = options.text;
  for (const [k, v] of Object.entries(options.attr || {})) e.setAttribute(k, v);
  if (options.type) e.type = options.type;
  this.append(e);
  return e;
};
Element.prototype.createDiv = function (o) {
  return this.createEl("div", o);
};
Element.prototype.createSpan = function (o) {
  return this.createEl("span", o);
};
class Component {
  registerInterval(id) {
    this.register(() => clearInterval(id));
    return id;
  }
  addChild(c) {
    return c;
  }
  removeChild() {}
  register() {}
  registerDomEvent(el, event, fn) {
    el.addEventListener(event, fn);
  }
  load() {}
  unload() {}
}
class ItemView extends Component {
  constructor() {
    super();
    this.contentEl = document.querySelector("#leaf");
    this.app = {};
  }
}
class FuzzySuggestModal {
  constructor() {}
  setPlaceholder() {}
  open() {
    const out = document.querySelector("#history");
    out.replaceChildren();
    for (const s of this.getItems()) {
      const b = out.createEl("button", { text: this.getItemText(s) });
      b.onclick = () => this.onChooseItem(s);
    }
  }
}
function setIcon(el, name) {
  el.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="' +
    ({
      "arrow-up": "M12 19V5m-6 6 6-6 6 6",
      "chevron-down": "m6 9 6 6 6-6",
      check: "m5 12 4 4L19 6",
      "circle-check": "M20 11a8 8 0 1 1-4-7M9 10l3 3 8-8",
      copy: "M9 9h11v11H9zM5 15H3V3h12v2",
      ellipsis: "M4 12h1m6 0h1m6 0h1",
      "square-pen": "M12 3H3v18h18v-9M9 15l1-5L19 1l4 4-9 9z",
      history: "M3 4v6h6M3 10a9 9 0 1 1 1 9M12 7v5l3 2",
      waypoints: "M6 6l12 6-12 6z",
      paperclip: "M8 12l7-7a4 4 0 0 1 6 6L10 22a6 6 0 0 1-8-8L13 3",
      "at-sign": "M16 8v7h3a9 9 0 1 0-4 6M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
      sparkles: "m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z",
    }[name] || "M4 18V6h16v12zM8 14l4-5 4 5") +
    '"/></svg>';
}
class Modal {
  constructor() {
    this.contentEl = document.createElement("div");
    this.contentEl.style.cssText =
      "position:fixed;inset:30px 20%;background:var(--background-primary,white);padding:24px;z-index:100;overflow:auto";
  }
  open() {
    this.contentEl.setAttribute("role", "dialog");
    document.body.append(this.contentEl);
    const close = this.contentEl.createEl("button", {
      text: "关闭",
      attr: { "aria-label": "关闭窗口" },
    });
    close.onclick = () => this.close();
    this.onOpen();
    this.key = (e) => {
      if (e.key === "Escape") this.close();
    };
    document.addEventListener("keydown", this.key);
  }
  close() {
    document.removeEventListener("keydown", this.key);
    this.onClose();
    this.contentEl.remove();
  }
}
const obsidian = {
  Modal,
  setIcon,
  Menu: class {
    constructor() {
      this.el = document.createElement("div");
      this.el.className = "fixture-menu";
      this.el.setAttribute("role", "menu");
    }
    addItem(fn) {
      const b = this.el.createEl("button", { attr: { role: "menuitem" } });
      const item = {
        setTitle: (t) => {
          b.textContent = t;
          return item;
        },
        setIcon: () => item,
        setDisabled: (v) => {
          b.disabled = v;
          return item;
        },
        onClick: (cb) => {
          b.onclick = () => {
            this.el.remove();
            cb();
          };
          return item;
        },
      };
      fn(item);
      return this;
    }
    addSeparator() {
      this.el.createEl("hr");
      return this;
    }
    showAtPosition(position) {
      this.showAtMouseEvent({ clientX: position.x, clientY: position.y });
    }
    showAtMouseEvent(event) {
      document.querySelectorAll(".fixture-menu").forEach((e) => e.remove());
      document.body.append(this.el);
      this.el.style.cssText =
        "position:fixed;z-index:200;background:var(--background-primary,white);padding:8px;border:1px solid #aaa;border-radius:8px;display:grid;gap:4px;max-height:85vh;overflow:auto;";
      this.el.style.left =
        Math.max(
          0,
          Math.min(event.clientX, innerWidth - this.el.offsetWidth - 10),
        ) + "px";
      this.el.style.top =
        Math.max(
          0,
          Math.min(event.clientY, innerHeight - this.el.offsetHeight - 10),
        ) + "px";
      const close = (e) => {
        if (!this.el.contains(e.target)) {
          this.el.remove();
          document.removeEventListener("pointerdown", close);
        }
      };
      document.addEventListener("pointerdown", close);
    }
  },
  Plugin: class {},
  ItemView,
  PluginSettingTab: class {
    constructor() {
      this.containerEl = document.createElement("div");
    }
  },
  Setting: class {
    constructor(parent) {
      this.el = parent.createDiv("setting-item");
    }
    setName(text) {
      this.el.createEl("strong", { text });
      return this;
    }
    setDesc(text) {
      this.el.createEl("p", { text });
      return this;
    }
    addText(fn) {
      const el = this.el.createEl("input");
      const t = {
        inputEl: el,
        setValue(v) {
          el.value = v;
          return t;
        },
        onChange(cb) {
          el.oninput = () => cb(el.value);
          return t;
        },
      };
      fn(t);
      return this;
    }
    addToggle(fn) {
      const el = this.el.createEl("input", { type: "checkbox" });
      const t = {
        setValue(v) {
          el.checked = v;
          return t;
        },
        onChange(cb) {
          el.onchange = () => cb(el.checked);
          return t;
        },
      };
      fn(t);
      return this;
    }
    addDropdown(fn) {
      const el = this.el.createEl("select");
      const t = {
        addOptions(options) {
          for (const [v, label] of Object.entries(options))
            el.add(new Option(label, v));
          return t;
        },
        addOption(v, label) {
          el.add(new Option(label, v));
          return t;
        },
        setValue(v) {
          el.value = v;
          return t;
        },
        onChange(cb) {
          el.onchange = () => cb(el.value);
          return t;
        },
      };
      fn(t);
      return this;
    }
    addButton(fn) {
      const el = this.el.createEl("button");
      const t = {
        setButtonText(v) {
          el.textContent = v;
          return t;
        },
        onClick(cb) {
          el.onclick = cb;
          return t;
        },
      };
      fn(t);
      return this;
    }
  },
  Notice: class {
    constructor(message) {
      document.querySelector("#result").textContent = message;
    }
  },
  MarkdownView: class {},
  MarkdownRenderer: {
    render: async (app, t, el) => {
      if (window.marked) el.innerHTML = window.marked.parse(t);
      else el.textContent = t;
    },
  },
  Component,
  FuzzySuggestModal,
};
const require = (name) =>
  name === "obsidian"
    ? obsidian
    : name === "electron"
      ? {
          clipboard: {
            writeText: (text) => {
              document.querySelector("#copied").value = text;
            },
          },
        }
      : {};
const module = { exports: {} };
