import { formatNumber, type PrecisionMode } from "../../src/ui-model.ts";
import type { Vec3 } from "../../src/math.ts";
import { useTranslation } from "react-i18next";
import { InfoTooltip } from "./InfoTooltip.tsx";

export function NumberValue({ value, precision, className = "" }: { value: number; precision: PrecisionMode; className?: string }) {
  return <span className={`numeric ${className}`} title={String(value)}>{formatNumber(value, precision)}</span>;
}

export function VectorValue({ value, precision }: { value: Vec3; precision: PrecisionMode }) {
  return (
    <span className="numeric vector-value" title={`(${value.join(", ")})`}>
      ({value.map((item) => formatNumber(item, precision)).join(", ")})
    </span>
  );
}

export function Metric({ label, technical, value, units, precision, help }: { label: string; technical?: string; value: number; units: string; precision: PrecisionMode; help?: string }) {
  const { t } = useTranslation("common");
  return (
    <div className="metric-row">
      <span className="metric-copy"><span className="metric-name">{label}{help && <InfoTooltip label={t("help.about", { subject: label })}>{help}</InfoTooltip>}</span>{technical && <small className="metric-technical">{technical}</small>}<small>{units}</small></span>
      <NumberValue value={value} precision={precision} />
    </div>
  );
}
