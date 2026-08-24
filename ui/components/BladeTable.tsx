import { useMemo, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { buildBladeRows, formatNumber, type PrecisionMode, type UiAnalysisBundle } from "../../src/ui-model.ts";
import { updateBladeSelection } from "../../src/inspector.ts";
import { InfoTooltip } from "./InfoTooltip.tsx";

type SortKey = "index" | "type" | "guid" | "x" | "y" | "z" | "flipped" | "fx" | "fy" | "fz" | "roll" | "pitch" | "yaw" | "power";

interface BladeTableProps {
  readonly bundle: UiAnalysisBundle;
  readonly precision: PrecisionMode;
  readonly selectedGuids: ReadonlySet<string>;
  readonly focusedGuid?: string;
  readonly onSelectionChange: (guids: Set<string>) => void;
  readonly onFocus: (guid: string | undefined) => void;
  readonly onEnabledChange: (guid: string, enabled: boolean) => void;
  readonly onEnableAll: () => void;
  readonly onDisableSelected: () => void;
  readonly onReset: () => void;
}

export function BladeTable(props: BladeTableProps) {
  const { t } = useTranslation(["analysis", "common"]);
  const rows = useMemo(() => buildBladeRows(props.bundle), [props.bundle]);
  const modifiedGuids = useMemo(() => new Set(props.bundle.whatIfOverrides.map((override) => override.guid)), [props.bundle.whatIfOverrides]);
  const [typeFilter, setTypeFilter] = useState("all");
  const [flippedFilter, setFlippedFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; direction: 1 | -1 }>({ key: "index", direction: 1 });

  const sorted = useMemo(() => {
    const value = (row: (typeof rows)[number], key: SortKey): string | number | boolean => {
      if (key === "index") return row.index;
      if (key === "type") return row.blade.kind;
      if (key === "guid") return row.blade.guid;
      if (key === "x") return row.blade.position[0];
      if (key === "y") return row.blade.position[1];
      if (key === "z") return row.blade.position[2];
      if (key === "flipped") return row.blade.flipped;
      if (key === "fx") return row.force[0];
      if (key === "fy") return row.force[1];
      if (key === "fz") return row.force[2];
      if (key === "roll") return row.rollMoment;
      if (key === "pitch") return row.pitchMoment;
      if (key === "yaw") return row.yawMoment;
      return row.power;
    };
    return rows
      .filter((row) => !search.trim() || row.blade.guid.toLowerCase().includes(search.trim().toLowerCase()) || row.blade.kind.toLowerCase().includes(search.trim().toLowerCase()))
      .filter((row) => typeFilter === "all" || row.blade.kind === typeFilter)
      .filter((row) => stateFilter === "all" || row.enabled === (stateFilter === "enabled"))
      .filter((row) => flippedFilter === "all" || row.blade.flipped === (flippedFilter === "true"))
      .slice()
      .sort((a, b) => {
        const av = value(a, sort.key);
        const bv = value(b, sort.key);
        if (typeof av === "number" && typeof bv === "number") return (av - bv) * sort.direction;
        return String(av).localeCompare(String(bv)) * sort.direction;
      });
  }, [rows, search, typeFilter, stateFilter, flippedFilter, sort]);

  function header(key: SortKey, label: string) {
    return (
      <button className="table-sort" onClick={() => setSort((current) => ({ key, direction: current.key === key ? (current.direction * -1) as 1 | -1 : 1 }))}>
        {label}{sort.key === key ? (sort.direction === 1 ? " ↑" : " ↓") : ""}
      </button>
    );
  }

  function select(guid: string, checked: boolean) {
    const next = new Set(props.selectedGuids);
    if (checked) next.add(guid); else next.delete(guid);
    props.onSelectionChange(next);
  }

  function selectRow(guid: string, event: MouseEvent<HTMLTableRowElement>) {
    const modifier = event.ctrlKey || event.metaKey ? "toggle" : event.shiftKey ? "add" : "replace";
    const next = updateBladeSelection(props.selectedGuids, guid, modifier);
    props.onSelectionChange(next);
    props.onFocus(next.has(guid) ? guid : undefined);
  }

  return (
    <section className="data-panel table-panel">
      <div className="table-toolbar">
        <div>
          <span className="panel-kicker">{t("analysis:blades.title")}</span>
          <strong>{t("analysis:blades.counts", { enabled: props.bundle.report.blades.length, available: props.bundle.report.availableBlades.length })}</strong>
        </div>
        <label className="search-field"><span className="sr-only">{t("analysis:blades.search")}</span><input type="search" placeholder={t("analysis:blades.searchPlaceholder")} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <label>{t("analysis:blades.type")}<select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">{t("analysis:blades.all")}</option><option value="Propeller">Propeller</option><option value="SmallPropeller">SmallPropeller</option></select></label>
        <label>{t("analysis:blades.state")}<select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}><option value="all">{t("analysis:blades.all")}</option><option value="enabled">{t("common:status.enabled")}</option><option value="disabled">{t("common:status.disabled")}</option></select></label>
        <label>{t("analysis:blades.flipped")}<select value={flippedFilter} onChange={(event) => setFlippedFilter(event.target.value)}><option value="all">{t("analysis:blades.all")}</option><option value="true">{t("analysis:blades.true")}</option><option value="false">{t("analysis:blades.false")}</option></select></label>
        <button className="secondary-button" onClick={props.onEnableAll}>{t("analysis:blades.enableAll")}</button>
        <button className="secondary-button" disabled={props.selectedGuids.size === 0} onClick={props.onDisableSelected}>{t("analysis:blades.disableSelected", { count: props.selectedGuids.size })}</button>
        <button className="ghost-button" onClick={props.onReset}>{t("common:actions.reset")}</button>
      </div>
      <div className="table-scroll">
        <table className="engineering-table blade-table">
          <thead><tr>
            <th>{t("analysis:blades.selectedShort")}</th><th>{t("analysis:blades.enabled")}</th><th>{header("index", "#")}</th><th>{header("type", t("analysis:blades.type"))}</th><th>{header("guid", "GUID")}</th>
            <th>{header("x", "X")}</th><th>{header("y", "Y")}</th><th>{header("z", "Z")}</th><th><span className="table-help">{header("flipped", "Flip")}<InfoTooltip label={t("analysis:blades.aboutFlipped")}>{t("analysis:blades.flippedHelp")}</InfoTooltip></span></th><th>What-if</th>
            <th>{header("fx", "Fx")}</th><th>{header("fy", "Fy")}</th><th>{header("fz", "Fz")}</th>
            <th>{header("roll", "M roll")}</th><th>{header("pitch", "M pitch")}</th><th>{header("yaw", "M yaw")}</th><th>{header("power", "F·v")}</th>
          </tr></thead>
          <tbody>{sorted.map((row) => (
            <tr key={row.blade.guid} className={`${row.enabled ? "" : "disabled-row"} ${props.focusedGuid === row.blade.guid ? "focused-row" : ""} ${props.selectedGuids.has(row.blade.guid) ? "selected-row" : ""} ${modifiedGuids.has(row.blade.guid) ? "what-if-row" : ""}`} onClick={(event) => selectRow(row.blade.guid, event)}>
              <td><input aria-label={t("analysis:blades.selectAria", { guid: row.blade.guid })} type="checkbox" checked={props.selectedGuids.has(row.blade.guid)} onClick={(event) => event.stopPropagation()} onChange={(event) => select(row.blade.guid, event.target.checked)} /></td>
              <td><input aria-label={t("analysis:blades.enableAria", { guid: row.blade.guid })} type="checkbox" checked={row.enabled} onClick={(event) => event.stopPropagation()} onChange={(event) => props.onEnabledChange(row.blade.guid, event.target.checked)} /></td>
              <td>{row.index}</td><td>{row.blade.kind}</td>
              <td><button className="guid-button" title={row.blade.guid} onClick={(event) => { event.stopPropagation(); void navigator.clipboard.writeText(row.blade.guid); }}>{row.blade.guid.slice(0, 8)}…</button></td>
              <td>{formatNumber(row.blade.position[0], props.precision)}</td><td>{formatNumber(row.blade.position[1], props.precision)}</td><td>{formatNumber(row.blade.position[2], props.precision)}</td><td>{String(row.blade.flipped)}</td><td>{modifiedGuids.has(row.blade.guid) ? <span className="what-if-badge">{t("analysis:blades.modified")}</span> : "—"}</td>
              <td>{formatNumber(row.force[0], props.precision)}</td><td>{formatNumber(row.force[1], props.precision)}</td><td>{formatNumber(row.force[2], props.precision)}</td>
              <td>{formatNumber(row.rollMoment, props.precision)}</td><td>{formatNumber(row.pitchMoment, props.precision)}</td><td>{formatNumber(row.yawMoment, props.precision)}</td><td>{formatNumber(row.power, props.precision)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}
