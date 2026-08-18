export interface RectLike {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

export interface TooltipPosition {
  readonly top: number;
  readonly left: number;
  readonly placement: "above" | "below";
}

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 7;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/** Keeps a fixed-position tooltip inside the visible layout viewport. */
export function computeTooltipPosition(
  anchor: RectLike,
  popup: Pick<RectLike, "width" | "height">,
  viewport: ViewportSize,
): TooltipPosition {
  const maximumLeft = Math.max(VIEWPORT_MARGIN, viewport.width - popup.width - VIEWPORT_MARGIN);
  const centeredLeft = anchor.left + anchor.width / 2 - popup.width / 2;
  const left = clamp(centeredLeft, VIEWPORT_MARGIN, maximumLeft);

  const below = anchor.bottom + ANCHOR_GAP;
  const above = anchor.top - popup.height - ANCHOR_GAP;
  const fitsBelow = below + popup.height <= viewport.height - VIEWPORT_MARGIN;
  const fitsAbove = above >= VIEWPORT_MARGIN;
  const placement = !fitsBelow && fitsAbove ? "above" : "below";
  const requestedTop = placement === "above" ? above : below;
  const maximumTop = Math.max(VIEWPORT_MARGIN, viewport.height - popup.height - VIEWPORT_MARGIN);

  return {
    top: clamp(requestedTop, VIEWPORT_MARGIN, maximumTop),
    left,
    placement,
  };
}
