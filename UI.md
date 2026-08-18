# Besiege Aero Analyzer UI

Локальный React/Vite-интерфейс использует существующий physics/aero core как единственный источник расчётов. Формулы AxialDrag, parser, mass model, AnalysisGroup, derivatives, sweeps и per-blade contributions не продублированы в React-компонентах.

Этот browser development mode сохранён после добавления Tauri 2. Запуск и сборка обычного Windows desktop application описаны в `DESKTOP.md`.

## Engineering workspace redesign

Presentation layer организован как компактная dark engineering workstation:

- постоянный desktop sidebar содержит machines, AnalysisGroup, live Operating Point, precision и model status;
- Overview использует иерархию human-readable label → technical variable → raw value → units;
- единый keyboard/touch-accessible `InfoTooltip` объясняет axes, rates, forces, moments, derivatives, sweeps и heuristic data без инженерных оценок Stable/Unstable;
- Sweeps разделены на longitudinal и lateral/directional response, поддерживают A/B overlay и отмечают operating point только когда он присутствует среди рассчитанных samples;
- отдельный Plot Lab строит произвольные 1D зависимости и 2D heatmaps, не заменяя стандартную Sweep Analysis;
- Compare использует cyan для Machine A, orange для Machine B и display-only `Δ = B − A` существующих величин;
- Blades сохраняет raw inspector и добавляет search/type/state/flipped filters;
- Contributions визуализирует существующий signed `% total`, не меняя сортировку или расчёт;
- 3D View помечен Experimental; его Three.js/rendering pipeline редизайном не изменялся.

Никакие calculation modules или структура JSON export ради редизайна не изменялись.

## Запуск

Самый простой способ в Windows:

```powershell
.\run-ui.ps1
```

Launcher найдёт Node.js 24+ в `PATH` или bundled Codex runtime, при необходимости установит frontend dependencies, запустит Vite на `http://127.0.0.1:5173` и откроет браузер. Другой порт и запуск без автоматического открытия:

```powershell
.\run-ui.ps1 -Port 4173
.\run-ui.ps1 -NoOpen
```

После запуска:

1. Перетащите `.bsg` в область загрузки или нажмите **Open .bsg**.
2. Оставьте `All machine blocks` либо явно выберите помеченный `HEURISTIC` component.
3. Меняйте operating point в левой панели. Slider задаёт обычный диапазон, numeric input принимает любое конечное значение, которое поддерживает solver.
4. Используйте вкладки Overview, Sweeps, Plot Lab, Blades, Contributions, Components и 3D View.
5. Для сравнения включите **COMPARE** и загрузите Machine B.
6. Откройте меню **Import / Export** для analysis JSON или CSV dataset. Экспорт графика остаётся в Plot Lab.

Файлы `.bsg` разбираются локально в памяти вкладки. Они не отправляются на сервер и не сохраняются в `localStorage`. В `localStorage` остаются только UI preferences: последняя вкладка, precision, выбранные graph metrics, видимость стандартных sweeps, отображение Δ%, состояние Model Status/sidebar и 3D toggles.

## Architecture

```text
src/
  bsg.ts             browser-safe parser and blade extraction
  physics.ts         recovered vanilla blade law
  mass.ts            versioned mass database model
  groups.ts          AnalysisGroup and spatial heuristic
  analysis.ts        operating state, derivatives, sweeps, contributions
  plot-lab.ts        arbitrary 1D/2D sampling, delta/percent and CSV assembly
  file-workflow.ts   validated JSON restore, CSV parser and imported datasets
  ui-model.ts        UI-independent analysis/view-model assembly and export
  bsg-node.ts        Node filesystem adapter
  cli.ts             existing CLI adapter

ui/
  App.tsx            application state, Single/Compare orchestration
  file-io.ts         shared Tauri/browser Open and Save abstraction
  components/        controls, tables, graphs, diagnostics, Three.js viewer
```

Отключение лопастей реализовано как `disabledBladeGuids` в существующем analysis core. Оно влияет на baseline, derivatives, sweeps и contribution analysis, но не изменяет исходный `.bsg`, выбранную mass group или CG.

## Implemented UI features

- drag-and-drop и file picker с нормальной parser error handling;
- desktop engineering workspace и адаптивная компоновка;
- live Speed/Alpha/Beta/p/q/r controls;
- mass, approximate CG, selected/total blocks и blade counts;
- явные `ALL BLOCKS` / `HEURISTIC` статусы AnalysisGroup;
- baseline force, pitch/roll/yaw moment и blade power;
- static, damping и expandable cross-rate derivatives с units/steps;
- interactive alpha, beta, p, q и r sweep plots с zero lines/tooltips;
- сохраняемая настройка show/hide для пяти стандартных Sweep Analysis graphs;
- Plot Lab 1D: Speed/Alpha/Beta/p/q/r по baseline forces, moments, power и шести существующим stability/damping derivatives;
- Plot Lab 1D multi-series в Single с максимум двумя явными unit axes; Compare Absolute или `Delta = B − A`;
- Plot Lab 2D: настраиваемые X/Y ranges и resolution, canvas heatmap, общая A/B color domain, delta heatmap и точный cell tooltip;
- presets Pitch/Yaw stability/damping, Roll damping, Energy vs AoA, Pitch state map и Energy map;
- Plot Lab CSV export для 1D/2D и JSON export для 2D;
- native Tauri Save As/Open dialogs для JSON/CSV и browser download/file-picker fallback;
- валидируемый Import Analysis JSON с восстановлением operating point, group, disabled blades, precision и Plot Lab state;
- deferred JSON restore: если export не содержит `.bsg`, machine-specific group/mask применяется после ручного открытия соответствующей машины;
- Import CSV с quoted-field parser, numeric column selection, unit metadata и внешними show/hide/rename/remove series в 1D Plot Lab;
- sortable/filterable blade table и копирование GUID;
- per-blade contribution selector/table;
- analytical blade enable/disable, Disable selected, Enable all и Reset;
- Single/Compare mode с общим operating point, независимыми groups и blade masks;
- raw numerical comparison table с опциональным Δ% (`N/A` около нулевого A denominator) и overlay compare plots;
- spatial-component diagnostics;
- простой Three.js viewer с block/blade placeholders, axes, CG, force vectors, force/sense axes, orbit camera и synchronized blade selection;
- Auto/3/6-decimal precision;
- Single/Compare JSON export с assumptions, model version и disabled GUIDs.

## Development and validation

Обычные команды при доступном Node/npm:

```powershell
npm install
npm run dev
npm test
npm run typecheck
npm run build
```

Production build создаётся в `dist/`. CLI остаётся доступен через `run.ps1` и не зависит от запуска UI.

## Known limitations

- `HEURISTIC` component — spatial suggestion с blade priority, не восстановленный runtime joint graph.
- CG использует versioned prefab masses и block-root COM fallback там, где runtime COM недоступен.
- BuildSurface runtime mass, child Rigidbody topology Spring/Rope и точные runtime mass overrides могут требовать runtime data.
- Нет SI conversion, exact inertia, angular acceleration, time response, control-surface actuation или multibody dynamics.
- 3D view намеренно показывает engineering placeholders, а не proprietary Besiege meshes; размеры block placeholders не являются collision geometry.
- Plot Lab heatmap values ограничены существующими baseline Fx/Fy/Fz, roll/pitch/yaw moment и blade power; derivatives доступны в 1D и пересчитываются существующим central-difference solver в каждой X-точке.
- Imported CSV datasets являются session-only визуальными overlays и не влияют на solver. 2D CSV пока импортируется только как настраиваемые 1D columns, не как heatmap dataset.
- Analysis JSON не содержит исходную `.bsg` geometry. Полное восстановление машины требует вручную открыть указанный `.bsg`; приложение не ищет его по диску.
- 2D grid ограничен 10 000 cells. Расчёт планируется после отрисовки `Calculating…`; проверенная 31×31 сетка для Escape/Gripen занимает десятки миллисекунд, поэтому Web Worker пока не нужен.
- Большой production JS chunk связан с Three.js/Recharts. Это performance warning сборщика, не runtime/build error; code splitting можно добавить позже без изменения core.
