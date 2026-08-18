import { formatNumber, type PrecisionMode, type UiAnalysisBundle, type UiGroupSelection } from "../../src/ui-model.ts";
import { InfoTooltip } from "./InfoTooltip.tsx";

export function ComponentsView({ bundle, precision, onSelect }: { bundle: UiAnalysisBundle; precision: PrecisionMode; onSelect: (selection: UiGroupSelection) => void }) {
  return (
    <div className="components-grid">
      <section className="data-panel component-card all-card">
        <div className="panel-title"><span>ALL MACHINE BLOCKS</span><span className="status-tag neutral">ALL BLOCKS</span></div>
        <strong>{bundle.report.machine.blocks.length} blocks</strong>
        <p>No physical-component assumption. May combine disconnected assemblies.</p>
        <button className="secondary-button" onClick={() => onSelect({ kind: "all" })}>Analyze all</button>
      </section>
      {bundle.discovery.components.map((component) => (
        <section className="data-panel component-card" key={component.index}>
          <div className="panel-title"><span>COMPONENT {component.index} <InfoTooltip label="About estimated components">Spatially inferred component. This is not a verified Besiege runtime joint graph.</InfoTooltip></span><span className="status-tag heuristic">Estimated</span></div>
          <div className="component-metrics">
            <div><span>Blocks</span><strong>{component.blockCount}</strong></div>
            <div><span>Blades</span><strong>{component.bladeCount}</strong></div>
            <div><span>Mass</span><strong>{component.mass === null ? "N/A" : formatNumber(component.mass, precision)}</strong></div>
            <div><span>Approx. CG</span><strong>{component.centerOfGravity ? component.centerOfGravity.map((value) => formatNumber(value, precision)).join(" / ") : "N/A"}</strong></div>
          </div>
          <p>Distance to blade centroid: {formatNumber(component.distanceToBladeCentroid, precision)} game units.</p>
          <button className="secondary-button" onClick={() => onSelect(component.suggestedAircraft ? { kind: "aircraft" } : { kind: "component", index: component.index })}>
            {component.suggestedAircraft ? "Use aircraft heuristic" : "Analyze component"}
          </button>
        </section>
      ))}
    </div>
  );
}
