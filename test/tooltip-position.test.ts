import assert from "node:assert/strict";
import test from "node:test";

import { computeTooltipPosition } from "../ui/tooltip-position.ts";

const viewport = { width: 800, height: 600 };
const popup = { width: 280, height: 120 };

test("tooltip position is clamped to the left and right viewport edges", () => {
  const nearLeft = computeTooltipPosition(
    { top: 100, right: 16, bottom: 116, left: 0, width: 16, height: 16 },
    popup,
    viewport,
  );
  const nearRight = computeTooltipPosition(
    { top: 100, right: 800, bottom: 116, left: 784, width: 16, height: 16 },
    popup,
    viewport,
  );

  assert.equal(nearLeft.left, 8);
  assert.equal(nearRight.left + popup.width, viewport.width - 8);
});

test("tooltip flips above its anchor when there is not enough room below", () => {
  const result = computeTooltipPosition(
    { top: 570, right: 416, bottom: 586, left: 400, width: 16, height: 16 },
    popup,
    viewport,
  );

  assert.equal(result.placement, "above");
  assert.equal(result.top, 443);
  assert.ok(result.top >= 8);
  assert.ok(result.top + popup.height <= viewport.height - 8);
});
