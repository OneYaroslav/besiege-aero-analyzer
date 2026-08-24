import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { snapshotChanges, type AnalysisSessionState, type AnalysisSnapshot } from "../../src/session-state.ts";
import { assembleComparisonRows, formatNumber, type PrecisionMode, type UiAnalysisBundle } from "../../src/ui-model.ts";

export interface ResolvedSnapshotSource {
  readonly label: string;
  readonly state: AnalysisSessionState;
  readonly bundle?: UiAnalysisBundle;
  readonly warnings: readonly string[];
}

interface SnapshotsPanelProps {
  readonly snapshots: readonly AnalysisSnapshot[];
  readonly currentState: AnalysisSessionState;
  readonly precision: PrecisionMode;
  readonly onSave: (name: string, note: string) => void;
  readonly onRestore: (snapshot: AnalysisSnapshot) => void;
  readonly onDuplicate: (snapshot: AnalysisSnapshot) => void;
  readonly onRename: (id: string, name: string) => void;
  readonly onDelete: (id: string) => void;
  readonly resolveSource: (id: "current" | string) => ResolvedSnapshotSource;
  readonly tutorialDefaultName?: string;
  readonly tutorialCompareSnapshotId?: string;
}

export function SnapshotsPanel(props: SnapshotsPanelProps) {
  const { t, i18n } = useTranslation(["snapshots", "common"]);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [editingId, setEditingId] = useState<string>();
  const [editingName, setEditingName] = useState("");
  const [firstSource, setFirstSource] = useState<"current" | string>("current");
  const [secondSource, setSecondSource] = useState<"current" | string>("");
  const first = useMemo(() => props.resolveSource(firstSource), [props.resolveSource, firstSource]);
  const second = useMemo(() => secondSource ? props.resolveSource(secondSource) : undefined, [props.resolveSource, secondSource]);
  const rows = first.bundle && second?.bundle ? assembleComparisonRows(first.bundle, second.bundle) : [];
  const changes = second ? snapshotChanges(first.state, second.state) : [];
  const localizeChange = (change: string): string => {
    const operating = change.match(/^(speed|alphaDegrees|betaDegrees|p|q|r): (.+)$/);
    if (operating) return t("snapshots:change.operating", { field: t(`snapshots:fields.${operating[1]}` as never), values: operating[2] });
    const mode = change.match(/^mode: (.+)$/);
    if (mode) return t("snapshots:change.mode", { values: mode[1] });
    const activeMachine = change.match(/^active machine: (.+)$/);
    if (activeMachine) return t("snapshots:change.activeMachine", { values: activeMachine[1] });
    const availability = change.match(/^machine ([AB]): (.+)$/);
    if (availability) return t("snapshots:change.machineAvailability", { key: availability[1], values: availability[2].replaceAll("missing", t("snapshots:change.missing")) });
    const machine = change.match(/^machine ([AB]) (AnalysisGroup changed|blades: (.+)|Blade Groups changed|What-if transforms\/flips changed)$/);
    if (machine) return t(`snapshots:change.${machine[2].startsWith("blades:") ? "blades" : machine[2] === "AnalysisGroup changed" ? "group" : machine[2] === "Blade Groups changed" ? "groups" : "whatIf"}` as never, { key: machine[1], values: machine[3] ?? "" });
    if (change === "Plot Lab settings changed") return t("snapshots:change.plotLab");
    if (change === "Delta display settings changed") return t("snapshots:change.delta");
    return change;
  };

  useEffect(() => {
    if (props.tutorialDefaultName && name.trim() === "") setName(props.tutorialDefaultName);
  }, [props.tutorialDefaultName, name]);

  useEffect(() => {
    if (!props.tutorialCompareSnapshotId) return;
    setFirstSource(props.tutorialCompareSnapshotId);
    setSecondSource("current");
  }, [props.tutorialCompareSnapshotId]);

  function save(): void {
    if (!name.trim()) return;
    props.onSave(name, note);
    setName("");
    setNote("");
  }

  const display = (value: number | readonly [number, number, number]) => typeof value === "number"
    ? formatNumber(value, props.precision)
    : value.map((item) => formatNumber(item, props.precision)).join(" / ");
  const delta = (a: number | readonly [number, number, number], b: number | readonly [number, number, number]) => {
    if (typeof a === "number" && typeof b === "number") return formatNumber(b - a, props.precision);
    if (typeof a !== "number" && typeof b !== "number") return b.map((value, index) => formatNumber(value - a[index], props.precision)).join(" / ");
    return "—";
  };

  return <div className="snapshot-page view-stack">
    <section className="data-panel snapshot-save-panel" data-tutorial="snapshot-save">
      <div className="panel-title"><span>{t("snapshots:title")}</span><small>{t("snapshots:subtitle")}</small></div>
      <div className="snapshot-save-form"><input aria-label={t("snapshots:name")} placeholder={t("snapshots:name")} value={name} onChange={(event) => setName(event.target.value)} /><input aria-label={t("snapshots:note")} placeholder={t("snapshots:optionalNote")} value={note} onChange={(event) => setNote(event.target.value)} /><button className="primary-button" disabled={!name.trim()} onClick={save}>{t("snapshots:save")}</button></div>
    </section>
    <section className="data-panel snapshot-list-panel">
      {props.snapshots.length === 0 ? <p className="empty-note">{t("snapshots:empty")}</p> : <div className="snapshot-list">{props.snapshots.map((snapshot) => <article key={snapshot.id} className="snapshot-card">
        <div>{editingId === snapshot.id ? <div className="inline-rename"><input autoFocus value={editingName} onChange={(event) => setEditingName(event.target.value)} /><button onClick={() => { if (editingName.trim()) props.onRename(snapshot.id, editingName); setEditingId(undefined); }}>{t("common:actions.save")}</button><button onClick={() => setEditingId(undefined)}>{t("common:actions.cancel")}</button></div> : <><strong>{snapshot.name}</strong><small>{new Date(snapshot.createdAt).toLocaleString(i18n.resolvedLanguage === "ru" ? "ru-RU" : "en-US")}</small></>}<p>{snapshot.note || t("snapshots:noNote")}</p></div>
        <div className="snapshot-actions"><button onClick={() => props.onRestore(snapshot)}>{t("snapshots:restore")}</button><button onClick={() => props.onDuplicate(snapshot)}>{t("common:actions.duplicate")}</button><button onClick={() => { setEditingId(snapshot.id); setEditingName(snapshot.name); }}>{t("common:actions.rename")}</button><button className="danger-action" onClick={() => props.onDelete(snapshot.id)}>{t("common:actions.delete")}</button></div>
      </article>)}</div>}
    </section>
    <section className="data-panel snapshot-compare-panel" data-tutorial="snapshot-compare">
      <div className="panel-title"><span>{t("snapshots:compare")}</span><small>{t("snapshots:deltaRule")}</small></div>
      <div className="snapshot-source-selectors"><label>{t("snapshots:first")}<select value={firstSource} onChange={(event) => setFirstSource(event.target.value)}><option value="current">{t("snapshots:current")}</option>{props.snapshots.map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{snapshot.name}</option>)}</select></label><label>{t("snapshots:second")}<select value={secondSource} onChange={(event) => setSecondSource(event.target.value)}><option value="">{t("snapshots:select")}</option><option value="current">{t("snapshots:current")}</option>{props.snapshots.map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{snapshot.name}</option>)}</select></label></div>
      {[...first.warnings, ...(second?.warnings ?? [])].map((warning) => <div className="unit-warning" key={warning}>{warning}</div>)}
      {second && rows.length > 0 && <div className="table-scroll"><table className="engineering-table comparison-table"><thead><tr><th>{t("snapshots:quantity")}</th><th>{t("snapshots:units")}</th><th>{first.label}</th><th>{second.label}</th><th>{t("snapshots:deltaColumn")}</th></tr></thead><tbody>{rows.map((row) => <tr key={row.key}><th>{row.label}</th><td>{row.units}</td><td>{display(row.first)}</td><td>{display(row.second)}</td><td className="delta-cell">{delta(row.first, row.second)}</td></tr>)}</tbody></table></div>}
      {second && <div className="snapshot-change-list"><strong>{t("snapshots:changes")}</strong>{changes.length > 0 ? <ul>{changes.map((change) => <li key={change}>{localizeChange(change)}</li>)}</ul> : <p>{t("snapshots:noChanges")}</p>}</div>}
      {second && rows.length === 0 && <p className="empty-note">{t("snapshots:sourceMissing")}</p>}
    </section>
  </div>;
}
