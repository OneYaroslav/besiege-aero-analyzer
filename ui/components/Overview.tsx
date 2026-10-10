import type { UiAnalysisBundle, PrecisionMode } from "../../src/ui-model.ts";
import { InfoTooltip } from "./InfoTooltip.tsx";
import { Metric, NumberValue, VectorValue } from "./Numbers.tsx";
import { useTranslation } from "react-i18next";

export function MachineSummary({ bundle, precision, label }: { bundle: UiAnalysisBundle; precision: PrecisionMode; label?: string }) {
  const { t } = useTranslation("analysis");
  const { report } = bundle;
  const large = report.availableBlades.filter((blade) => blade.id === 26).length;
  const status = bundle.groupStatus === "HEURISTIC" ? t("status.estimated") : t("components.allBlocks");
  return (
    <section className={`data-panel machine-summary ${label === "A" ? "machine-a-panel" : label === "B" ? "machine-b-panel" : ""}`}>
      <div className="panel-title summary-title">
        <div><span>{label ? `${label} · ` : ""}{report.machine.name}</span><small>{report.machine.source}</small></div>
        <span className={`status-tag ${bundle.groupStatus === "HEURISTIC" ? "heuristic" : "neutral"}`}>{status}</span>
      </div>
      <div className="summary-grid">
        <div><span>{t("summary.blocksSelected")}</span><strong>{report.mass.group.blocks.length} / {report.machine.blocks.length}</strong></div>
        <div><span>{t("components.mass")}</span><NumberValue value={report.mass.totalMass} precision={precision} /></div>
        <div><span>{t("summary.cg")} <InfoTooltip label={t("summary.aboutCg")}>{t("summary.cgHelp")}</InfoTooltip></span><VectorValue value={report.state.centerOfGravity} precision={precision} /></div>
        <div><span>{t("summary.aeroBlades")}</span><strong>{report.availableBlades.length}</strong></div>
        <div><span>{t("summary.enabled")}</span><strong>{report.blades.length} / {report.availableBlades.length}</strong></div>
        <div><span>{t("summary.aeroSurfaces")}</span><strong>{report.buildSurfaces.length} / {report.availableBuildSurfaces.length}</strong></div>
        <div><span>{t("summary.propSmall")}</span><strong>{large} / {report.availableBlades.length - large} · {report.machine.bsgVersion}</strong></div>
      </div>
    </section>
  );
}

export function BaselinePanel({ bundle, precision }: { bundle: UiAnalysisBundle; precision: PrecisionMode }) {
  const { t } = useTranslation("analysis");
  const result = bundle.report.stability.baseline;
  return (
    <section className="data-panel aero-state-panel" data-tutorial="baseline">
      <div className="panel-title"><div><span>{t("baseline.title")}</span><small>{t("baseline.subtitle")}</small></div></div>
      <div className="state-groups">
        <section className="metric-group">
          <div className="subheading">{t("baseline.force")} <small>{t("units.force")}</small></div>
          <Metric label={t("metrics.lateralForce")} technical={t("technical.fx")} value={result.totalForce[0]} units={t("units.force")} precision={precision} help={t("help.fx")} />
          <Metric label={t("metrics.verticalForce")} technical={t("technical.fy")} value={result.totalForce[1]} units={t("units.force")} precision={precision} help={t("help.fy")} />
          <Metric label={t("metrics.longitudinalForce")} technical={t("technical.fz")} value={result.totalForce[2]} units={t("units.force")} precision={precision} help={t("help.fz")} />
        </section>
        <section className="metric-group">
          <div className="subheading">{t("baseline.moment")} <small>{t("units.moment")}</small></div>
          <Metric label={t("metrics.rollMoment")} technical={t("technical.roll")} value={result.moments.roll} units={t("units.moment")} precision={precision} help={t("help.rollMoment")} />
          <Metric label={t("metrics.pitchMoment")} technical={t("technical.pitch")} value={result.moments.pitch} units={t("units.moment")} precision={precision} help={t("help.pitchMoment")} />
          <Metric label={t("metrics.yawMoment")} technical={t("technical.yaw")} value={result.moments.yaw} units={t("units.moment")} precision={precision} help={t("help.yawMoment")} />
        </section>
        <section className="metric-group power-group">
          <div className="subheading">{t("baseline.power")} <small>{t("units.power")}</small></div>
          <Metric label={t("metrics.aeroPower")} technical="Σ F·u" value={result.totalPower} units={t("units.allAeroPoints")} precision={precision} help={t("help.aeroPower")} />
        </section>
      </div>
      <div className="aero-source-breakdown" aria-label={t("sources.title")}>
        <div className="source-head"><strong>{t("sources.title")}</strong><span>{t("baseline.force")} · Fx/Fy/Fz</span><span>{t("baseline.moment")} · R/P/Y</span><span>{t("baseline.power")}</span></div>
        {([
          [t("sources.blades"), result.bladeTotals],
          [t("sources.buildSurfaces"), result.buildSurfaceTotals],
          [t("sources.total"), { force: result.totalForce, moments: result.moments, power: result.totalPower }],
        ] as const).map(([label, totals]) => <div className="source-row" key={label}>
          <strong>{label}</strong>
          <VectorValue value={totals.force} precision={precision} />
          <VectorValue value={[totals.moments.roll, totals.moments.pitch, totals.moments.yaw]} precision={precision} />
          <NumberValue value={totals.power} precision={precision} />
        </div>)}
      </div>
    </section>
  );
}

export function DerivativesPanel({ bundle, precision }: { bundle: UiAnalysisBundle; precision: PrecisionMode }) {
  const { t } = useTranslation("analysis");
  const { derivatives } = bundle.report.stability;
  const steps = bundle.report.stability.steps;
  return (
    <section className="data-panel derivatives-panel" data-tutorial="derivatives">
      <div className="panel-title"><div><span>{t("derivatives.title")}</span><small>{t("derivatives.subtitle")}</small></div></div>
      <div className="derivative-columns">
        <div data-tutorial="static-response">
          <div className="subheading help-heading">{t("derivatives.static")} <InfoTooltip label={t("derivatives.aboutStatic")}>{t("derivatives.staticHelp")}</InfoTooltip><small>{t("derivatives.angleStep", { alpha: steps.alphaDegrees, beta: steps.betaDegrees })}</small></div>
          <Metric label={t("derivatives.pitchAlpha")} technical="dM_pitch / dAlpha" value={derivatives.static.pitchAlpha.derivative} units={t("units.momentPerRadian")} precision={precision} help={t("derivatives.help.pitchAlpha")} />
          <Metric label={t("derivatives.yawBeta")} technical="dM_yaw / dBeta" value={derivatives.static.yawBeta.derivative} units={t("units.momentPerRadian")} precision={precision} help={t("derivatives.help.yawBeta")} />
          <Metric label={t("derivatives.rollBeta")} technical="dM_roll / dBeta" value={derivatives.static.rollBeta.derivative} units={t("units.momentPerRadian")} precision={precision} help={t("derivatives.help.rollBeta")} />
        </div>
        <div data-tutorial="damping-response">
          <div className="subheading help-heading">{t("derivatives.damping")} <InfoTooltip label={t("derivatives.aboutDamping")}>{t("derivatives.dampingHelp")}</InfoTooltip><small>{t("derivatives.rateStep", { step: steps.rateRadPerSecond })}</small></div>
          <Metric label={t("derivatives.rollP")} technical="dM_roll / dp" value={derivatives.damping.rollP.derivative} units={t("units.momentPerRate")} precision={precision} help={t("derivatives.help.rollP")} />
          <Metric label={t("derivatives.pitchQ")} technical="dM_pitch / dq" value={derivatives.damping.pitchQ.derivative} units={t("units.momentPerRate")} precision={precision} help={t("derivatives.help.pitchQ")} />
          <Metric label={t("derivatives.yawR")} technical="dM_yaw / dr" value={derivatives.damping.yawR.derivative} units={t("units.momentPerRate")} precision={precision} help={t("derivatives.help.yawR")} />
        </div>
      </div>
      <details className="cross-details">
        <summary>{t("derivatives.cross")}</summary>
        <div className="cross-grid">
          <Metric label={t("derivatives.pitchR")} technical="dM_pitch/dr" value={derivatives.crossDamping.pitchR.derivative} units={t("units.momentPerRateCompact")} precision={precision} />
          <Metric label={t("derivatives.pitchP")} technical="dM_pitch/dp" value={derivatives.crossDamping.pitchP.derivative} units={t("units.momentPerRateCompact")} precision={precision} />
          <Metric label={t("derivatives.yawQ")} technical="dM_yaw/dq" value={derivatives.crossDamping.yawQ.derivative} units={t("units.momentPerRateCompact")} precision={precision} />
          <Metric label={t("derivatives.yawP")} technical="dM_yaw/dp" value={derivatives.crossDamping.yawP.derivative} units={t("units.momentPerRateCompact")} precision={precision} />
          <Metric label={t("derivatives.rollQ")} technical="dM_roll/dq" value={derivatives.crossDamping.rollQ.derivative} units={t("units.momentPerRateCompact")} precision={precision} />
          <Metric label={t("derivatives.rollR")} technical="dM_roll/dr" value={derivatives.crossDamping.rollR.derivative} units={t("units.momentPerRateCompact")} precision={precision} />
        </div>
      </details>
    </section>
  );
}
