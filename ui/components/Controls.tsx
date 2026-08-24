import { useTranslation } from "react-i18next";
import { DEFAULT_OPERATING_POINT, type OperatingPoint } from "../../src/ui-model.ts";
import { InfoTooltip } from "./InfoTooltip.tsx";

interface SliderNumberProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly units: string;
  readonly help: string;
  readonly onChange: (value: number) => void;
}

function SliderNumber({ label, value, min, max, step, units, help, onChange }: SliderNumberProps) {
  const { t } = useTranslation("common");
  return (
    <label className="control-row">
      <span className="control-label"><span>{label}<InfoTooltip label={t("help.about", { subject: label })}>{help}</InfoTooltip></span><small>{units}</small></span>
      <input
        aria-label={t("help.slider", { label })}
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.min(max, Math.max(min, value))}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <input
        aria-label={t("help.exactValue", { label })}
        className="number-input"
        type="number"
        step={step}
        value={value}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
    </label>
  );
}

interface OperatingControlsProps {
  readonly value: OperatingPoint;
  readonly onChange: (value: OperatingPoint) => void;
}

export function OperatingControls({ value, onChange }: OperatingControlsProps) {
  const { t } = useTranslation(["analysis", "common"]);
  const change = (key: keyof OperatingPoint, next: number) => onChange({ ...value, [key]: next });
  return (
    <section className="sidebar-section" data-tutorial="operating-point">
      <div className="section-heading"><span>{t("analysis:operating.title")}</span><span className="section-heading-actions"><span className="live-indicator">{t("common:status.live")}</span><button type="button" className="section-reset" onClick={() => onChange(DEFAULT_OPERATING_POINT)}>{t("common:actions.reset")}</button></span></div>
      <SliderNumber label={t("analysis:operating.speed")} value={value.speed} min={0} max={300} step={1} units={t("analysis:units.gameSpeed")} help={t("analysis:operating.help.speed")} onChange={(next) => change("speed", next)} />
      <SliderNumber label={t("analysis:operating.alpha")} value={value.alphaDegrees} min={-30} max={30} step={0.1} units={t("analysis:units.degrees")} help={t("analysis:operating.help.alpha")} onChange={(next) => change("alphaDegrees", next)} />
      <SliderNumber label={t("analysis:operating.beta")} value={value.betaDegrees} min={-30} max={30} step={0.1} units={t("analysis:units.degrees")} help={t("analysis:operating.help.beta")} onChange={(next) => change("betaDegrees", next)} />
      <SliderNumber label={t("analysis:operating.p")} value={value.p} min={-1} max={1} step={0.01} units={t("analysis:units.rateZ")} help={t("analysis:operating.help.p")} onChange={(next) => change("p", next)} />
      <SliderNumber label={t("analysis:operating.q")} value={value.q} min={-1} max={1} step={0.01} units={t("analysis:units.rateX")} help={t("analysis:operating.help.q")} onChange={(next) => change("q", next)} />
      <SliderNumber label={t("analysis:operating.r")} value={value.r} min={-1} max={1} step={0.01} units={t("analysis:units.rateY")} help={t("analysis:operating.help.r")} onChange={(next) => change("r", next)} />
    </section>
  );
}
