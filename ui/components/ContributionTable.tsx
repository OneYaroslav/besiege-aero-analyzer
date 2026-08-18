import { formatNumber, type PrecisionMode, type UiAnalysisBundle } from "../../src/ui-model.ts";
import { InfoTooltip } from "./InfoTooltip.tsx";

export function ContributionTable({ bundle, precision, onFocus, tone = "A" }: { bundle: UiAnalysisBundle; precision: PrecisionMode; onFocus: (guid: string) => void; tone?: "A" | "B" }) {
  const result = bundle.contribution;
  return (
    <section className={`data-panel table-panel contribution-table-panel machine-${tone.toLowerCase()}-contribution`}>
      <div className="table-toolbar">
        <div><span className="panel-kicker">PER-BLADE CENTRAL DIFFERENCE <InfoTooltip label="About blade contribution">Each row uses the same central finite difference as the total derivative, but isolates one aerodynamic blade's moment contribution.</InfoTooltip></span><strong>{result.derivative}</strong></div>
        <div className="toolbar-metric"><span>Total</span><strong title={String(result.totalDerivative)}>{formatNumber(result.totalDerivative, precision)}</strong><small>{result.units}</small></div>
        <div className="toolbar-metric"><span>Contribution sum</span><strong>{formatNumber(result.contributionSum, precision)}</strong></div>
      </div>
      <div className="table-scroll">
        <table className="engineering-table">
          <thead><tr><th>Rank</th><th>Blade GUID</th><th>Type</th><th>Position X/Y/Z</th><th><span className="table-help">Flipped <InfoTooltip label="About flipped blades">Stored blade orientation flag used by the recovered blade model.</InfoTooltip></span></th><th>Derivative</th><th>Absolute</th><th><span className="table-help">% total <InfoTooltip label="About percentage of total">Signed blade contribution divided by the total derivative. Cancellation can produce negative values or magnitudes above 100%.</InfoTooltip></span></th></tr></thead>
          <tbody>{result.blades.map((entry, index) => (
            <tr key={entry.guid} onClick={() => onFocus(entry.guid)}>
              <td>{index + 1}</td><td><span className="guid-text" title={entry.guid}>{entry.guid}</span></td><td>{entry.type}</td>
              <td>{entry.position.map((value) => formatNumber(value, precision)).join(" / ")}</td><td>{String(entry.flipped)}</td>
              <td>{formatNumber(entry.derivativeContribution, precision)}</td><td>{formatNumber(entry.absoluteContribution, precision)}</td>
              <td>{entry.percentageOfTotal === null ? "—" : <div className="contribution-share" title={`${entry.percentageOfTotal}%`}><span className="contribution-bar"><i style={{ width: `${Math.min(100, Math.abs(entry.percentageOfTotal))}%` }} /></span><strong>{formatNumber(entry.percentageOfTotal, precision)}%</strong></div>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}
