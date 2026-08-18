import type { UiAnalysisBundle, PrecisionMode } from "../../src/ui-model.ts";
import { InfoTooltip } from "./InfoTooltip.tsx";
import { Metric, NumberValue, VectorValue } from "./Numbers.tsx";

export function MachineSummary({ bundle, precision, label }: { bundle: UiAnalysisBundle; precision: PrecisionMode; label?: string }) {
  const { report } = bundle;
  const large = report.availableBlades.filter((blade) => blade.id === 26).length;
  const status = bundle.groupStatus === "HEURISTIC" ? "Estimated" : "All blocks";
  return (
    <section className={`data-panel machine-summary ${label === "A" ? "machine-a-panel" : label === "B" ? "machine-b-panel" : ""}`}>
      <div className="panel-title summary-title">
        <div><span>{label ? `${label} · ` : ""}{report.machine.name}</span><small>{report.machine.source}</small></div>
        <span className={`status-tag ${bundle.groupStatus === "HEURISTIC" ? "heuristic" : "neutral"}`}>{status}</span>
      </div>
      <div className="summary-grid">
        <div><span>Blocks selected</span><strong>{report.mass.group.blocks.length} / {report.machine.blocks.length}</strong></div>
        <div><span>Mass</span><NumberValue value={report.mass.totalMass} precision={precision} /></div>
        <div><span>CG X/Y/Z <InfoTooltip label="About center of gravity">Mass-weighted center of gravity in the machine-local +X right, +Y up, +Z forward frame. It is approximate where runtime Rigidbody COM is unavailable.</InfoTooltip></span><VectorValue value={report.state.centerOfGravity} precision={precision} /></div>
        <div><span>Aerodynamic blades</span><strong>{report.availableBlades.length}</strong></div>
        <div><span>Enabled</span><strong>{report.blades.length} / {report.availableBlades.length}</strong></div>
        <div><span>Prop / Small · BSG</span><strong>{large} / {report.availableBlades.length - large} · {report.machine.bsgVersion}</strong></div>
      </div>
    </section>
  );
}

export function BaselinePanel({ bundle, precision }: { bundle: UiAnalysisBundle; precision: PrecisionMode }) {
  const result = bundle.report.stability.baseline;
  return (
    <section className="data-panel aero-state-panel">
      <div className="panel-title"><div><span>CURRENT AERODYNAMIC STATE</span><small>machine-local axes · enabled blades only</small></div></div>
      <div className="state-groups">
        <section className="metric-group">
          <div className="subheading">FORCE <small>game force units</small></div>
          <Metric label="Lateral force" technical="Fx · +X right" value={result.totalForce[0]} units="game force units" precision={precision} help="Fx is the total aerodynamic force along machine-right +X." />
          <Metric label="Vertical force" technical="Fy · +Y up" value={result.totalForce[1]} units="game force units" precision={precision} help="Fy is the total aerodynamic force along machine-up +Y." />
          <Metric label="Longitudinal force" technical="Fz · +Z forward" value={result.totalForce[2]} units="game force units" precision={precision} help="Fz is the total aerodynamic force along machine-forward +Z." />
        </section>
        <section className="metric-group">
          <div className="subheading">MOMENT <small>game moment units</small></div>
          <Metric label="Roll moment" technical="M_roll · about +Z" value={result.moments.roll} units="game moment units" precision={precision} help="Total aerodynamic moment projected onto the forward +Z roll axis, measured about the selected CG." />
          <Metric label="Pitch moment" technical="M_pitch · about +X" value={result.moments.pitch} units="game moment units" precision={precision} help="Total aerodynamic moment projected onto the right +X pitch axis, measured about the selected CG." />
          <Metric label="Yaw moment" technical="M_yaw · about +Y" value={result.moments.yaw} units="game moment units" precision={precision} help="Total aerodynamic moment projected onto the up +Y yaw axis, measured about the selected CG." />
        </section>
        <section className="metric-group power-group">
          <div className="subheading">POWER <small>game power units</small></div>
          <Metric label="Blade power" technical="Σ F·v" value={result.totalBladePower} units="sum over enabled blades" precision={precision} help="Sum of each blade force dotted with that blade's local velocity. It is reported in game power units; no SI conversion is available." />
        </section>
      </div>
    </section>
  );
}

export function DerivativesPanel({ bundle, precision }: { bundle: UiAnalysisBundle; precision: PrecisionMode }) {
  const { derivatives } = bundle.report.stability;
  const steps = bundle.report.stability.steps;
  return (
    <section className="data-panel derivatives-panel">
      <div className="panel-title"><div><span>STABILITY & DAMPING RESPONSE</span><small>central finite difference · raw derivatives · no qualitative rating</small></div></div>
      <div className="derivative-columns">
        <div>
          <div className="subheading help-heading">STATIC RESPONSE <InfoTooltip label="About static response">Moment response to small changes in angle of attack α or sideslip β around the current operating point. Values are raw slopes, not a Stable/Unstable classification.</InfoTooltip><small>step α/β = {steps.alphaDegrees}° / {steps.betaDegrees}°</small></div>
          <Metric label="Pitch response to angle of attack" technical="dM_pitch / dAlpha" value={derivatives.static.pitchAlpha.derivative} units="moment / radian" precision={precision} help="Change in pitch moment per radian of angle-of-attack change around the operating point." />
          <Metric label="Yaw response to sideslip" technical="dM_yaw / dBeta" value={derivatives.static.yawBeta.derivative} units="moment / radian" precision={precision} help="Change in yaw moment per radian of sideslip change around the operating point." />
          <Metric label="Roll response to sideslip" technical="dM_roll / dBeta" value={derivatives.static.rollBeta.derivative} units="moment / radian" precision={precision} help="Change in roll moment per radian of sideslip change around the operating point." />
        </div>
        <div>
          <div className="subheading help-heading">DAMPING RESPONSE <InfoTooltip label="About damping response">Moment response to small angular-rate changes. The displayed slope comes directly from the recovered blade model; no Strong/Weak rating is inferred.</InfoTooltip><small>step = {steps.rateRadPerSecond} rad/s</small></div>
          <Metric label="Roll damping derivative" technical="dM_roll / dp" value={derivatives.damping.rollP.derivative} units="moment / (rad/s)" precision={precision} help="Change in roll moment as roll rate p changes around the operating point." />
          <Metric label="Pitch damping derivative" technical="dM_pitch / dq" value={derivatives.damping.pitchQ.derivative} units="moment / (rad/s)" precision={precision} help="Change in pitch moment as pitch rate q changes around the operating point." />
          <Metric label="Yaw damping derivative" technical="dM_yaw / dr" value={derivatives.damping.yawR.derivative} units="moment / (rad/s)" precision={precision} help="Change in yaw moment as yaw rate r changes around the operating point." />
        </div>
      </div>
      <details className="cross-details">
        <summary>Cross-rate derivatives</summary>
        <div className="cross-grid">
          <Metric label="Pitch vs yaw rate" technical="dM_pitch/dr" value={derivatives.crossDamping.pitchR.derivative} units="moment/(rad/s)" precision={precision} />
          <Metric label="Pitch vs roll rate" technical="dM_pitch/dp" value={derivatives.crossDamping.pitchP.derivative} units="moment/(rad/s)" precision={precision} />
          <Metric label="Yaw vs pitch rate" technical="dM_yaw/dq" value={derivatives.crossDamping.yawQ.derivative} units="moment/(rad/s)" precision={precision} />
          <Metric label="Yaw vs roll rate" technical="dM_yaw/dp" value={derivatives.crossDamping.yawP.derivative} units="moment/(rad/s)" precision={precision} />
          <Metric label="Roll vs pitch rate" technical="dM_roll/dq" value={derivatives.crossDamping.rollQ.derivative} units="moment/(rad/s)" precision={precision} />
          <Metric label="Roll vs yaw rate" technical="dM_roll/dr" value={derivatives.crossDamping.rollR.derivative} units="moment/(rad/s)" precision={precision} />
        </div>
      </details>
    </section>
  );
}
