import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useEffect, useMemo } from "react";
import type { SweepResult } from "../../src/analysis.ts";
import {
  computeSweepCurveMetrics,
  expandStickySweepDomain,
  paddedSweepDomain,
  sweepMetricValue,
  type StandardSweepMetric,
  type StickySweepDomain,
} from "../../src/sweep-visualization.ts";
import { formatNumber, type PrecisionMode } from "../../src/ui-model.ts";
import { InfoTooltip } from "./InfoTooltip.tsx";
import { useTranslation } from "react-i18next";

export type SweepMetric = StandardSweepMetric;

export const SWEEP_METRICS: Readonly<Record<SweepMetric, { label: string; units: string }>> = {
  forceX: { label: "Force X", units: "game force units" },
  forceY: { label: "Force Y", units: "game force units" },
  forceZ: { label: "Force Z", units: "game force units" },
  pitch: { label: "Pitch moment", units: "game moment units" },
  roll: { label: "Roll moment", units: "game moment units" },
  yaw: { label: "Yaw moment", units: "game moment units" },
  power: { label: "Blade power", units: "game power units" },
};

interface SweepChartProps {
  readonly title: string;
  readonly first: { name: string; sweep: SweepResult; baseline: SweepResult; baselineId: string };
  readonly second?: { name: string; sweep: SweepResult; baseline: SweepResult; baselineId: string };
  readonly metric: SweepMetric;
  readonly precision: PrecisionMode;
  readonly help: string;
  readonly xLabel: string;
  readonly centralValue: number;
  readonly tutorialId?: string;
  readonly stickyDomain?: StickySweepDomain;
  readonly onStickyDomainChange: (domain: StickySweepDomain) => void;
}

export function SweepChart({ title, first, second, metric, precision, help, xLabel, centralValue, tutorialId, stickyDomain, onStickyDomainChange }: SweepChartProps) {
  const { t } = useTranslation("analysis");
  const data = first.sweep.points.map((point, index) => ({
    x: point.value,
    firstBaseline: sweepMetricValue(first.baseline.points[index], metric),
    firstCurrent: sweepMetricValue(point, metric),
    secondBaseline: second ? sweepMetricValue(second.baseline.points[index], metric) : undefined,
    secondCurrent: second ? sweepMetricValue(second.sweep.points[index], metric) : undefined,
  }));
  const baselineValues = data.flatMap((point) => [point.firstBaseline, point.secondBaseline].filter((value): value is number => value !== undefined));
  const currentValues = data.flatMap((point) => [point.firstCurrent, point.secondCurrent].filter((value): value is number => value !== undefined));
  const domainSignature = `${first.baselineId}|${second?.baselineId ?? "single"}|${metric}`;
  const effectiveDomain = useMemo(() => {
    const initial = stickyDomain?.signature === domainSignature ? stickyDomain.domain : paddedSweepDomain(baselineValues);
    return expandStickySweepDomain(initial, currentValues);
  }, [domainSignature, stickyDomain?.signature, stickyDomain?.domain[0], stickyDomain?.domain[1], baselineValues.join("|"), currentValues.join("|")]);
  useEffect(() => {
    if (stickyDomain?.signature === domainSignature && stickyDomain.domain[0] === effectiveDomain[0] && stickyDomain.domain[1] === effectiveDomain[1]) return;
    onStickyDomainChange({ signature: domainSignature, domain: effectiveDomain });
  }, [domainSignature, effectiveDomain[0], effectiveDomain[1], onStickyDomainChange, stickyDomain?.signature, stickyDomain?.domain[0], stickyDomain?.domain[1]]);
  const xUnits = first.sweep.points[0]?.units ?? "";
  const localizedXUnits = xUnits === "degrees" ? t("units.degrees") : xUnits === "rad/s" ? t("units.radiansPerSecond") : xUnits;
  const centralPoint = data.find((point) => Math.abs(point.x - centralValue) < 1e-9);
  const showShapeMetric = first.sweep.variable === "alpha" || first.sweep.variable === "beta";
  const metricRows = [first, ...(second ? [second] : [])].map((machine, index) => {
    const baseline = computeSweepCurveMetrics(machine.baseline, metric);
    const current = computeSweepCurveMetrics(machine.sweep, metric);
    return { machine, baseline, current, index };
  });
  const delta = (current: number, baseline: number) => {
    const value = current - baseline;
    return `${value > 0 ? "+" : ""}${formatNumber(value, precision)}`;
  };
  return (
    <section className="chart-panel" data-tutorial={tutorialId}>
      <div className="chart-title">
        <div><span>{title} <InfoTooltip label={`${title}`}>{help}</InfoTooltip></span><small>{t(`sweepMetrics.${metric}` as never)} · {t(metric === "power" ? "units.power" : metric.startsWith("force") ? "units.force" : "units.moment")}</small></div>
      </div>
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 18, bottom: 8, left: 6 }}>
            <CartesianGrid stroke="#202c36" strokeDasharray="2 5" vertical={false} />
            <XAxis dataKey="x" stroke="#738392" tick={{ fontSize: 11 }} label={{ value: `${xLabel} · ${localizedXUnits}`, position: "insideBottomRight", offset: -2, fill: "#81909e", fontSize: 10 }} />
            <YAxis domain={effectiveDomain as [number, number]} allowDataOverflow stroke="#738392" tick={{ fontSize: 11 }} tickFormatter={(value) => formatNumber(Number(value), precision)} width={78} />
            <ReferenceLine x={0} stroke="#596a78" strokeWidth={1.25} />
            <ReferenceLine y={0} stroke="#596a78" strokeWidth={1.25} />
            <Tooltip
              contentStyle={{ background: "#0b1117", border: "1px solid #3a4a57", borderRadius: 2, fontFamily: "ui-monospace, monospace", fontSize: 12 }}
              labelStyle={{ color: "#dce6ed", marginBottom: 6 }}
              formatter={(value, name) => [formatNumber(Number(value), precision), String(name)]}
              labelFormatter={(value) => `${xLabel} = ${value} ${localizedXUnits}`}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Line type="linear" dataKey="firstBaseline" name={second ? `A · ${first.name} · ${t("sweepVisualization.baseline")}` : t("sweepVisualization.baseline")} stroke="#6fd1ef" strokeOpacity={0.42} strokeDasharray="5 4" strokeWidth={1.25} dot={false} isAnimationActive={false} />
            <Line type="linear" dataKey="firstCurrent" name={second ? `A · ${first.name} · ${t("sweepVisualization.current")}` : t("sweepVisualization.current")} stroke="#6fd1ef" strokeWidth={2.25} dot={{ r: 2 }} isAnimationActive={false} />
            {second && <Line type="linear" dataKey="secondBaseline" name={`B · ${second.name} · ${t("sweepVisualization.baseline")}`} stroke="#f0ab69" strokeOpacity={0.42} strokeDasharray="5 4" strokeWidth={1.25} dot={false} isAnimationActive={false} />}
            {second && <Line type="linear" dataKey="secondCurrent" name={`B · ${second.name} · ${t("sweepVisualization.current")}`} stroke="#f0ab69" strokeWidth={2.25} dot={{ r: 2 }} isAnimationActive={false} />}
            {centralPoint && <ReferenceDot x={centralPoint.x} y={centralPoint.firstCurrent} r={4} fill="#071015" stroke="#8be3fa" strokeWidth={2} />}
            {centralPoint && second && centralPoint.secondCurrent !== undefined && <ReferenceDot x={centralPoint.x} y={centralPoint.secondCurrent} r={4} fill="#071015" stroke="#f0ab69" strokeWidth={2} />}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="sweep-metrics" aria-label={t("sweepVisualization.metrics.title")}>
        {metricRows.map(({ machine, baseline, current, index }) => <section key={`${machine.baselineId}-${index}`} className={index === 0 ? "machine-a" : "machine-b"}>
          <strong>{second ? `${index === 0 ? "A" : "B"} · ${machine.name}` : t("sweepVisualization.current")}</strong>
          <dl>
            <div><dt>{t("sweepVisualization.metrics.center")}</dt><dd>{formatNumber(current.center, precision)}</dd><small>Δ {delta(current.center, baseline.center)}</small></div>
            <div><dt>{t("sweepVisualization.metrics.slope")}</dt><dd>{formatNumber(current.slope, precision)}</dd><small>Δ {delta(current.slope, baseline.slope)}</small></div>
            <div><dt>{t("sweepVisualization.metrics.range")}</dt><dd>{formatNumber(current.range, precision)}</dd><small>Δ {delta(current.range, baseline.range)}</small></div>
            {showShapeMetric && <div><dt>{t("sweepVisualization.metrics.slopeVariation")}</dt><dd>{formatNumber(current.slopeVariation, precision)}</dd><small>Δ {delta(current.slopeVariation, baseline.slopeVariation)}</small></div>}
          </dl>
        </section>)}
      </div>
    </section>
  );
}
