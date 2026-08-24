import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { computeTooltipPosition, type TooltipPosition } from "../tooltip-position.ts";
import { useTranslation } from "react-i18next";

interface InfoTooltipProps {
  readonly children: ReactNode;
  readonly label?: string;
}

export function InfoTooltip({ children, label }: InfoTooltipProps) {
  const { t } = useTranslation("common");
  const accessibleLabel = label ?? t("help.more");
  const id = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState<TooltipPosition>({ top: 0, left: 0, placement: "below" });

  const updatePosition = useCallback(() => {
    const root = rootRef.current;
    const popover = popoverRef.current;
    if (!root || !popover) return;

    setPosition(computeTooltipPosition(
      root.getBoundingClientRect(),
      popover.getBoundingClientRect(),
      {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      },
    ));
  }, []);

  useLayoutEffect(() => {
    if (!visible) return;
    updatePosition();

    const resizeObserver = new ResizeObserver(updatePosition);
    if (popoverRef.current) resizeObserver.observe(popoverRef.current);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [updatePosition, visible]);

  useEffect(() => {
    if (!visible) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) {
        setVisible(false);
        setPinned(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setVisible(false);
        setPinned(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [visible]);

  function toggle() {
    setPinned((current) => {
      const next = !current;
      setVisible(next);
      return next;
    });
  }

  return (
    <span
      className="info-tooltip"
      ref={rootRef}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => { if (!pinned) setVisible(false); }}
      onFocus={() => setVisible(true)}
      onBlur={(event) => {
        if (!pinned && !event.currentTarget.contains(event.relatedTarget as Node | null)) setVisible(false);
      }}
    >
      <button
        type="button"
        className="info-trigger"
        aria-label={accessibleLabel}
        aria-expanded={visible}
        aria-describedby={visible ? id : undefined}
        onClick={toggle}
      >i</button>
      {visible && createPortal(
        <span
          className={`info-popover${rootRef.current?.closest(".sidebar") ? " sidebar-info-popover" : ""}`}
          id={id}
          ref={popoverRef}
          role="tooltip"
          data-placement={position.placement}
          style={{ top: position.top, left: position.left }}
        >{children}</span>,
        document.body,
      )}
    </span>
  );
}
