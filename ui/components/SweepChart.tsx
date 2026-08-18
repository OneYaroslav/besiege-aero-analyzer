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
import type { SweepResult } from "../../src/analysis.ts";
import { formatNumber, type PrecisionMode } from "../../src/ui-model.ts";
import { InfoTooltip } from "./InfoTooltip.tsx";

export type SweepMetric =
  | "forceX" | "forceY" | "forceZ"
  | "pitch" | "roll" | "yaw"
  | "power";

export const SWEEP_METRICS: Readonly<Record<SweepMetric, { label: string; units: string }>> = {
  forceX: { label: "Force X", units: "game force units" },
  forceY: { label: "Force Y", units: "game force units" },
  forceZ: { label: "Force Z", units: "game force units" },
  pitch: { label: "Pitch moment", units: "game moment units" },
  roll: { label: "Roll moment", units: "game moment units" },
  yaw: { label: "Yaw moment", units: "game moment units" },
  power: { label: "Blade power", units: "game power units" },
};

function metricValue(point: SweepResult["points"][number], metric: SweepMetric): number {
  if (metric === "forceX") return point.totalForce[0];
  if (metric === "forceY") return point.totalForce[1];
  if (metric === "forceZ") return point.totalForce[2];
  if (metric === "power") return point.totalBladePower;
  return point.moments[metric];
}

interface SweepChartProps {
  readonly title: string;
  readonly first: { name: string; sweep: SweepResult };
  readonly second?: { name: string; sweep: SweepResult };
  readonly metric: SweepMetric;
  readonly precision: PrecisionMode;
  readonly help: string;
  readonly xLabel: string;
  readonly centralValue: number;
}

export function SweepChart({ title, first, second, metric, precision, help, xLabel, centralValue }: SweepChartProps) {
  const data = first.sweep.points.map((point, index) => ({
    x: point.value,
    first: metricValue(point, metric),
    second: second ? metricValue(second.sweep.points[index], metric) : undefined,
  }));
  const xUnits = first.sweep.points[0]?.units ?? "";
  const centralPoint = data.find((point) => Math.abs(point.x - centralValue) < 1e-9);
  return (
    <section className="chart-panel">
      <div className="chart-title">
        <div><span>{title} <InfoTooltip label={`About ${title}`}>{help}</InfoTooltip></span><small>{SWEEP_METRICS[metric].label} · {SWEEP_METRICS[metric].units}</small></div>
      </div>
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 18, bottom: 8, left: 6 }}>
            <CartesianGrid stroke="#202c36" strokeDasharray="2 5" vertical={false} />
            <XAxis dataKey="x" stroke="#738392" tick={{ fontSize: 11 }} label={{ value: `${xLabel} · ${xUnits}`, position: "insideBottomRight", offset: -2, fill: "#81909e", fontSize: 10 }} />
            <YAxis stroke="#738392" tick={{ fontSize: 11 }} tickFormatter={(value) => formatNumber(Number(value), precision)} width={78} />
            <ReferenceLine x={0} stroke="#596a78" strokeWidth={1.25} />
            <ReferenceLine y={0} stroke="#596a78" strokeWidth={1.25} />
            <Tooltip
              contentStyle={{ background: "#0b1117", border: "1px solid #3a4a57", borderRadius: 2, fontFamily: "ui-monospace, monospace", fontSize: 12 }}
              labelStyle={{ color: "#dce6ed", marginBottom: 6 }}
              formatter={(value, name) => [formatNumber(Number(value), precision), String(name)]}
              labelFormatter={(value) => `${xLabel} = ${value} ${xUnits}`}
            />
            {second && <Legend wrapperStyle={{ fontSize: 11 }} />}
            <Line type="linear" dataKey="first" name={first.name} stroke="#6fd1ef" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
            {second && <Line type="linear" dataKey="second" name={second.name} stroke="#f0ab69" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />}
            {centralPoint && <ReferenceDot x={centralPoint.x} y={centralPoint.first} r={4} fill="#071015" stroke="#8be3fa" strokeWidth={2} />}
            {centralPoint && second && centralPoint.second !== undefined && <ReferenceDot x={centralPoint.x} y={centralPoint.second} r={4} fill="#071015" stroke="#f0ab69" strokeWidth={2} />}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
