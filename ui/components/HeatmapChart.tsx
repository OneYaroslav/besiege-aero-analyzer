import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { zeroContourSegments, type Plot2DPoint, type Plot2DResult } from "../../src/plot-lab.ts";
import { formatNumber, type PrecisionMode } from "../../src/ui-model.ts";
import { useTranslation } from "react-i18next";

interface HeatmapChartProps {
  readonly title: string;
  readonly result: Plot2DResult;
  readonly precision: PrecisionMode;
  readonly domain?: readonly [number, number];
  readonly tone?: "A" | "B" | "delta";
  readonly contours?: readonly HeatmapContour[];
}

export interface HeatmapContour {
  readonly result: Plot2DResult;
  readonly label: string;
  readonly color: string;
  readonly dashed?: boolean;
}

interface HoverPoint {
  readonly point: Plot2DPoint;
  readonly left: number;
  readonly top: number;
}

type Rgb = readonly [number, number, number];

const ZERO: Rgb = [29, 40, 49];
const POSITIVE: Rgb = [76, 190, 218];
const NEGATIVE: Rgb = [211, 119, 68];

function mix(first: Rgb, second: Rgb, amount: number): string {
  const channel = (index: number) => Math.round(first[index] + (second[index] - first[index]) * Math.max(0, Math.min(1, amount)));
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

function heatColor(value: number, minimum: number, maximum: number): string {
  if (minimum === maximum) return mix(ZERO, minimum === 0 ? ZERO : minimum < 0 ? NEGATIVE : POSITIVE, 1);
  if (minimum < 0 && maximum > 0) {
    if (value < 0) return mix(ZERO, NEGATIVE, Math.abs(value / minimum));
    return mix(ZERO, POSITIVE, value / maximum);
  }
  if (maximum <= 0) return mix(ZERO, NEGATIVE, minimum === maximum ? 1 : (maximum - value) / (maximum - minimum));
  return mix(ZERO, POSITIVE, minimum === maximum ? 1 : (value - minimum) / (maximum - minimum));
}

function domainFor(result: Plot2DResult): readonly [number, number] {
  const values = result.points.map((point) => point.value).filter(Number.isFinite);
  if (values.length === 0) return [0, 0];
  return [Math.min(...values), Math.max(...values)];
}

export function HeatmapChart({ title, result, precision, domain, tone, contours = [] }: HeatmapChartProps) {
  const { t } = useTranslation("plotlab");
  const xLabel = t(`inputs.${result.config.xVariable}`);
  const yLabel = t(`inputs.${result.config.yVariable}`);
  const quantityLabel = t(`quantities.${result.config.quantity}`);
  const translatedUnits = (units: string) => t(`units.${units}`, { defaultValue: units });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 360 });
  const [hover, setHover] = useState<HoverPoint>();
  const [minimum, maximum] = domain ?? domainFor(result);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const update = () => setSize({ width: Math.max(1, wrap.clientWidth), height: Math.max(240, wrap.clientHeight) });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width === 0) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    const columns = result.xValues.length;
    const rows = result.yValues.length;
    const cellWidth = size.width / columns;
    const cellHeight = size.height / rows;
    result.points.forEach((point, index) => {
      const xIndex = index % columns;
      const yIndex = Math.floor(index / columns);
      const displayRow = rows - yIndex - 1;
      context.fillStyle = heatColor(point.value, minimum, maximum);
      context.fillRect(xIndex * cellWidth, displayRow * cellHeight, Math.ceil(cellWidth + 0.4), Math.ceil(cellHeight + 0.4));
    });
    const xMinimum = result.xValues[0] ?? 0;
    const xMaximum = result.xValues.at(-1) ?? xMinimum;
    const yMinimum = result.yValues[0] ?? 0;
    const yMaximum = result.yValues.at(-1) ?? yMinimum;
    const toCanvas = (point: readonly [number, number]): readonly [number, number] => [
      xMaximum === xMinimum ? size.width / 2 : cellWidth / 2 + (point[0] - xMinimum) / (xMaximum - xMinimum) * (size.width - cellWidth),
      yMaximum === yMinimum ? size.height / 2 : size.height - cellHeight / 2 - (point[1] - yMinimum) / (yMaximum - yMinimum) * (size.height - cellHeight),
    ];
    for (const contour of contours) {
      context.save();
      context.strokeStyle = contour.color;
      context.lineWidth = 1.8;
      context.setLineDash(contour.dashed ? [5, 4] : []);
      context.shadowColor = "rgba(3, 8, 12, .9)";
      context.shadowBlur = 2;
      context.beginPath();
      for (const segment of zeroContourSegments(contour.result)) {
        const from = toCanvas(segment.from);
        const to = toCanvas(segment.to);
        context.moveTo(from[0], from[1]);
        context.lineTo(to[0], to[1]);
      }
      context.stroke();
      context.restore();
    }
  }, [maximum, minimum, result, size, contours]);

  function pointAt(event: PointerEvent<HTMLCanvasElement>): void {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const localX = Math.max(0, Math.min(rect.width - 0.01, event.clientX - rect.left));
    const localY = Math.max(0, Math.min(rect.height - 0.01, event.clientY - rect.top));
    const xIndex = Math.floor(localX / rect.width * result.xValues.length);
    const displayRow = Math.floor(localY / rect.height * result.yValues.length);
    const yIndex = result.yValues.length - displayRow - 1;
    const point = result.points[yIndex * result.xValues.length + xIndex];
    if (!point) return;
    setHover({
      point,
      left: Math.min(localX + 12, Math.max(6, rect.width - 194)),
      top: Math.min(localY + 12, Math.max(6, rect.height - 86)),
    });
  }

  const swatches = useMemo(() => Array.from({ length: 25 }, (_, index) => heatColor(minimum + (maximum - minimum) * index / 24, minimum, maximum)), [maximum, minimum]);
  const hasZero = minimum < 0 && maximum > 0;
  const zeroPosition = hasZero ? (0 - minimum) / (maximum - minimum) * 100 : 0;

  return (
    <section className={`heatmap-panel ${tone ? `machine-${tone.toLowerCase()}` : ""}`}>
      <div className="heatmap-title"><div><strong>{title}</strong><small>{translatedUnits(result.valueUnits)}</small>{contours.length > 0 && <div className="heatmap-contour-legend">{contours.map((contour) => <span key={`${contour.label}-${contour.color}`}><i style={{ borderColor: contour.color, borderTopStyle: contour.dashed ? "dashed" : "solid" }} />{contour.label}</span>)}</div>}</div><span>{result.config.xRange.points} × {result.config.yRange.points} {t("cells")}</span></div>
      <div className="heatmap-layout">
        <div className="heatmap-y-label"><span>{yLabel} · {translatedUnits(result.yUnits)}</span></div>
        <div className="heatmap-y-ticks"><span>{formatNumber(result.yValues.at(-1) ?? 0, precision)}</span><span>{formatNumber(result.yValues[0] ?? 0, precision)}</span></div>
        <div className="heatmap-canvas-wrap" ref={wrapRef}>
          <canvas ref={canvasRef} role="img" aria-label={t("heatmapAria", { title, quantity: quantityLabel, x: xLabel, y: yLabel })} onPointerMove={pointAt} onPointerLeave={() => setHover(undefined)} />
          {hover && <div className="heatmap-tooltip" style={{ left: hover.left, top: hover.top }}>
            <span>{xLabel} = <strong>{formatNumber(hover.point.x, precision)}</strong> {translatedUnits(result.xUnits)}</span>
            <span>{yLabel} = <strong>{formatNumber(hover.point.y, precision)}</strong> {translatedUnits(result.yUnits)}</span>
            <span>{t("valueLower")} = <strong>{formatNumber(hover.point.value, precision)}</strong> {translatedUnits(result.valueUnits)}</span>
          </div>}
        </div>
        <div className="heatmap-x-label"><span>{xLabel} · {translatedUnits(result.xUnits)}</span><div><span>{formatNumber(result.xValues[0] ?? 0, precision)}</span><span>{formatNumber(result.xValues.at(-1) ?? 0, precision)}</span></div></div>
      </div>
      <div className="heatmap-legend" aria-label={t("colorScale", { minimum, maximum })}>
        <span>{formatNumber(minimum, precision)}</span><div className="heatmap-swatches">{swatches.map((color, index) => <i key={index} style={{ backgroundColor: color }} />)}{hasZero && <span className="heatmap-zero" style={{ left: `${zeroPosition}%` }}>0</span>}</div><span>{formatNumber(maximum, precision)}</span>
      </div>
    </section>
  );
}
