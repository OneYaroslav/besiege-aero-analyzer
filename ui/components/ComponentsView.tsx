import { formatNumber, type PrecisionMode, type UiAnalysisBundle, type UiGroupSelection } from "../../src/ui-model.ts";
import { InfoTooltip } from "./InfoTooltip.tsx";
import { useTranslation } from "react-i18next";

export function ComponentsView({ bundle, precision, onSelect }: { bundle: UiAnalysisBundle; precision: PrecisionMode; onSelect: (selection: UiGroupSelection) => void }) {
  const { t } = useTranslation("analysis");
  return (
    <div className="components-grid" data-tutorial="components">
      <section className="data-panel component-card all-card">
        <div className="panel-title"><span>{t("components.allMachine")}</span><span className="status-tag neutral">{t("components.allBlocks")}</span></div>
        <strong>{t("components.blockCount", { count: bundle.report.machine.blocks.length })}</strong>
        <p>{t("components.allDescription")}</p>
        <button className="secondary-button" onClick={() => onSelect({ kind: "all" })}>{t("components.analyzeAll")}</button>
      </section>
      {bundle.discovery.components.map((component) => (
        <section className="data-panel component-card" key={component.index}>
          <div className="panel-title"><span>{t("components.component", { index: component.index })} <InfoTooltip label={t("components.aboutEstimated")}>{t("components.estimatedHelp")}</InfoTooltip></span><span className="status-tag heuristic">{t("status.estimated")}</span></div>
          <div className="component-metrics">
            <div><span>{t("components.blocks")}</span><strong>{component.blockCount}</strong></div>
            <div><span>{t("components.blades")}</span><strong>{component.bladeCount}</strong></div>
            <div><span>{t("components.mass")}</span><strong>{component.mass === null ? t("status.notAvailable") : formatNumber(component.mass, precision)}</strong></div>
            <div><span>{t("components.approxCg")}</span><strong>{component.centerOfGravity ? component.centerOfGravity.map((value) => formatNumber(value, precision)).join(" / ") : t("status.notAvailable")}</strong></div>
          </div>
          <p>{t("components.distance", { value: formatNumber(component.distanceToBladeCentroid, precision) })}</p>
          <button className="secondary-button" onClick={() => onSelect(component.suggestedAircraft ? { kind: "aircraft" } : { kind: "component", index: component.index })}>
            {component.suggestedAircraft ? t("components.useHeuristic") : t("components.analyzeComponent")}
          </button>
        </section>
      ))}
    </div>
  );
}
