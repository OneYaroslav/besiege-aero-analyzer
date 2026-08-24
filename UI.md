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
- 3D Inspector использует schematic geometry как spatial-analysis surface: camera presets, multi-selection, quantity color maps, force/axis overlays и visual-only Hide/Isolate отделены от solver-level Disable.

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
4. Используйте вкладки Overview, Sweeps, Plot Lab, Blades, Contributions, Components, 3D Inspector и Snapshots.
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
  inspector.ts       selection, visibility, display quantities, colors and camera framing
  session-state.ts   GUID Blade Groups, configuration snapshots, summaries and change detection
  what-if.ts         GUID-based virtual flip/position/rotation adapter applied before analysis
  schematic-geometry.ts procedural/fallback primitives and verified prefab visual bounds
  visual-mesh-cache.ts versioned geometry-only cache manifest validation
  ui-model.ts        UI-independent analysis/view-model assembly and export
  bsg-node.ts        Node filesystem adapter
  cli.ts             existing CLI adapter

ui/
  App.tsx            application state, Single/Compare orchestration
  i18n.ts            bundled i18next setup with English fallback and namespace registry
  file-io.ts         shared Tauri/browser Open and Save abstraction
  visual-mesh-cache.ts Tauri GLB loading and reusable prefab templates
  components/        controls, tables, graphs, diagnostics, Three.js viewer

locales/
  en/                common, analysis, plotlab, whatif, snapshots, viewer3d and tutorial namespaces
```

Локализация использует один `i18next` / `react-i18next` instance для browser и Tauri. Сейчас заполнен только небольшой общий словарь действий в `common`; остальные English namespaces намеренно созданы пустыми как стабильные точки расширения. Для добавления Russian locale нужно создать такую же структуру `locales/ru`, зарегистрировать ресурсы и язык в `ui/i18n.ts`; отсутствующие ключи продолжат безопасно брать English через `fallbackLng`.

Отключение лопастей реализовано как `disabledBladeGuids`. Расширенные transform-overrides хранятся отдельно по GUID и применяются к виртуальной копии `BsgMachine` до единственного вызова существующего analysis core. Поэтому baseline, derivatives, standard sweeps, Plot Lab 1D/2D, contributions, Compare и 3D получают одинаковые effective blades, но исходный `.bsg` не мутирует.

What-if Move/Rotate сейчас явно работает в aircraft/machine axes: `+X` right/pitch, `+Y` up/yaw, `+Z` forward/roll. Position offset прибавляется к block-root position. Rotation offset задан в градусах как extrinsic aircraft-axis X → Y → Z и компонуется quaternion-умножением `qOffset × qBlock`; физические формулы при этом не изменены.

## Implemented UI features

- drag-and-drop и file picker с нормальной parser error handling;
- встроенный 22-step spotlight Tutorial с объяснением назначения программы, Components/Analysis Group, Current State, static/damping response и каждого стандартного sweep, а также interactive gates для blade selection, Blade Group, Baseline Snapshot и What-if;
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
- расширенный What-if Lab для selection/multi-selection/Blade Group: Enable/Disable, virtual Flip, position offset и pitch/yaw/roll rotation offset с Reset selected/Reset all;
- modified position/quaternion/flipped отображаются в Blade Table и 3D Inspector; magenta outline помечает blade с transform/flip override;
- GUID-based Blade Groups: создание из общей 3D/Table selection, rename/delete, Select/Isolate и групповое solver-level enable/disable;
- live summary каждой Blade Group: force, roll/pitch/yaw moment, power и доступные static/damping contribution sums;
- configuration-only Snapshots с name/note, Restore, Duplicate, Rename и Delete;
- Current/Snapshot и Snapshot/Snapshot comparison: повторный solver run, raw values, `Delta = second − first` и список изменений конфигурации;
- Blade Groups, Snapshots и What-if overrides входят в валидируемый analysis JSON export/import; отсутствующие GUID показываются как warning и не приводят к падению;
- Single/Compare mode с общим operating point, независимыми groups и blade masks;
- raw numerical comparison table с опциональным Δ% (`N/A` около нулевого A denominator) и overlay compare plots;
- spatial-component diagnostics;
- Three.js 3D Inspector с orbit/pan/zoom, adaptive framing и Front/Rear/Left/Right/Top/Bottom/Perspective presets;
- synchronized click/Ctrl/Shift multi-selection между Inspector и Blade Table, Focus selected и суммарные force/moment/power/contribution values;
- Geometry, force magnitude, power, roll/pitch/yaw moment, roll/pitch/yaw damping и pitch/yaw static contribution display modes;
- zero-centered signed и sequential unsigned color maps с численной legend;
- per-blade/total force vectors, CG, aircraft axes, force/sense axes и selected CG arm overlays;
- visual-only Hide/Isolate/Show all, отдельно от solver-level Disable selected;
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
- Desktop 3D Inspector использует локальный geometry-only GLB cache для 91 подтверждённого vanilla ID. Он извлекается пользователем из установленной Besiege 1.90-25346 и не входит в Git/installer; подробности и команда запуска находятся в `MESH_CACHE.md`. Browser/Vite mode, отсутствующий/несовместимый cache и 12 procedural/runtime-dependent IDs используют существующий schematic/procedural fallback.
- Visual Propeller/SmallPropeller mesh использует полную игровую цепочку Machine Global → BSG block TRS → prefab child transforms → runtime `CheckFlipDirection` ±23°. Physics overlays остаются отдельными.
- WoodenPole id=41 и Log id=63 используют точные извлечённые `Vis`/`HalfVis` meshes, выбранные по сериализованному `length`; fallback-примитив остаётся только при отсутствии desktop cache.
- Geometry-only cache не содержит textures, materials, shaders или colliders. Все cached meshes получают единый нейтральный Three.js material, поэтому это точная prefab-форма, но не визуальная копия игрового skin/material state.
- Roll static per-blade color mode отсутствует: существующий analysis core предоставляет per-blade static decomposition только для pitch/alpha и yaw/beta. Новая производная ради viewer не вводилась.
- Fixed manual color domain пока не реализован; Inspector использует численно показанный Auto scale текущего dataset.
- Plot Lab heatmap values ограничены существующими baseline Fx/Fy/Fz, roll/pitch/yaw moment и blade power; derivatives доступны в 1D и пересчитываются существующим central-difference solver в каждой X-точке.
- Imported CSV datasets являются session-only визуальными overlays и не влияют на solver. 2D CSV пока импортируется только как настраиваемые 1D columns, не как heatmap dataset.
- Analysis JSON не содержит исходную `.bsg` geometry. Полное восстановление машины требует вручную открыть указанный `.bsg`; приложение не ищет его по диску.
- Snapshot хранит `cgMode: auto`, disabled GUIDs и GUID-based What-if flip/position/rotation overrides, а не закэшированный CG или рассчитанные результаты. При restore/compare CG и все solver outputs вычисляются заново.
- Snapshot Compare пока использует compact numerical comparison table и configuration diff. Автоматическое наложение двух snapshot-состояний на Plot Lab graphs оставлено как дальнейшее расширение.
- What-if transform space пока только Aircraft axes. Local-space edit, transform gizmo, coefficient/velocity-cap/mass/scale editing, создание blades и запись обратно в `.bsg` не реализованы. Одинаковый group rotation меняет orientation каждого участника вокруг его собственного block root; он не вращает positions группы вокруг общего pivot.
- 2D grid ограничен 10 000 cells. Расчёт планируется после отрисовки `Calculating…`; проверенная 31×31 сетка для Escape/Gripen занимает десятки миллисекунд, поэтому Web Worker пока не нужен.
- Большой production JS chunk связан с Three.js/Recharts. Это performance warning сборщика, не runtime/build error; code splitting можно добавить позже без изменения core.
