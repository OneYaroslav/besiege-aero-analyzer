import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  summarizeBladeGroup,
  type BladeGroup,
} from "../../src/session-state.ts";
import { formatNumber, type PrecisionMode, type UiAnalysisBundle } from "../../src/ui-model.ts";

interface BladeGroupsPanelProps {
  readonly bundle: UiAnalysisBundle;
  readonly precision: PrecisionMode;
  readonly groups: readonly BladeGroup[];
  readonly disabledGuids: ReadonlySet<string>;
  readonly selectedGuids: ReadonlySet<string>;
  readonly compact?: boolean;
  readonly onCreate: (name: string) => void;
  readonly onRename: (id: string, name: string) => void;
  readonly onDelete: (id: string) => void;
  readonly onSelect: (guids: ReadonlySet<string>) => void;
  readonly onIsolate?: (guids: ReadonlySet<string>) => void;
  readonly onSetEnabled: (group: BladeGroup, enabled: boolean) => void;
}

const DERIVATIVE_LABELS = {
  "pitch-damping": "Σ dM_pitch/dq",
  "yaw-damping": "Σ dM_yaw/dr",
  "roll-damping": "Σ dM_roll/dp",
  "pitch-alpha": "Σ dM_pitch/dAlpha",
  "yaw-beta": "Σ dM_yaw/dBeta",
} as const;

export function BladeGroupsPanel(props: BladeGroupsPanelProps) {
  const { t } = useTranslation(["whatif", "common"]);
  const [draftName, setDraftName] = useState("");
  const [editingId, setEditingId] = useState<string>();
  const [editingName, setEditingName] = useState("");

  function create(): void {
    if (!draftName.trim() || props.selectedGuids.size === 0) return;
    props.onCreate(draftName);
    setDraftName("");
  }

  return <section className={`blade-groups-panel ${props.compact ? "compact" : ""}`} data-tutorial="blade-groups">
    <div className="panel-title"><span>{t("whatif:groups.title")}</span><small>{t("whatif:groups.subtitle")}</small></div>
    <div className="blade-group-create">
      <input aria-label={t("whatif:groups.newName")} value={draftName} placeholder={t("whatif:groups.name")} onChange={(event) => setDraftName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") create(); }} />
      <button className="secondary-button" disabled={!draftName.trim() || props.selectedGuids.size === 0} onClick={create}>{t("whatif:groups.create", { count: props.selectedGuids.size })}</button>
    </div>
    {props.groups.length === 0 && <p className="empty-note">{t("whatif:groups.empty")}</p>}
    <div className="blade-group-list">{props.groups.map((group) => {
      const summary = summarizeBladeGroup(props.bundle, group, props.disabledGuids);
      return <details key={group.id} className="blade-group-card">
        <summary><span>{group.name}</span><small>{t("whatif:groups.summary", { available: summary.availableBladeCount, requested: summary.requestedBladeCount, state: t(`common:status.${summary.enabledState}` as never) })}</small></summary>
        <div className="blade-group-body">
          {editingId === group.id ? <div className="inline-rename"><input autoFocus value={editingName} onChange={(event) => setEditingName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && editingName.trim()) { props.onRename(group.id, editingName); setEditingId(undefined); } }} /><button onClick={() => { if (editingName.trim()) props.onRename(group.id, editingName); setEditingId(undefined); }}>{t("common:actions.save")}</button><button onClick={() => setEditingId(undefined)}>{t("common:actions.cancel")}</button></div> : null}
          <div className="blade-group-actions">
            <button onClick={() => props.onSelect(new Set(group.bladeGuids))}>{t("common:actions.select")}</button>
            {props.onIsolate && <button onClick={() => props.onIsolate?.(new Set(group.bladeGuids))}>{t("whatif:groups.isolate")}</button>}
            <button onClick={() => props.onSetEnabled(group, summary.enabledState === "disabled")}>{summary.enabledState === "disabled" ? t("whatif:groups.enable") : t("whatif:groups.disable")}</button>
            <button onClick={() => { setEditingId(group.id); setEditingName(group.name); }}>{t("common:actions.rename")}</button>
            <button className="danger-action" onClick={() => props.onDelete(group.id)}>{t("common:actions.delete")}</button>
          </div>
          <dl className="selection-summary">
            <dt>{t("whatif:groups.force")}</dt><dd>{summary.totalForce.map((value) => formatNumber(value, props.precision)).join(" / ")}</dd>
            <dt>{t("whatif:groups.moments")}</dt><dd>{[summary.rollMoment, summary.pitchMoment, summary.yawMoment].map((value) => formatNumber(value, props.precision)).join(" / ")}</dd>
            <dt>{t("whatif:groups.power")}</dt><dd>{formatNumber(summary.bladePower, props.precision)}</dd>
            {Object.entries(DERIVATIVE_LABELS).map(([key, label]) => <Fragment key={key}><dt>{label}</dt><dd>{formatNumber(summary.derivativeContributions[key as keyof typeof DERIVATIVE_LABELS], props.precision)}</dd></Fragment>)}
          </dl>
          {summary.missingBladeGuids.length > 0 && <div className="unit-warning">{t("whatif:groups.missing", { count: summary.missingBladeGuids.length })}</div>}
        </div>
      </details>;
    })}</div>
  </section>;
}
