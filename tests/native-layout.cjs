// Explicit native fixture runner; requires native-fixture.cjs already installed.
module.exports = async function measureNativeLayout(app, qa, output) {
  const fs = require("node:fs"),
    path = require("node:path");
  const { host, view } = qa.fixture;
  if (host.sessionId !== "native-acceptance-sample" || view.p !== host)
    throw Error("Independent native fixture required");
  const win = view.contentEl.ownerDocument.defaultView;
  const native = win.require("@electron/remote").getCurrentWindow();
  const frame = win.require("electron").webFrame;
  const version = app.plugins.plugins["vault-bridge"].manifest.version;
  if (native.isMaximized()) native.unmaximize();
  native.webContents.setBackgroundThrottling(false);
  native.focus();
  const results = [];
  const settle = () => new Promise((resolve) => setTimeout(resolve, 250));
  for (const theme of ["light", "dark"]) {
    win.document.body.classList.toggle("theme-dark", theme === "dark");
    win.document.body.classList.toggle("theme-light", theme === "light");
    for (const [width, height, zoom] of [
      [320, 500, 1],
      [360, 500, 1.25],
      [420, 500, 1.5],
      [320, 360, 1.25],
    ]) {
      frame.setZoomFactor(zoom);
      native.setSize(
        Math.round(1060 * zoom),
        Math.round((height + 40) * zoom + 1),
      );
      app.workspace.rightSplit.setSize(width);
      await settle();
      view.fitStatusBar();
      view.followTail = true;
      view.scrollToEnd();
      await settle();
      const root = view.contentEl.getBoundingClientRect();
      const input = view.input.getBoundingClientRect();
      const send = view.send.getBoundingClientRect();
      const bar = win.document
        .querySelector(".status-bar")
        ?.getBoundingClientRect();
      const record = {
        theme,
        width,
        height,
        zoom,
        actualWidth: root.width,
        actualHeight: root.height,
        horizontalOverflow:
          view.contentEl.scrollWidth - view.contentEl.clientWidth,
        inputHeight: input.height,
        sendAboveStatus: !bar || send.bottom <= bar.top + 1,
        sendInside:
          send.left >= root.left &&
          send.right <= root.right + 1 &&
          send.top >= root.top,
        tailGap:
          view.log.scrollHeight - view.log.clientHeight - view.log.scrollTop,
      };
      if (Math.abs(root.height - height) > 40)
        throw Error(`Requested height ${height}, measured ${root.height}`);
      if (
        record.horizontalOverflow > 1 ||
        !record.sendInside ||
        !record.sendAboveStatus
      )
        throw Error(`Composer layout failed: ${JSON.stringify(record)}`);
      results.push(record);
      if (width === 320) {
        // capturePage uses window DIP coordinates, while DOM rects are CSS pixels.
        const shot = await native.webContents.capturePage({
          x: Math.floor(root.x * zoom),
          y: Math.floor(root.y * zoom),
          width: Math.floor(root.width * zoom),
          height: Math.floor(root.height * zoom),
        });
        fs.writeFileSync(
          path.join(
            output,
            `native-${theme}-${width}x${height}-${zoom}-${version}.png`,
          ),
          shot.toPNG(),
        );
      }
    }
  }
  fs.writeFileSync(
    path.join(output, `native-layout-${version}.json`),
    JSON.stringify(results, null, 2) + "\n",
  );
  return results;
};
