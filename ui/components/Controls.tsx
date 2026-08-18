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
  return (
    <label className="control-row">
      <span className="control-label"><span>{label}<InfoTooltip label={`About ${label}`}>{help}</InfoTooltip></span><small>{units}</small></span>
      <input
        aria-label={`${label} slider`}
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.min(max, Math.max(min, value))}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <input
        aria-label={`${label} exact value`}
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
  const change = (key: keyof OperatingPoint, next: number) => onChange({ ...value, [key]: next });
  return (
    <section className="sidebar-section">
      <div className="section-heading"><span>Operating point</span><span className="section-heading-actions"><span className="live-indicator">LIVE</span><button type="button" className="section-reset" onClick={() => onChange(DEFAULT_OPERATING_POINT)}>Reset</button></span></div>
      <SliderNumber label="Speed" value={value.speed} min={0} max={300} step={1} units="game units/s" help="Machine-local translational speed used by the aerodynamic solver." onChange={(next) => change("speed", next)} />
      <SliderNumber label="Alpha · α" value={value.alphaDegrees} min={-30} max={30} step={0.1} units="degrees" help="Angle of attack changes the incoming velocity in the pitch plane. Positive α tilts velocity from +Z toward −Y; machine geometry does not rotate." onChange={(next) => change("alphaDegrees", next)} />
      <SliderNumber label="Beta · β" value={value.betaDegrees} min={-30} max={30} step={0.1} units="degrees" help="Sideslip angle changes incoming velocity in the yaw plane. β = 0° is zero sideslip; positive β adds a +X component." onChange={(next) => change("betaDegrees", next)} />
      <SliderNumber label="Roll rate p" value={value.p} min={-1} max={1} step={0.01} units="rad/s · about +Z" help="Angular roll rate about machine-forward +Z. It contributes to each blade's local velocity through ω × r." onChange={(next) => change("p", next)} />
      <SliderNumber label="Pitch rate q" value={value.q} min={-1} max={1} step={0.01} units="rad/s · about +X" help="Angular pitch rate about machine-right +X. The pitch damping derivative is calculated from moment changes around this rate." onChange={(next) => change("q", next)} />
      <SliderNumber label="Yaw rate r" value={value.r} min={-1} max={1} step={0.01} units="rad/s · about +Y" help="Angular yaw rate about machine-up +Y. The yaw damping derivative is calculated from moment changes around this rate." onChange={(next) => change("r", next)} />
    </section>
  );
}
