import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  TUTORIAL_STEPS,
  computeTutorialCardPosition,
  isTutorialStepComplete,
  type TutorialProgress,
  type TutorialRect,
} from "../../src/tutorial.ts";

interface TutorialOverlayProps {
  readonly stepIndex: number;
  readonly progress: TutorialProgress;
  readonly onStepChange: (index: number) => void;
  readonly onSkip: () => void;
  readonly onFinish: () => void;
  readonly onOpenAircraft: () => void;
}

function rectFromElement(element: Element): TutorialRect {
  const rect = element.getBoundingClientRect();
  const padding = 8;
  const left = Math.max(6, rect.left - padding);
  const top = Math.max(6, rect.top - padding);
  const right = Math.min(window.innerWidth - 6, rect.right + padding);
  const bottom = Math.min(window.innerHeight - 6, rect.bottom + padding);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function TutorialOverlay(props: TutorialOverlayProps) {
  const { t } = useTranslation("tutorial");
  const step = TUTORIAL_STEPS[props.stepIndex];
  const [targetRect, setTargetRect] = useState<TutorialRect | null>(null);
  const [targetReady, setTargetReady] = useState(!step.target);
  const [cardSize, setCardSize] = useState({ width: 380, height: 230 });
  const cardRef = useRef<HTMLElement>(null);
  const complete = isTutorialStepComplete(step, props.progress);
  const last = props.stepIndex === TUTORIAL_STEPS.length - 1;
  const pitchDampingExample = props.progress.pitchDampingExample === null
    ? "unavailable"
    : new Intl.NumberFormat("en-US", { maximumSignificantDigits: 6 }).format(props.progress.pitchDampingExample);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const update = () => setCardSize({ width: card.offsetWidth, height: card.offsetHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(card);
    return () => observer.disconnect();
  }, [props.stepIndex, complete]);

  useEffect(() => {
    let target: Element | null = null;
    let targetObserver: ResizeObserver | undefined;
    let frame = 0;
    const update = () => {
      target = step.target ? document.querySelector(step.target) : null;
      setTargetReady(!step.target || Boolean(target));
      setTargetRect(target ? rectFromElement(target) : null);
    };
    const prepare = () => {
      target = step.target ? document.querySelector(step.target) : null;
      target?.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
      frame = requestAnimationFrame(() => {
        update();
        if (target) {
          targetObserver = new ResizeObserver(update);
          targetObserver.observe(target);
        }
      });
    };
    prepare();
    const mutationObserver = new MutationObserver(update);
    mutationObserver.observe(document.body, { childList: true, subtree: true, attributes: true });
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(frame);
      targetObserver?.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [step]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onSkip();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [props.onSkip]);

  const position = computeTutorialCardPosition(
    targetReady ? targetRect : null,
    cardSize,
    { width: window.innerWidth, height: window.innerHeight },
    targetReady ? step.placement : "center",
  );
  const masks = targetRect && targetReady ? [
    { left: 0, top: 0, right: 0, height: targetRect.top },
    { left: 0, top: targetRect.bottom, right: 0, bottom: 0 },
    { left: 0, top: targetRect.top, width: targetRect.left, height: targetRect.height },
    { left: targetRect.right, top: targetRect.top, right: 0, height: targetRect.height },
  ] : [{ inset: 0 }];

  return createPortal(<div className="tutorial-layer" data-step={step.id}>
    {masks.map((style, index) => <div className="tutorial-mask" style={style} key={index} />)}
    {targetRect && targetReady && <div className="tutorial-spotlight" style={{ left: targetRect.left, top: targetRect.top, width: targetRect.width, height: targetRect.height }} />}
    <section
      ref={cardRef}
      className={`tutorial-card placement-${position.placement}${step.compactCard ? " compact" : ""}`}
      style={{ left: position.left, top: position.top }}
      role="dialog"
      aria-modal="false"
      aria-labelledby="tutorial-title"
    >
      <div className="tutorial-progress"><span>{t("stepLabel", { current: props.stepIndex + 1, total: TUTORIAL_STEPS.length })}</span><button type="button" onClick={props.onSkip}>{t("skip")}</button></div>
      <h2 id="tutorial-title">{t(`steps.${step.id}.title`)}</h2>
      <p>{t(`steps.${step.id}.content`, { pitchDampingExample })}</p>
      {!targetReady && <div className="tutorial-condition waiting">{t("targetUnavailable")}</div>}
      {step.completion && <div className={`tutorial-condition ${complete ? "complete" : "waiting"}`}>{complete ? t("complete") : t("waiting")}</div>}
      <div className="tutorial-actions">
        {!last && <button type="button" disabled={props.stepIndex === 0} onClick={() => props.onStepChange(props.stepIndex - 1)}>{t("back")}</button>}
        {!last && <button type="button" className="primary-button" disabled={!complete || !targetReady} onClick={() => props.onStepChange(props.stepIndex + 1)}>{t("next")}</button>}
        {last && <><button type="button" onClick={props.onOpenAircraft}>{t("openAircraft")}</button><button type="button" className="primary-button" onClick={props.onFinish}>{t("finish")}</button></>}
      </div>
    </section>
  </div>, document.body);
}
