import { useMemo, useState } from "react";
import { buildBladeRows, formatNumber, type PrecisionMode, type UiAnalysisBundle } from "../../src/ui-model.ts";
import { InfoTooltip } from "./InfoTooltip.tsx";

type SortKey = "index" | "type" | "guid" | "x" | "y" | "z" | "flipped" | "fx" | "fy" | "fz" | "roll" | "pitch" | "yaw" | "power";

interface BladeTableProps {
  readonly bundle: UiAnalysisBundle;
  readonly precision: PrecisionMode;
  readonly selectedGuids: ReadonlySet<string>;
  readonly focusedGuid?: string;
  readonly onSelectionChange: (guids: Set<string>) => void;
  readonly onFocus: (guid: string) => void;
  readonly onEnabledChange: (guid: string, enabled: boolean) => void;
  readonly onEnableAll: () => void;
  readonly onDisableSelected: () => void;
  readonly onReset: () => void;
}

export function BladeTable(props: BladeTableProps) {
  const rows = useMemo(() => buildBladeRows(props.bundle), [props.bundle]);
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

  return (
    <section className="data-panel table-panel">
      <div className="table-toolbar">
        <div>
          <span className="panel-kicker">AERODYNAMIC BLADES</span>
          <strong>{props.bundle.report.blades.length} enabled / {props.bundle.report.availableBlades.length} available</strong>
        </div>
        <label className="search-field"><span className="sr-only">Search blades</span><input type="search" placeholder="Search GUID or type" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <label>Type<select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">All</option><option value="Propeller">Propeller</option><option value="SmallPropeller">SmallPropeller</option></select></label>
        <label>State<select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}><option value="all">All</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option></select></label>
        <label>Flipped<select value={flippedFilter} onChange={(event) => setFlippedFilter(event.target.value)}><option value="all">All</option><option value="true">True</option><option value="false">False</option></select></label>
        <button className="secondary-button" onClick={props.onEnableAll}>Enable all</button>
        <button className="secondary-button" disabled={props.selectedGuids.size === 0} onClick={props.onDisableSelected}>Disable selected ({props.selectedGuids.size})</button>
        <button className="ghost-button" onClick={props.onReset}>Reset</button>
      </div>
      <div className="table-scroll">
        <table className="engineering-table blade-table">
          <thead><tr>
            <th>Sel.</th><th>Enabled</th><th>{header("index", "#")}</th><th>{header("type", "Type")}</th><th>{header("guid", "GUID")}</th>
            <th>{header("x", "X")}</th><th>{header("y", "Y")}</th><th>{header("z", "Z")}</th><th><span className="table-help">{header("flipped", "Flip")}<InfoTooltip label="About flipped blades">Flipped is the blade block's stored orientation flag. The recovered model applies it to the lift-normal angle; it is not an enabled/disabled state.</InfoTooltip></span></th>
            <th>{header("fx", "Fx")}</th><th>{header("fy", "Fy")}</th><th>{header("fz", "Fz")}</th>
            <th>{header("roll", "M roll")}</th><th>{header("pitch", "M pitch")}</th><th>{header("yaw", "M yaw")}</th><th>{header("power", "F·v")}</th>
          </tr></thead>
          <tbody>{sorted.map((row) => (
            <tr key={row.blade.guid} className={`${row.enabled ? "" : "disabled-row"} ${props.focusedGuid === row.blade.guid ? "focused-row" : ""}`} onClick={() => props.onFocus(row.blade.guid)}>
              <td><input aria-label={`Select blade ${row.blade.guid}`} type="checkbox" checked={props.selectedGuids.has(row.blade.guid)} onClick={(event) => event.stopPropagation()} onChange={(event) => select(row.blade.guid, event.target.checked)} /></td>
              <td><input aria-label={`Enable blade ${row.blade.guid}`} type="checkbox" checked={row.enabled} onClick={(event) => event.stopPropagation()} onChange={(event) => props.onEnabledChange(row.blade.guid, event.target.checked)} /></td>
              <td>{row.index}</td><td>{row.blade.kind}</td>
              <td><button className="guid-button" title={row.blade.guid} onClick={(event) => { event.stopPropagation(); void navigator.clipboard.writeText(row.blade.guid); }}>{row.blade.guid.slice(0, 8)}…</button></td>
              <td>{formatNumber(row.blade.position[0], props.precision)}</td><td>{formatNumber(row.blade.position[1], props.precision)}</td><td>{formatNumber(row.blade.position[2], props.precision)}</td><td>{String(row.blade.flipped)}</td>
              <td>{formatNumber(row.force[0], props.precision)}</td><td>{formatNumber(row.force[1], props.precision)}</td><td>{formatNumber(row.force[2], props.precision)}</td>
              <td>{formatNumber(row.rollMoment, props.precision)}</td><td>{formatNumber(row.pitchMoment, props.precision)}</td><td>{formatNumber(row.yawMoment, props.precision)}</td><td>{formatNumber(row.power, props.precision)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}
