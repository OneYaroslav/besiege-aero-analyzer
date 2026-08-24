import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { extractVanillaBlades, type BsgMachine } from "../../src/bsg.ts";
import type { Vec3 } from "../../src/math.ts";
import { overrideMap, type BladeWhatIfOverride } from "../../src/what-if.ts";
import { formatNumber, type PrecisionMode, type UiAnalysisBundle } from "../../src/ui-model.ts";

type VectorDraft = [string, string, string];

interface WhatIfPanelProps {
  readonly sourceMachine: BsgMachine;
  readonly bundle: UiAnalysisBundle;
  readonly precision: PrecisionMode;
  readonly selectedGuids: ReadonlySet<string>;
  readonly disabledGuids: ReadonlySet<string>;
  readonly overrides: readonly BladeWhatIfOverride[];
  readonly compact?: boolean;
  readonly onSetEnabled: (enabled: boolean) => void;
  readonly onFlip: () => void;
  readonly onApplyTransform: (positionOffset: Vec3, rotationOffsetDegrees: Vec3) => void;
  readonly onResetSelected: () => void;
  readonly onResetAll: () => void;
}

function sameVector(values: readonly Vec3[]): Vec3 | undefined {
  if (values.length === 0) return [0, 0, 0];
  const first = values[0];
  return values.every((value) => value.every((component, index) => Math.abs(component - first[index]) < 1e-12)) ? first : undefined;
}

function draft(vector: Vec3 | undefined): VectorDraft {
  return vector ? [String(vector[0]), String(vector[1]), String(vector[2])] : ["0", "0", "0"];
}

function parseDraft(value: VectorDraft, errorMessage: string): Vec3 {
  const parsed = value.map(Number) as unknown as Vec3;
  if (parsed.some((component) => !Number.isFinite(component))) throw new Error(errorMessage);
  return parsed;
}

export function WhatIfPanel(props: WhatIfPanelProps) {
  const { t } = useTranslation(["whatif", "common"]);
  const selectedKey = [...props.selectedGuids].sort().join("|");
  const active = useMemo(() => overrideMap(props.overrides), [props.overrides]);
  const selectedOverrides = [...props.selectedGuids].map((guid) => active.get(guid));
  const commonPosition = sameVector(selectedOverrides.map((value) => value?.positionOffset ?? [0, 0, 0]));
  const commonRotation = sameVector(selectedOverrides.map((value) => value?.rotationOffsetDegrees ?? [0, 0, 0]));
  const [position, setPosition] = useState<VectorDraft>(() => draft(commonPosition));
  const [rotation, setRotation] = useState<VectorDraft>(() => draft(commonRotation));
  const [error, setError] = useState("");

  useEffect(() => {
    setPosition(draft(commonPosition));
    setRotation(draft(commonRotation));
    setError("");
  }, [selectedKey, props.overrides]);

  const originalByGuid = useMemo(() => new Map(extractVanillaBlades(props.sourceMachine).map((blade) => [blade.guid, blade])), [props.sourceMachine]);
  const modifiedByGuid = useMemo(() => new Map(props.bundle.report.availableBlades.map((blade) => [blade.guid, blade])), [props.bundle]);
  const selected = [...props.selectedGuids].filter((guid) => originalByGuid.has(guid));
  const modifiedCount = selected.filter((guid) => active.has(guid)).length;
  const disabledCount = selected.filter((guid) => props.disabledGuids.has(guid)).length;
  const singleOriginal = selected.length === 1 ? originalByGuid.get(selected[0]) : undefined;
  const singleModified = selected.length === 1 ? modifiedByGuid.get(selected[0]) : undefined;

  function changeVector(setter: (value: VectorDraft) => void, current: VectorDraft, index: number, value: string): void {
    const next = [...current] as VectorDraft;
    next[index] = value;
    setter(next);
  }

  function apply(): void {
    try {
      props.onApplyTransform(
        parseDraft(position, t("whatif:finiteError", { label: t("whatif:positionOffset") })),
        parseDraft(rotation, t("whatif:finiteError", { label: t("whatif:rotationOffset") })),
      );
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return <section className={`what-if-panel ${props.compact ? "compact" : ""}`} data-tutorial="what-if">
    <div className="panel-title"><span>{t("whatif:title")}</span><small>{t("whatif:subtitle")}</small></div>
    <div className="what-if-status"><strong>{t("whatif:selected", { count: selected.length })}</strong><small>{t("whatif:modifiedStatus", { modified: modifiedCount, disabled: disabledCount })}</small></div>
    <div className="what-if-actions"><button disabled={selected.length === 0} onClick={() => props.onSetEnabled(true)}>{t("common:actions.enable")}</button><button disabled={selected.length === 0} onClick={() => props.onSetEnabled(false)}>{t("common:actions.disable")}</button><button disabled={selected.length === 0} onClick={props.onFlip}>{t("whatif:flip")}</button></div>
    <div className="what-if-space">{t("whatif:space")}: <strong>{t("whatif:aircraftAxes")}</strong></div>
    <fieldset className="what-if-vector"><legend>{t("whatif:positionLegend")}</legend>{([t("whatif:dx"), t("whatif:dy"), t("whatif:dz")] as const).map((label, index) => <label key={label}>{label}<input aria-label={t("whatif:inputAria", { label })} type="number" step="any" value={position[index]} onChange={(event) => changeVector(setPosition, position, index, event.target.value)} /></label>)}{commonPosition === undefined && <small>{t("whatif:mixedPosition")}</small>}</fieldset>
    <fieldset className="what-if-vector"><legend>{t("whatif:rotationLegend")}</legend>{([t("whatif:pitchX"), t("whatif:yawY"), t("whatif:rollZ")] as const).map((label, index) => <label key={label}>{label}<input aria-label={t("whatif:inputAria", { label })} type="number" step="any" value={rotation[index]} onChange={(event) => changeVector(setRotation, rotation, index, event.target.value)} /></label>)}{commonRotation === undefined && <small>{t("whatif:mixedRotation")}</small>}</fieldset>
    {singleOriginal && singleModified && <dl className="what-if-before-after"><dt>{t("whatif:originalPosition")}</dt><dd>{singleOriginal.position.map((value) => formatNumber(value, props.precision)).join(" / ")}</dd><dt>{t("whatif:modifiedPosition")}</dt><dd>{singleModified.position.map((value) => formatNumber(value, props.precision)).join(" / ")}</dd><dt>{t("whatif:flipBeforeAfter")}</dt><dd>{t(`whatif:${singleOriginal.flipped ? "true" : "false"}`)} → {t(`whatif:${singleModified.flipped ? "true" : "false"}`)}</dd><dt>{t("whatif:modifiedQuaternion")}</dt><dd>{[singleModified.rotation.x, singleModified.rotation.y, singleModified.rotation.z, singleModified.rotation.w].map((value) => formatNumber(value, props.precision)).join(" / ")}</dd></dl>}
    {error && <div className="unit-warning">{error}</div>}
    <div className="what-if-footer"><button className="primary-button" disabled={selected.length === 0} onClick={apply}>{t("whatif:applyTransform")}</button><button disabled={selected.length === 0} onClick={props.onResetSelected}>{t("whatif:resetSelected")}</button><button className="danger-action" disabled={props.overrides.length === 0 && props.disabledGuids.size === 0} onClick={props.onResetAll}>{t("whatif:resetAll")}</button></div>
  </section>;
}
