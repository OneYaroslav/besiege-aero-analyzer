# Besiege Aero Analyzer — Physics PoC

Это CLI-ядро без React, Three.js, GUI и desktop-обвязки. Оно парсит реальный `.bsg`, строит статическую mass model/AnalysisGroup и передаёт выбранный CG в существующий vanilla blade solver.

## Запуск

Требуется Node.js 24+; сторонних npm dependencies нет. На этой машине `node` не добавлен в `PATH`, поэтому самый простой запуск — wrapper, который сам найдёт bundled Codex Node:

```powershell
.\run.ps1 --bsg "C:\path\machine.bsg" --v "0,0,100" --omega "0,0,0" --cg auto --mass-group all --summary-only
.\run.ps1 --bsg "C:\path\machine.bsg" --v "0,0,100" --omega "0.1,0,0" --cg auto --mass-group aircraft-heuristic --summary-only
```

Vector arguments для PowerShell wrapper нужно заключать в кавычки, как в примере. Если `node` уже есть в `PATH`, эквивалентная команда — `node src/cli.ts ...`. Тесты на текущей машине:

```powershell
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test
```

Основные опции:

- `--cg auto` использует CG выбранной mass group; `--cg x,y,z` оставляет ручной CG;
- `--mass-group all` — все blocks (default);
- `--mass-group aircraft-heuristic` — явно выбрать предупреждённый spatial heuristic;
- повторяемые `--include-guid GUID[,GUID]` и `--exclude-guid GUID[,GUID]` задают AnalysisGroup вручную;
- `--component-threshold 1.5` меняет только spatial heuristic;
- `--diagnose-components` печатает кластеры и полную диагностику блоков вне предложенного aircraft component;
- `--summary-only` скрывает строки отдельных лопастей;
- `--json` выдаёт machine-readable результат.

Aircraft heuristic никогда не выбирается молча. Default — явно подписанный `all machine blocks`. В каждом запуске CLI показывает число выбранных/исключённых блоков, mass database identity, provenance, CG и warnings.

CLI пишет только в stdout/stderr и сам лог-файл не создаёт. Сохранить обычный или JSON-лог можно средствами PowerShell:

```powershell
.\run.ps1 ... *> run.log
.\run.ps1 ... --json > run.json
```

## Versioned mass database

Файл `data/besiege-1.90-25346-mass.json` извлечён из локального `Besiege_Data/level0` скриптом `tools/extract_unity_masses.py` и привязан к:

- Besiege `1.90-25346`;
- Unity `5.4.0f3`;
- `Assembly-CSharp.dll` SHA-256 `BECEA5E934C0D1AB0C0D0428DB53000E245997BA9761581D45F13BD168AE1ABF`.

Сопоставление: `BlockPrefabContainer.Info.ID -> root GameObject Rigidbody`. У 101 из 103 prefab IDs найден root Rigidbody; у BuildNode id=71 и BuildEdge id=72 его отсутствие подтверждено prefab-данными. Serialized `m_Mass` помечен `prefab-verified`.

В Unity 5.4 asset serialization этих Rigidbody нет `centerOfMass`/inertia fields. Поэтому точный prefab/runtime COM не придуман: static model использует block-root position как явно предупреждённый fallback с provenance `runtime-required`. Исключение — подтверждённый `GenericDraggedBlock.SetCenterOfMass`, где для Spring/Rope используется midpoint serialized endpoints.

Mass provenance для каждого block contribution:

- `prefab-verified`;
- `block-specific-override`;
- `runtime-required`;
- `unknown`.

Mass не масштабируется по `scale.x * scale.y * scale.z`.

## Подтверждённые overrides в «Проект Ескапе»

Исследовались только контроллеры IDs, реально присутствующих в машине.

- `ShorteningBlock.UpdateLength`: Log id=63 с `bmt-version>0,length=2` получает mass `0.65`; один такой block есть в самолёте. WoodenPole id=41 в этой машине имеет default length/mass.
- `BuildSurface.UpdateMass`: при `bmt-custom-mass=0` mass зависит от runtime generated BoxColliders и density выбранного материала. Шесть поверхностей оставлены `runtime-required`; используется prefab mass `0.5` только как предупреждённый fallback.
- `SpringCode.SetMass`: Spring/Rope имеют endpoint Rigidbody topology. Для одного Spring и пяти Rope используется root prefab mass fallback; точный учёт дочерних bodies требует exporter.
- SigmaGoida `RSM.dll` (SHA-256 `3F8CACFF9767CC889BB5073E3C648A17EFDF1FE2139323D57028FD2D9821235A`) меняет mass только при одновременных `bmt-SimpleSet=true` и `bmt-Forcemass=true`, затем берёт `bmt-RNFmass`. В этой машине `bmt-Forcemass=false` у всех blocks, поэтому mod override не применяется.

`bmt-Enhancement=true` у propellers не меняет текущую формулу или коэффициент. В установленном `BEM.dll` (SHA-256 `6E96E3F21BAFBCC3A3C9C5EB5EB5582B38B1C7BAD28008EDFB4BD8E2FA762641`) enabled state сохраняет vanilla `AxisDrag`, disabled state обнуляет его. PoC анализирует default runtime state **aero enabled**; будущий disabled state должен отключать силы соответствующих лопастей.

## AnalysisGroup и physical components

Статически подтверждённые ссылки:

- BuildEdge id=72: serialized `start`/`end` GUID;
- BuildSurface id=73: serialized список `edges`;
- специальные endpoint data у Brace/Spring/Rope.

Это не универсальный Besiege joint graph. Текущий suggestion использует только:

1. proximity block-root positions с явно показанным threshold;
2. точные serialized BuildEdge/BuildSurface GUID links;
3. приоритет component с наибольшим числом vanilla aerodynamic blades, затем размер и расстояние до blade centroid.

Результат всегда помечен `HEURISTIC`. Exact physical membership требует runtime exporter, описанного в `RUNTIME_EXPORTER.md`.

## Mass/CG диагностика «Проект Ескапе»

При heuristic threshold `1.5` получены:

| Набор | Blocks | Blades | Static mass | Static CG |
|---|---:|---:|---:|---|
| A: all machine | 230 | 37 | 95.300001 | (-0.030693, -1.320021, -0.060504) |
| Aircraft suggestion | 201 | 37 | 77.800001 | (0.000964, -2.466808, -0.177009) |
| Logic cube | 28 | 0 | 17.000000 | (0.000000, 3.764395, 0.412078) |
| Isolated LogicGate | 1 | 0 | 0.500000 | (-6.000000, 4.250002, 1.999999) |
| All minus only 28-block cube | 202 | 37 | 78.300001 | (-0.037356, -2.423917, -0.163107) |

Таким образом куб даёт 17.0 из 95.3 static mass (17.84%) и заметно сдвигает all-block CG вверх. Отдельный LogicGate показан отдельно и не спрятан в куб.

Approximate point-mass inertia about соответствующего CG (не Rigidbody shape inertia):

| Набор | Ixx | Iyy | Izz | Ixy | Ixz | Iyz |
|---|---:|---:|---:|---:|---:|---:|
| All machine | 1125.720 | 825.533 | 837.223 | 16.818 | 5.776 | -35.352 |
| Aircraft suggestion | 532.389 | 766.899 | 255.254 | 0.022 | -0.415 | 19.197 |
| Logic cube only | 29.055 | 33.748 | 6.758 | 0.000 | -0.000 | 2.432 |
| All minus only cube | 557.157 | 787.145 | 295.559 | 20.047 | 6.076 | 11.932 |

`--diagnose-components` выводит для каждого из 29 blocks вне aircraft suggestion: GUID, ID/type, position, mass/provenance, наличие Rigidbody, `bmt-NoCollider`, `bmt-Passive`, `bmt-Enhancement`, `bmt-SimpleSet`, `bmt-Forcemass` и расстояние от blade centroid. У 28-block куба 24 blocks имеют `bmt-NoCollider=true`; `bmt-Passive=false` у всех. Эти flags не доказывают отсутствие физической связи, поэтому куб не исключается автоматически.

## Aero solver

Все vectors находятся в machine-local frame. `V` — units/s, `omega` — rad/s. Manual defaults для semantic axes: forward `+Z`, up `+Y`; right = `up × forward`. Pitch/roll/yaw — проекции момента на right/forward/up.

- IDs `26`/`55`, position/quaternion/scale и `flipped` берутся из BSG.
- Recovered Besiege 1.90-25346 параметры: `AxisDrag.y=0.015`, velocity cap `30`, углы `23.068759°` и `22.844994°`.
- `forceAxis = Qblock * localY`.
- `senseAxis = Qblock * RotZ(flipped ? -angle : +angle) * localY`.
- `v = V + omega × (bladePosition - CG)`.
- `F = -0.015 dot(v,senseAxis) min(|v|²,900) forceAxis`.
- `moment = (bladePosition-CG) × F`; `power = F · v`.

AxialDrag law на mass-model этапе не изменялась.

### BuildSurface id=73 aero

Активная деревянная поверхность (`bmt-aero=true`, wood material) использует восстановленную из Besiege 1.90-25346 procedural geometry. Для каждой из 3/4 угловых точек вычисляются `u = V + omega × (x-CG)`, local `d = dot(normal,-uLocal)`, `s2=min(|u|²,90000)` и `FLocal = normal*d*s2*0.0002500000118743628*SurfaceArea/cornerCount`. Сила преобразуется через block `TransformVector`, moment считается как `(x-CG)×F`, power — как сумма `F_i·u_i`. Glass material остаётся неаэродинамическим даже при включённой mapper-галке.

Solver и UI хранят раздельные Blade / BuildSurface / Total force, moment и power. Derivatives, standard sweeps, Plot Lab, Compare, Snapshots и Turn Analysis используют Total из одного общего core path.

## Повторные прогоны

Для `V=(0,0,100)`, 37 blades и трёх omega states:

| CG model | omega | Total force | Pitch | Roll | Yaw | Σ(F·v) |
|---|---|---|---:|---:|---:|---:|
| Old manual `(0,0,0)` | `(0,0,0)` | (2.803, 76.572, 125.984) | -465.758 | 3.144 | 4.695 | 12598.410 |
| Old manual `(0,0,0)` | `(0.1,0,0)` | (2.805, 72.459, 116.255) | -611.476 | 3.152 | 4.674 | 11564.319 |
| Old manual `(0,0,0)` | `(0,0.1,0)` | (4.862, 76.713, 123.699) | -460.645 | 1.698 | -110.439 | 12358.822 |
| All-block auto CG | `(0,0,0)` | (2.803, 76.572, 125.984) | -304.089 | 1.794 | 0.998 | 12598.410 |
| All-block auto CG | `(0.1,0,0)` | (2.809, 74.519, 116.746) | -463.064 | 1.735 | 1.267 | 11628.334 |
| All-block auto CG | `(0,0.1,0)` | (4.030, 76.705, 123.728) | -302.030 | -3.523 | -113.813 | 12361.382 |
| Aircraft-only auto CG (heuristic) | `(0,0,0)` | (2.803, 76.572, 125.984) | -168.533 | -3.845 | 5.313 | 12598.410 |
| Aircraft-only auto CG (heuristic) | `(0.1,0,0)` | (2.811, 78.379, 117.518) | -338.279 | -3.852 | 5.297 | 11717.927 |
| Aircraft-only auto CG (heuristic) | `(0,0.1,0)` | (2.428, 76.697, 123.795) | -169.083 | -10.963 | -109.366 | 12368.549 |

Mass/CG для первых двух models: `95.300001` / all CG выше; для aircraft-only: `77.800001` / aircraft CG выше. При zero omega force/power одинаковы, а moment меняется из-за плеча относительно CG. При ненулевой omega CG также входит в `omega × r`, поэтому меняются force и power.

## Ограничения перед следующим этапом

- Static CG приблизительный: точные local COM большинства Rigidbody отсутствуют в asset serialization.
- BuildSurface runtime mass и endpoint Rigidbody Spring/Rope пока не известны точно.
- Spatial component suggestion не доказывает joint membership логического куба или отдельного LogicGate.
- Approximate inertia учитывает blocks как point masses и не является Unity `inertiaTensor`.
- Точка приложения blade aero force остаётся BSG block-root position; BuildSurface forces прикладываются в восстановленных corner points.
- Для BuildSurface не моделируются отдельные runtime Rigidbody states, разрушение, joint constraints и PhysX multibody behavior.
- Machine forward/up остаются manual.

Перед inertia/control-response нужен runtime snapshot из Besiege: exact masses/COM/inertia, все child Rigidbody, joints/connectedBody, collider state и physical connected-component membership.
