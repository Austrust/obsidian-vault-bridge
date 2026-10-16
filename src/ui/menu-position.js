// Keyboard clicks have no pointer coordinates. currentTarget may already be
// cleared when an asynchronous button callback runs, so retain the target fallback.
function showMenuAtTrigger(menu, event) {
  const anchor = event.currentTarget || event.target?.closest?.("button");
  if (event.detail === 0 && anchor?.getBoundingClientRect) {
    const rect = anchor.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom });
  } else {
    menu.showAtMouseEvent(event);
  }
}
module.exports = { showMenuAtTrigger };
