const test = require("node:test");
const assert = require("node:assert/strict");
const { showMenuAtTrigger } = require("../src/ui/menu-position");

test("keyboard menu remains anchored after the button callback yields", () => {
  const calls = [];
  const menu = {
    showAtPosition: (p) => calls.push(p),
    showAtMouseEvent: () =>
      assert.fail("Keyboard menu used pointer coordinates"),
  };
  const button = { getBoundingClientRect: () => ({ left: 640, bottom: 77 }) };
  showMenuAtTrigger(menu, {
    detail: 0,
    clientX: 0,
    clientY: 0,
    currentTarget: null,
    target: { closest: () => button },
  });
  assert.deepEqual(calls, [{ x: 640, y: 77 }]);
});

test("pointer activation retains the original event position", () => {
  const event = { detail: 1, clientX: 650, clientY: 50 };
  showMenuAtTrigger(
    {
      showAtPosition: () => assert.fail("Pointer position was replaced"),
      showAtMouseEvent: (received) => assert.equal(received, event),
    },
    event,
  );
});
