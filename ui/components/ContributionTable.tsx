import { formatNumber, type PrecisionMode, type UiAnalysisBundle } from "../../src/ui-model.ts";
import { InfoTooltip } from "./InfoTooltip.tsx";
import { useTranslation } from "react-i18next";

export function ContributionTable({ bundle, precision, onFocus, tone = "A" }: { bundle: UiAnalysisBundle; precision: PrecisionMode; onFocus: (guid: string) => void; tone?: "A" | "B" }) {
  const { t } = useTranslation("analysis");
  const result = bundle.contribution;
  return (
    <section className={`data-panel table-panel contribution-table-panel machine-${tone.toLowerCase()}-contribution`}>
      <div className="table-toolbar">
        <div><span className="panel-kicker">{t("contributionTable.title")} <InfoTooltip label={t("contributionTable.about")}>{t("contributionTable.help")}</InfoTooltip></span><strong>{result.derivative}</strong></div>
        <div className="toolbar-metric"><span>{t("contributionTable.total")}</span><strong title={String(result.totalDerivative)}>{formatNumber(result.totalDerivative, precision)}</strong><small>{result.units}</small></div>
        <div className="toolbar-metric"><span>{t("contributionTable.sum")}</span><strong>{formatNumber(result.contributionSum, precision)}</strong></div>
      </div>
      <div className="table-scroll">
        <table className="engineering-table">
          <thead><tr><th>{t("contributionTable.rank")}</th><th>{t("contributionTable.bladeGuid")}</th><th>{t("blades.type")}</th><th>{t("contributionTable.position")}</th><th><span className="table-help">{t("blades.flipped")} <InfoTooltip label={t("contributionTable.aboutFlipped")}>{t("contributionTable.flippedHelp")}</InfoTooltip></span></th><th>{t("contributionTable.derivative")}</th><th>{t("contributionTable.absolute")}</th><th><span className="table-help">{t("contributionTable.percent")} <InfoTooltip label={t("contributionTable.aboutPercent")}>{t("contributionTable.percentHelp")}</InfoTooltip></span></th></tr></thead>
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
