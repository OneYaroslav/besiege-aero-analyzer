# Технический отчёт по Besiege Aero Analyzer

Отчёт составлен по состоянию проекта в `C:\BesiegeMods\besiege-aero-analyzer`, ветка `main`, commit `65180c2`, версия приложения `0.5.0`.

При подготовке отчёта приоритет отдавался исполняемому коду, а не только документации: часть раннего `FEASIBILITY.md` описывает желаемую архитектуру, которая реализована не полностью. На момент анализа проходят 96 из 96 тестов.

Главный вывод: это не симулятор всей физики Besiege и не CFD. Это статический/квазистатический анализатор конкретно восстановленных аэродинамических механизмов Besiege 1.90-25346:

- vanilla `Propeller`, ID `26`;
- vanilla `SmallPropeller`, ID `55`;
- активные деревянные `BuildSurface`, ID `73`;
- массы и приближённый CG выбранной группы блоков;
- суммарные силы, моменты и `ΣF·v`;
- локальные производные устойчивости и вращательного демпфирования;
- sweeps, сравнение машин, per-blade decomposition;
- виртуальные изменения лопастей без изменения исходного `.bsg`.

При этом программа не моделирует полную аэродинамику всех блоков, тягу двигателей, гравитацию, реальный PhysX joint graph, деформацию машины, точные runtime Rigidbody-состояния, угловое ускорение, динамику во времени, разрушение и движение управляющих механизмов.

## 1. Ментальная модель проекта

```text
.bsg XML
  ↓
BsgMachine / BsgBlock
  ↓
выбор AnalysisGroup
  ↓
mass database + block-specific overrides
  ↓
approximate mass / CG / point-mass inertia
  ↓
распознавание:
  - Propeller id=26
  - SmallPropeller id=55
  - BuildSurface id=73 + BuildEdge id=72 + BuildNode id=71
  ↓
AnalysisState: speed, alpha, beta, p, q, r, CG
  ↓
V и ω в machine-local frame
  ↓
для каждой точки приложения: u = V + ω × (x - CG)
  ↓
blade law / BuildSurface law
  ↓
per-element force, moment, F·u
  ↓
Blades totals + BuildSurface totals
  ↓
Total force / moment / power
  ↓
finite-difference derivatives
  ↓
sweeps / Plot Lab / compare / contributions / snapshots / UI
```

Принципиально важно: 3D-модели, collider-подобные glyphs и mesh cache не являются источником физики. Solver использует нормализованные данные `.bsg`, восстановленные параметры prefab/code и procedural BuildSurface geometry.

## 2. Архитектура проекта

### 2.1 `src/`: численное ядро и независимая логика

Основная физика находится в `src/`. React-компоненты не содержат второй реализации формул.

Парсинг и математика:

- `src/bsg.ts` — `BsgBlock`, `BsgMachine`, `VanillaBlade`, XML-парсер `.bsg`, распознавание ID 26/55.
- `src/bsg-node.ts` — Node/CLI-адаптер: читает UTF-8 файл и передаёт текст в `parseBsg`.
- `src/math.ts` — `Vec3`, `Quaternion`, dot/cross, нормализация и Unity-совместимое вращение вектора quaternion’ом.

Масса и группы:

- `src/mass.ts` — versioned mass database, block-specific overrides, CG и point-mass inertia.
- `src/groups.ts` — `AnalysisGroup`, spatial component heuristic, explicit BuildEdge/BuildSurface links, include/exclude.

Аэродинамика:

- `src/physics.ts` — восстановленная аэродинамика Propeller/SmallPropeller.
- `src/build-surface-geometry.ts` — reconstruction procedural geometry `BuildSurface`.
- `src/build-surface-physics.ts` — аэродинамическая формула `BuildSurface`.
- `src/aerodynamics.ts` — общий solver, объединяющий blades и BuildSurfaces.

Анализ:

- `src/analysis.ts` — `AnalysisState`, conventions, finite differences, derivatives, sweeps, contributions, compare.
- `src/plot-lab.ts` — произвольные 1D/2D sweeps, zero contours, Turn Analysis.
- `src/sweep-visualization.ts` — метрики кривых и sticky Y-domain; физику не меняет.

Виртуальные изменения и состояние:

- `src/what-if.ts` — виртуальные `flipped`, position offset и rotation offset лопастей.
- `src/session-state.ts` — Blade Groups, snapshots, summaries и сравнение конфигураций.
- `src/ui-model.ts` — machine discovery, UI-independent analysis bundle, standard sweeps, contributions и JSON export.

Геометрия и 3D:

- `src/schematic-geometry.ts` — procedural и schematic fallback geometry.
- `src/visual-mesh-cache.ts` — формат и валидация geometry-only cache.
- `src/visual-transform.ts` — TRS-матрицы и chain `Machine * Block * prefab child`.
- `src/inspector.ts` — selection, visibility, colors и camera framing без WebGL.

I/O:

- `src/cli.ts` — raw V/ω solver, stability, components, compare, sweeps, JSON.
- `src/file-workflow.ts` — import analysis JSON и CSV. CSV влияет только на visualization, не на solver.

### 2.2 `ui/`: React-представление

UI вызывает функции из `src/`; формулы внутри React не дублируются. Основная orchestration находится в `ui/App.tsx`, а viewer/plots/tables — в `ui/components/`.

`buildUiAnalysis()` сначала применяет What-if к виртуальной копии машины, затем выполняет mass/group/aero analysis. Поэтому viewer, таблицы, sweeps и derivatives получают одно и то же modified состояние.

### 2.3 `data/`: versioned данные Besiege

- `data/besiege-1.90-25346-mass.json` — 103 записи vanilla prefab и provenance масс.
- `data/besiege-1.90-25346-visual-bounds.json` — bounds child renderers для schematic renderer.
- `data/vanilla-visual-mesh-policy.json` — policy static-prefab/procedural/fallback.

Mass database привязана к:

```text
Besiege: 1.90-25346
Unity: 5.4.0f3
Assembly-CSharp.dll SHA-256:
BECEA5E934C0D1AB0C0D0428DB53000E245997BA9761581D45F13BD168AE1ABF
```

### 2.4 `tools/`: offline extraction

- `extract_unity_masses.py`;
- `extract_unity_visual_bounds.py`;
- `extract_unity_visual_meshes.py`;
- `inspect_unity_prefab_visuals.py`.

Они читают Unity assets установленной Besiege, но не запускают simulation и не являются runtime exporter’ом.

### 2.5 `src-tauri/`: Windows wrapper

Tauri не содержит физический backend. Rust-часть предоставляет dialogs/filesystem, читает локальный mesh cache и упаковывает Vite `dist` в `.exe`.

### 2.6 `test/`

96 тестов покрывают parser, blade и BuildSurface physics, mass/groups, conventions, derivatives, Plot Lab, Turn Analysis, What-if, snapshots, mesh transforms, Eskapie/Gripen fixtures и I/O.

## 3. Входные данные

### 3.1 `.bsg`

`.bsg` — UTF-8 XML, не архив и не бинарный формат.

```xml
<Machine name="..." version="..." bsgVersion="1.4">
  <Global>
    <Position ... />
    <Rotation ... />
  </Global>
  <Blocks>
    <Block id="55" guid="...">
      <Transform>
        <Position ... />
        <Rotation ... />
        <Scale ... />
      </Transform>
      <Data>
        <Boolean key="flipped">True</Boolean>
      </Data>
    </Block>
  </Blocks>
</Machine>
```

UI читает `File.text()`, CLI использует `readFileSync(..., "utf8")`, Tutorial загружает встроенный `.bsg` через `fetch()`. Везде вызывается один `parseBsg()`.

### 3.2 Operating point

```ts
interface AnalysisState {
  speed;
  alpha;
  beta;
  p;
  q;
  r;
  centerOfGravity;
  analysisGroup;
}
```

- speed: game units/s;
- alpha/beta: radians внутри core;
- p/q/r: rad/s;
- CG: machine-local game units;
- forces/moments: game units;
- power: `F·v`.

Пересчёта в SI нет.

### 3.3 Raw solver input

CLI может напрямую принимать `linearVelocity`, `angularVelocity`, CG, forward и up, минуя speed/angles/rates.

### 3.4 Дополнительное состояние

- AnalysisGroup all/aircraft/include/exclude;
- disabled blade GUIDs;
- What-if overrides;
- finite-difference steps;
- две машины в Compare Mode.

## 4. Парсинг `.bsg`

### 4.1 `BsgBlock`

```ts
interface BsgBlock {
  id: number;
  guid: string;
  position: Vec3;
  rotation: Quaternion;
  scale: Vec3;
  booleans: ReadonlyMap<string, boolean>;
  singles: ReadonlyMap<string, number>;
  integers: ReadonlyMap<string, number>;
  strings: ReadonlyMap<string, string>;
  vectors: ReadonlyMap<string, Vec3>;
}
```

Position/quaternion/scale относятся к block root в machine-local frame.

### 4.2 `BsgMachine`

```ts
interface BsgMachine {
  source: string;
  name: string;
  version: string;
  bsgVersion: string;
  globalPosition: Vec3;
  globalRotation: Quaternion;
  blocks: readonly BsgBlock[];
  warnings: readonly string[];
}
```

### 4.3 `parseBsg()`

Алгоритм:

1. Удаляет XML comments.
2. Проверяет complete `<Machine>` document.
3. Читает `name`, `version`, `bsgVersion`.
4. Читает Global Position/Rotation.
5. Извлекает все `<Block>`.
6. Читает ID, GUID, Transform и keyed Boolean/Single/Integer/String/Vector3.
7. Проверяет количество открывающих Block и parsed blocks.
8. Добавляет warning для пустой машины.

Transforms обязаны быть finite. Quaternion нормализуется при фактическом вращении. Mapper Single может сохранять `±Infinity`, но consumers обязаны валидировать используемые значения.

### 4.4 Ограничения parser

Не сохраняются unknown attributes, `modId`, `localId`, `fallback`, skins/settings, colors, arrays, key bindings, machine-level data и unknown XData losslessly.

Следствия:

- vanilla analysis работает;
- modded blocks нельзя устойчиво идентифицировать;
- lossless BSG round trip невозможен;
- parser read-only и реализует только стабильное подмножество;
- regex-based XML parsing потенциально хрупко для новых схем.

## 5. Какие блоки распознаются

### 5.1 Generic parsing

Любой block с обычными ID/GUID/Transform и поддерживаемыми keyed data попадает в `BsgMachine.blocks`.

### 5.2 Mass database: ID 0–102

```text
0 StartingBlock; 1 DoubleWoodenBlock; 2 Wheel; 3 MetalBlade;
4 Decoupler; 5 Hinge; 6 MetalBall; 7 Brace; 8 Unused; 9 Spring;
10 WoodenPanel; 11 Cannon; 12 ScalingBlock; 13 SteeringBlock;
14 FlyingBlock; 15 SingleWoodenBlock; 16 Suspension; 17 CircularSaw;
18 Piston; 19 Swivel; 20 Spike; 21 Flamethrower; 22 SpinningBlock;
23 Bomb; 24 ArmorPlateSmall; 25 Wing; 26 Propeller; 27 Grabber;
28 SteeringHinge; 29 ArmorPlateRound; 30 BombHolder; 31 FlameBall;
32 ArmorPlateLarge; 33 Plow; 34 WingPanel; 35 Ballast; 36 Boulder;
37 HalfPipe; 38 CogMediumUnpowered; 39 CogMediumPowered;
40 WheelUnpowered; 41 WoodenPole; 42 Slider; 43 Balloon; 44 BallJoint;
45 RopeWinch; 46 LargeWheel; 47 Torch; 48 Drill; 49 GripPad;
50 SmallWheel; 51 CogLargeUnpowered; 52 Unused3; 53 ShrapnelCannon;
54 Grenade; 55 SmallPropeller; 56 WaterCannon; 57 Pin; 58 CameraBlock;
59 Rocket; 60 LargeWheelUnpowered; 61 Crossbow; 62 Vacuum; 63 Log;
64 Magnet; 65 Sensor; 66 Timer; 67 Altimeter; 68 LogicGate;
69 Anglometer; 70 Speedometer; 71 BuildNode; 72 BuildEdge;
73 BuildSurface; 74 SqrBalloon; 75 RopeMeasure; 76 Axle; 77 MetalJaw;
78 Sail; 79 Rudder; 80 NauticalScrew; 81 Paddle; 82 Buoyancy;
83 BigBarrel; 84 Harpoon; 85 CornerWoodenBlock; 86 SkateWheel;
87 BouncyPad; 88 FlyWheel; 89 DragBlock; 90 Booster;
91 SteeringThruster; 92 FuelBarrel; 93 FuelGauge; 94 GridFin;
95 SteeringFin; 96 FuelLine; 97 Parachute; 98 FuelCoupler;
99 FuelBarrelBig; 100 SpaceWheel; 101 ReactionSteeringBlock; 102 FuelCannon.
```

### 5.3 Аэродинамически поддерживаемые блоки

| ID | Тип | Поддержка |
|---:|---|---|
| 26 | Propeller | полная recovered blade law |
| 55 | SmallPropeller | полная recovered blade law |
| 73 | BuildSurface | wood, `bmt-aero=true`, geometry reconstructed |

ID 71/72 используются для BuildSurface topology. Остальные блоки могут участвовать в mass/CG/group/3D, но аэродинамической силы не создают.

В частности, не моделируются aero laws Wing 25, WingPanel 34, Sail 78, Rudder 79, DragBlock 89, GridFin 94, SteeringFin 95, parachute и propulsive blocks.

### 5.4 Используемые mapper-параметры

- Blades: `flipped`, transform; `bmt-Enhancement` коэффициент не меняет.
- BuildSurface: `edges`, `bmt-aero`, `bmt-surfMat`, `materialIndex`, transform.
- BuildEdge: `start`, `end`, position как curved control point.
- BuildNode: position.
- WoodenPole/Log: `bmt-version`, `length`.
- Spring/Rope: `start-position`, `end-position`.
- RSM mass: `bmt-SimpleSet`, `bmt-Forcemass`, `bmt-RNFmass`.
- Diagnostic flags: `bmt-NoCollider`, `bmt-Passive`, `bmt-Enhancement` и другие.

## 6. Coordinate conventions

```text
+X = right
+Y = up
+Z = forward

Pitch = Mx
Yaw   = My
Roll  = Mz

p = roll rate about +Z
q = pitch rate about +X
r = yaw rate about +Y
ωxyz = (q,r,p)
```

Velocity:

```text
Vx = speed * cos(alpha) * sin(beta)
Vy = -speed * sin(alpha)
Vz = speed * cos(alpha) * cos(beta)
```

Положительная alpha наклоняет velocity от +Z к -Y; положительная beta — от +Z к +X. Это изменение incoming/translational velocity, а не геометрии.

Machine Global физикой не применяется, потому что analysis machine-local. Viewer Global применяет.

## 7. AnalysisGroup и components

`.bsg` не содержит универсального runtime joint graph. Статически видны BuildEdge/BuildSurface links и некоторые endpoints.

Component heuristic:

1. Union-find по blocks.
2. Все root positions на расстоянии `<=1.5` объединяются.
3. Добавляются explicit BuildEdge/Surface GUID links.
4. Для компонентов считаются block count, blade count, centroid, distance to blade centroid.
5. Сортировка: больше blades, больше blocks, ближе к blade centroid.
6. Первая component предлагается как aircraft.

Алгоритм `O(N²)` и всегда маркируется `HEURISTIC`.

Для Eskapie:

| Группа | Blocks | Blades | Масса | CG |
|---|---:|---:|---:|---|
| All | 230 | 37 | 95.300001 | (-0.030693,-1.320021,-0.060504) |
| Aircraft heuristic | 201 | 37 | 77.800001 | (0.000964,-2.466808,-0.177009) |
| Logic cube | 28 | 0 | 17.0 | (0,3.764395,0.412078) |
| Isolated LogicGate | 1 | 0 | 0.5 | (-6,4.250002,1.999999) |

Heuristic не доказывает физическую disconnectedness logic cube.

## 8. Mass model и CG

Mass provenance:

```text
prefab-verified
block-specific-override
runtime-required
unknown
```

Default массы извлечены по цепочке `BlockPrefabContainer.Info.ID → root GameObject → Rigidbody.m_Mass`. Из 103 entries 101 имеют root Rigidbody; BuildNode 71 и BuildEdge 72 не имеют.

Для большинства blocks COM приблизительно равен block.position и помечен `runtime-required`.

Overrides:

- WoodenPole 41, `bmt-version>0,length=1`: mass 0.25.
- Log 63, `bmt-version>0,length=2`: mass 0.6499999761581421.
- BuildSurface 73: prefab fallback, runtime mass зависит от generated colliders/material density.
- Spring/Rope: midpoint endpoints для COM, root mass fallback; child bodies неизвестны.
- RSM: override только при `bmt-SimpleSet=true`, `bmt-Forcemass=true` и валидном `bmt-RNFmass`.

CG:

```text
CG = Σ(m_i * c_i) / Σm_i
```

Unknown masses не выдумываются и не входят в сумму.

Point-mass inertia:

```text
Ixx = Σm(y²+z²)
Iyy = Σm(x²+z²)
Izz = Σm(x²+y²)
Ixy = -Σmxy
Ixz = -Σmxz
Iyz = -Σmyz
```

Она диагностическая, не является Unity inertiaTensor и не используется для angular acceleration.

Универсального правила `mass ∝ scale.x*scale.y*scale.z` нет.

## 9. Лопасти: положение, ориентация и параметры

### 9.1 Распознавание

`extractVanillaBlades()` выбирает:

```text
id == 26 → Propeller
id == 55 → SmallPropeller
```

`flipped` берётся из `Boolean key="flipped"`. Если ключ отсутствует, используется `false`, а `flippedWasSerialized=false`.

### 9.2 Параметры Besiege 1.90-25346

| Параметр | ID 26 | ID 55 |
|---|---:|---:|
| lift/sense angle | 23.068759° | 22.844994° |
| `AxisDrag.y` | 0.015 | 0.015 |
| velocity cap | 30 | 30 |
| default mass | 0.3 | 0.3 |

### 9.3 Position

Физическая точка лопасти:

```text
x_i = blade.position
```

Используется block-root position из `.bsg`. Это приближение: vanilla force фактически прикладывается к Rigidbody, а точный runtime center of mass может не совпасть с root.

### 9.4 Force axis

```text
localY = (0,1,0)
forceAxis = normalize(Q_block * localY)
```

Scale к направлению не применяется, что соответствует Unity `TransformDirection`.

### 9.5 Sense axis

Для normal blade:

```text
senseAxis = normalize(Q_block * RotZ(+theta) * localY)
```

Для `flipped=true`:

```text
senseAxis = normalize(Q_block * RotZ(-theta) * localY)
```

`flipped` меняет senseAxis, но не forceAxis. Large/small blade отличаются небольшим углом.

### 9.6 Visual orientation отдельно от physics

Visual transform chain:

```text
Machine Global
  * BSG block TRS
  * extracted prefab child transforms
  * runtime Vis.localRotation
```

Для visual child Besiege `CheckFlipDirection()` приблизительно задаёт:

```text
normal:  Vis.localEulerAngles ≈ (0,-180°,-23°)
flipped: Vis.localEulerAngles ≈ (0,-180°,+23°)
```

Visual mesh rotation не используется в blade force law. Sense axis отображается отдельной physics overlay. Collider geometry также не является visual orientation.

## 10. Vanilla blade physics

Реализация: `evaluateBlade()` в `src/physics.ts`. Это восстановленный normal-air branch `AxialDrag.FixedUpdateBlock`, а не новая аэродинамика.

### 10.1 Скорость точки

```text
r_i = x_i - CG
u_i = V + ω × r_i
```

### 10.2 Speed cap

```text
s_i² = u_i · u_i
c_i = min(s_i²,30²) = min(s_i²,900)
```

Cap применяется к speed², не к velocity vector.

### 10.3 Force

```text
k_i = -0.015 * dot(u_i,senseAxis_i) * c_i
F_i = forceAxis_i * k_i
```

Полная форма:

```text
F_i = -0.015
      * dot(u_i,senseAxis_i)
      * min(|u_i|²,900)
      * forceAxis_i
```

Главная особенность Besiege: senseAxis и forceAxis отличаются примерно на 23°. Это не обычный drag, направленный точно против скорости.

До cap сила обычно кубически масштабируется с общим velocity scale. После `|u|=30` speed² зафиксирован на 900, и force становится линейной по projected velocity.

### 10.4 Moment и power

```text
M_i = r_i × F_i
P_i = F_i · u_i
P_blades = ΣP_i
```

Из-за несовпадения axes `P_i` может быть положительным: recovered game law допускает добавление энергии в некоторых ориентациях.

### 10.5 `bmt-Enhancement`

Флаг не изменяет coefficient. В исследованном BEM aero-enabled сохраняет vanilla AxisDrag, а aero-disabled обнуляет его. Analyzer по умолчанию считает enabled; What-if Disable исключает blade из solver.

## 11. BuildSurface geometry

Реализация: `reconstructBuildSurfaceGeometry()` в `src/build-surface-geometry.ts`.

### 11.1 Топология

BuildSurface 73 содержит строку `edges` с тремя или четырьмя GUID. Каждый GUID должен вести к BuildEdge 72. Edge содержит `start/end`, ведущие к BuildNode 71.

Ordering повторяет recovered `BuildSurface.UpdateNodes`. Если topology некорректна, surface пропускается с warning.

### 11.2 Straight/curved edges

Для edge:

```text
startMachine
endMachine
controlMachine = edge.position
```

Straight test:

```text
|control-midpoint|² < 0.0001
```

Curved edge строит Catmull-Rom path из extended tangent, start, control, end и второго extended tangent.

### 11.3 Surface grid

```text
width  = clamp(ceil(maxHorizontalLength * 1.5),5,11)
height = clamp(ceil(maxVerticalLength * 1.5),5,11)
```

Для straight rectangular surface grid сокращается до 1×1. Есть дополнительные оптимизации для согласованных curves и простых triangles.

### 11.4 Interpolation и normals

Triangle/quad используют transfinite/Coons-like interpolation. Для normals:

```text
n(u,v) = normalize(
  [p(u,v+0.05)-p(u,v)]
  ×
  [p(u+0.05,v)-p(u,v)]
)
```

Boundary samples немного сдвигаются внутрь.

### 11.5 Area

```text
A_cell = 0.5 * |(TR-BL) × (TL-BR)|
A = ΣA_cell
```

Area хранится до финального block TransformVector scale.

### 11.6 Application points

Несмотря на tessellated visual surface, physics forces прикладываются только в 3 corners triangle или 4 corners quad.

### 11.7 Material gating

Материал берётся из `bmt-surfMat` или `materialIndex`:

```text
0  → wood
>0 → glass
```

Surface активна только при `bmt-aero=true` и wood. Glass всегда даёт zero force.

## 12. BuildSurface physics

Реализация: `evaluateBuildSurface()` в `src/build-surface-physics.ts`.

Константы:

```text
wood multiplier = 0.0002500000118743628
speed² cap      = 90000
speed cap       = 300
```

Для corner:

```text
r_j = x_j - CG
u_j = V + ω × r_j
u_local = InverseTransformDirection(u_j)
d_j = dot(normal_j,-u_local)
c_j = min(|u_j|²,90000)
k = dragMultiplier * SurfaceArea / CornerCount
F_local,j = normal_j * d_j * c_j * k
F_j = TransformVector(F_local,j)
M_j = r_j × F_j
P_j = F_j · u_j
```

`InverseTransformDirection` применяет rotation без scale. `TransformVector` применяет scale, затем rotation.

Power суммируется per corner, а не как `F_total·V_CG`, потому что при вращении corner velocities различаются.

Поведение:

- parallel flow ≈ zero;
- front/back symmetric;
- cubic velocity scaling ниже 300;
- linear выше cap;
- no stall;
- no occlusion/raycast;
- no turbulence;
- no lift/drag decomposition;
- no fracture;
- no individual Rigidbody states.

## 13. Объединение sources

`solveAerodynamics()` вызывает blades и BuildSurfaces, затем:

```text
F_total = F_blades + F_surfaces
M_total = M_blades + M_surfaces
P_total = P_blades + P_surfaces
```

```text
Pitch = dot(M_total,right)   = Mx
Roll  = dot(M_total,forward) = Mz
Yaw   = dot(M_total,up)      = My
```

Результат хранит separate `bladeTotals`, `buildSurfaceTotals` и combined totals. Legacy `totalBladePower` сохранено, но total graphs должны использовать `totalPower`.

## 14. Stability и damping

Central difference:

```text
f'(x) ≈ [f(x+h)-f(x-h)]/(2h)
```

Defaults:

```text
alpha step = 1°
beta step  = 1°
rate step  = 0.01 rad/s
```

Static derivatives:

```text
dM_pitch/dAlpha
dM_yaw/dBeta
dM_roll/dBeta
dF/dAlpha
dF/dBeta
```

Damping:

```text
dM_roll/dp
dM_pitch/dq
dM_yaw/dr
```

Cross-rate:

```text
dM_pitch/dr
dM_pitch/dp
dM_yaw/dq
dM_yaw/dp
dM_roll/dq
dM_roll/dr
```

Units: `moment/radian`, `force/radian`, `moment/(rad/s)`.

Отрицательная соответствующая damping derivative означает opposing moment только в зафиксированной convention; это ещё не полная динамическая устойчивость.

### 14.1 Per-blade contributions

Поддержаны pitch/yaw/roll damping, pitch-alpha, yaw-beta. Для каждой blade центральной разностью вычисляется вклад её собственного projected moment. Rows сортируются по absolute contribution.

```text
share_i = 100 * D_i / D_total
```

Share signed и может выходить за 0–100% при cancellation.

Contribution table blade-only. Combined derivative может включать BuildSurface, но surface attribution в этой таблице отсутствует.

## 15. Sweeps

Default angle values:

```text
-15,-10,-5,0,+5,+10,+15 degrees
```

Default rate values:

```text
-0.50,-0.25,-0.10,0,+0.10,+0.25,+0.50 rad/s
```

Variables: alpha, beta, p, q, r.

Sweep values абсолютные, не offsets от operating point. Каждый point хранит total force/moment/power и separate blade/surface power.

UI создаёт automatic baseline при загрузке машины. Current пересчитывается, baseline остаётся. Sticky Y-domain строится по baseline, может расширяться, но не сжимается до загрузки новой машины.

Curve metrics:

- Center;
- central Slope;
- Range;
- Curvature;
- Slope variation.

```text
curvature = 2*(slopeRight-slopeLeft)/(xRight-xLeft)
```

## 16. Plot Lab и Turn Analysis

Plot inputs: speed, alpha, beta, p, q, r.

Outputs: Fx/Fy/Fz, roll/pitch/yaw moments, total aerodynamic power и основные derivatives.

1D raw output делает solve на каждый sample. Derivative output делает полный stability analysis на каждой точке.

2D grid поддерживает raw quantities, но не derivative heatmaps. Limit — 10 000 cells.

Turn Analysis:

```text
X = speed
Y = q
Value = pitch moment
```

Для каждого speed линейно интерполируется zero crossing `M_pitch(V,q)=0`. При нескольких crossings выбирается ближайший к reference q.

```text
q_eq_deg_s = q_eq * 180/pi
R = |V|/|q_eq|
```

Это quasi-steady blade-model estimate. Он не моделирует bank dynamics, gravity, force balance, control input, inertia, trajectory или sustained turn. Если crossing отсутствует, результат N/A; при q≈0 finite radius отсутствует.

## 17. What-if model

```ts
interface BladeWhatIfOverride {
  guid;
  flipped?;
  positionOffset;
  rotationOffsetDegrees;
}
```

Position:

```text
x' = x + Δx
```

Rotation tuple использует X=pitch, Y=yaw, Z=roll. Extrinsic quaternion:

```text
Q_delta = Q_Z * Q_Y * Q_X
Q' = Q_delta * Q_block
```

Flip подменяет `flipped` в виртуальной booleans map.

`applyBladeWhatIfOverrides()` не мутирует source BSG, меняет только ID 26/55 и возвращает virtual machine. Затем она идёт в обычный `analyzeMachine()`, поэтому изменения проходят в axes, forces, moments, `ω×r`, power, auto CG, derivatives, sweeps, Plot Lab, Turn Analysis, compare и 3D.

Тонкость: component discovery выполняется до What-if. Большое перемещение blade меняет physics position и approximate mass CG, но не пересобирает component membership heuristic.

## 18. Blade Groups и Snapshots

BladeGroup — именованный набор GUID. Он не создаёт новый physics object, а используется для selection, batch enable/disable, batch What-if и summary.

Summary включает force, moment, roll/pitch/yaw, blade power и derivative contributions. Missing GUIDs возвращаются как warnings, не вызывая crash.

Snapshot хранит configuration, не results:

```ts
interface AnalysisSnapshot {
  id;
  name;
  note;
  createdAt;
  state;
}
```

State содержит mode, active machine, operating point, Plot Lab, delta settings, AnalysisGroup, disabled blades, Blade Groups и What-if. При Restore/Compare solver запускается заново. `.bsg` в snapshot не хранится.

## 19. JSON export

Современная схема:

```text
format = besiege-aero-analyzer-analysis
analysisVersion = 0.5.0-ui-poc
```

Export включает дату, mode, convention, assumptions, UI/Plot Lab state, snapshots и для каждой машины:

- metadata;
- selected AnalysisGroup;
- mass/CG/provenance;
- blade counts, disabled GUIDs, groups и What-if;
- BuildSurface results/corners;
- operating point, V и ω;
- finite-difference steps;
- baseline totals;
- separate blade/surface totals;
- derivatives;
- sweeps;
- component diagnostics.

Исходная block geometry `.bsg` в analysis export не встраивается.

## 20. `escape-run.json` и `escape-run.txt`

Оба файла существуют локально, игнорируются patterns `*-run.json` и `*-run.txt` и не являются автоматическими logs. Они созданы перенаправлением CLI output.

### 20.1 `escape-run.txt`

Старый human-readable run Eskapie. Содержит machine/path/version, Global, counts, V/ω/CG/axes, а для каждой из 37 blades — type, ID, GUID, flipped, transform, radius, local velocity, axes, force, moment и F·v. В конце totals.

Сохранённый state:

```text
V=(0,0,100)
ω=(0,0,0)
CG=(0,0,0)

force=(2.803082,76.572072,125.984096)
moment=(-465.757870,4.695389,3.143930)
pitch=-465.757870
roll=3.143930
yaw=4.695389
blade power=12598.409641
```

В имени/path заметен mojibake старой console encoding.

### 20.2 `escape-run.json`

Top-level `machine` и `result`. Machine содержит parsed blocks/maps; result — raw input, axes, per-blade outputs и totals.

Это устаревший blade-only snapshot: в нём нет mass/group integration, BuildSurface, derivatives, sweeps и современной export schema. Его нельзя считать authoritative текущим форматом.

## 21. Mesh и геометрия блоков

### 21.1 Чего нет в `.bsg`

`.bsg` не содержит vertices, normals, indices, visual child transforms, textures/materials, colliders, local COM или joint geometry.

### 21.2 Geometry-only cache

Desktop может извлечь meshes из локальной Besiege в:

```text
%LOCALAPPDATA%\com.yarick.besiege-aero-analyzer\mesh-cache\1.90-25346\
  manifest.json
  vanilla-blocks.glb
```

Cache не входит в Git/installer.

Extractor идёт по цепочке:

```text
BlockPrefabContainer ID
→ prefab root
→ child hierarchy
→ MeshRenderer/SkinnedMeshRenderer
→ MeshFilter/Mesh
```

Сохраняет positions, normals, indices, submeshes и child transforms. Textures, materials, shaders и colliders не сохраняются.

### 21.3 Coverage/policy

91 из 103 IDs извлекаются static-prefab путём.

Procedural/fallback:

| ID | Причина |
|---:|---|
| 7 Brace | serialized endpoints |
| 9 Spring | endpoints/runtime extension |
| 16 Suspension | runtime extension |
| 18 Piston | runtime extension |
| 45 RopeWinch | endpoints/runtime length |
| 71 BuildNode | construction topology |
| 72 BuildEdge | GUID endpoints |
| 73 BuildSurface | procedural surface |
| 75 RopeMeasure | endpoints |
| 78 Sail | deformation |
| 96 FuelLine | runtime connection |
| 97 Parachute | packed/deployed state |

WoodenPole 41 и Log 63 имеют full/short variants; Slider 42 использует `/Slider/Vis`; Harpoon 84 — стабильную `/Harpoon/Vis` hierarchy.

### 21.4 Schematic fallback

Без cache structural blocks становятся boxes, round — cylinders/spheres, surfaces — flat primitives, endpoints — segments. BuildSurface рисуется из той же reconstructed geometry. BuildNode 71 — чёрный cube 0.285051³.

Это только visualization. Solver не берёт physics из schematic shape.

### 21.5 Unity → Three.js

Численные Unity XYZ/quaternions сохраняются в общей basis. TRS умножается иерархически, Euler angles вручную не складываются. Negative scale остаётся на block root.

## 22. Runtime exporter

`RUNTIME_EXPORTER.md` описывает будущий in-game C# exporter; он не реализован.

### 22.1 Зачем нужен

Static BSG/assets не дают точных runtime masses, COM, inertia, child Rigidbody, joints, physical components, collider state, break/detach и per-body velocities.

### 22.2 Минимальные данные

Для block:

- GUID, ID/type;
- instance ID и hierarchy path;
- все Rigidbody;
- mass, centerOfMass, worldCenterOfMass;
- inertiaTensor, inertiaTensorRotation;
- isKinematic, detectCollisions, active state;
- colliders и attachedRigidbody;
- joints, connectedBody, breakForce/torque;
- physical component membership;
- game version и Assembly hash.

Machine-local COM:

```csharp
machineRoot.InverseTransformPoint(rb.worldCenterOfMass)
```

### 22.3 Physical graph

Вершина — Rigidbody instance ID. Union выполняется по active Joint с non-null connectedBody. Нельзя автоматически объединять все bodies одного block, касающиеся colliders или близкие roots. Null connectedBody означает joint к world.

Exporter позволит доказать status logic cube, учесть child bodies Spring/Rope, получить runtime BuildSurface mass, exact COM/inertia и per-body velocities. Но сам по себе он не создаёт multibody simulation.

## 23. Источники и provenance

| Данные | Источник | Статус |
|---|---|---|
| Block transforms, ID, GUID | `.bsg` | exact serialized |
| `flipped` | `.bsg` | exact mapper value |
| BuildEdge/Surface links | `.bsg` | exact explicit links |
| BuildSurface toggle/material | `.bsg` | exact serialized |
| Blade coefficients/caps | code + prefabs | verified 1.90-25346 |
| Blade angles | prefab transforms | verified 1.90-25346 |
| BuildSurface formula | reversed Assembly code | verified 1.90-25346 |
| Default masses | prefab Rigidbody | prefab-verified |
| Pole/log/RSM overrides | game/mod code | verified for inspected versions |
| Visual meshes/children | Unity assets | exact supported static geometry |
| BuildSurface generated geometry | BSG + recovered code | reconstructed/verified algorithm |
| Runtime COM/inertia/joints | unavailable | exporter required |
| Component membership | proximity heuristic | heuristic |
| Per-body velocities | aggregate rigid approximation | approximate |
| Damage/broken state | unavailable | runtime required |

Текущая программа не получает данные из уже запущенной игры: она читает `.bsg` и offline installed assets.

## 24. Уровни точности

### VERIFIED для 1.90-25346

- BSG root transforms;
- blade IDs/flipped;
- blade coefficients/cap/angles/law;
- BuildSurface coefficient/cap/material gate/corner law;
- explicit topology links;
- vector/moment/power aggregation;
- finite differences;
- fixed axes;
- prefab masses;
- static prefab mesh extraction.

### Reconstructed с высокой уверенностью

- BuildSurface triangle/quad ordering;
- straight/curved edges;
- tessellation, area, normals;
- procedural visual surface.

### Approximate

- aggregate rigid velocity field;
- blade point at root;
- CG via root fallback;
- point inertia;
- BuildSurface runtime mass;
- Spring/Rope topology;
- aircraft component;
- all CG-dependent moments/derivatives.

### Heuristic

- spatial component graph;
- suggested aircraft;
- logic cube exclusion;
- schematic geometry.

### Runtime required

- exact joints/components;
- runtime COM/inertia/masses;
- child body velocities;
- control deflection;
- break/damage/collider/kinematic states.

## 25. Известные ограничения и возможные ошибки

1. Parser lossless не является; mod metadata и многие XData теряются.
2. Aero поддерживает только ID 26/55 и active wood 73.
3. `V+ω×r` не воспроизводит flex/hinge/joint/detached body motion.
4. Blade force point равен root, не runtime COM.
5. Approximate CG влияет и на moment arms, и на point velocities.
6. Unknown mass не выдумывается, но total может быть занижен.
7. Proximity heuristic может соединить независимое или разделить связанное.
8. BuildSurface unusual scale требует runtime проверки.
9. Surface selected group может использовать topology helpers из полной машины.
10. Material mapping version-specific.
11. Finite differences чувствительны к step/caps/nonlinearities.
12. Negative damping derivative не означает автоматически full stability.
13. Blade contributions не включают surfaces.
14. Sweeps абсолютные, не offsets.
15. Turn estimate не является sustained turn performance.
16. Visual mesh не является physics collider database.
17. Modded blocks/aero в общем случае unsupported.
18. What-if разрешает floating/intersecting/unattached blades.
19. Optimizer может эксплуатировать positive F·v и невозможные lever arms.
20. Snapshot не содержит machine geometry.
21. Runtime/animated visual states неполны.

## 26. Что уже реализовано

- BSG stable-subset parser и real-machine loading;
- ID 26/55 detection;
- recovered blade law, flipped, `V+ω×r`, force/moment/power;
- BuildSurface geometry и physics;
- separate blade/surface/total results;
- versioned mass database и confirmed overrides;
- approximate CG и point inertia;
- AnalysisGroup all/include/exclude/aircraft heuristic;
- static, damping, cross-rate и force derivatives;
- standard sweeps и arbitrary Plot Lab;
- zero contours и Turn Analysis;
- per-blade contributions;
- compare;
- Blade Groups;
- disable/enable;
- What-if flip/move/rotate;
- snapshots storing configuration;
- JSON/CSV workflow;
- extracted vanilla meshes и procedural fallback;
- 3D force/contribution visualization;
- browser, Tauri, CLI;
- RU/EN и Tutorial.

## 27. Что задумано, но не реализовано

- lossless full BSG parser;
- BSG writer и generation;
- robust modded identity `(modId,localId,fallback)`;
- runtime exporter;
- exact Rigidbody graph/components/COM/inertia;
- angular acceleration и time integration;
- full translational dynamics;
- gravity, thrust, fuel;
- hinge/control actuation;
- joint compliance и multibody;
- breakage/damage;
- aero laws остальных blocks;
- SI conversion;
- exact colliders;
- textures/materials/skins;
- local-space What-if;
- automatic design optimizer.

## 28. Ключевые структуры

| Структура | Файл | Назначение |
|---|---|---|
| `BsgBlock` | `src/bsg.ts` | parsed block |
| `BsgMachine` | `src/bsg.ts` | parsed machine |
| `VanillaBlade` | `src/bsg.ts` | ID 26/55 + flipped |
| `AnalysisGroup` | `src/groups.ts` | selected blocks |
| `ComponentSuggestion` | `src/groups.ts` | heuristic components |
| `BlockMassContribution` | `src/mass.ts` | block mass/COM/provenance |
| `MassAnalysis` | `src/mass.ts` | mass, CG, inertia |
| `SolverInput` | `src/physics.ts` | V, ω, CG, axes |
| `BladeResult` | `src/physics.ts` | per-blade physics |
| `BuildSurfaceGeometry` | `src/build-surface-geometry.ts` | procedural surface |
| `BuildSurfaceCornerResult` | `src/build-surface-physics.ts` | per-corner physics |
| `AerodynamicSolverResult` | `src/aerodynamics.ts` | source and total results |
| `AnalysisState` | `src/analysis.ts` | operating point |
| `StabilityAnalysis` | `src/analysis.ts` | baseline + derivatives |
| `MachineAnalysis` | `src/analysis.ts` | group/mass/aero/stability |
| `BladeDerivativeContribution` | `src/analysis.ts` | blade attribution |
| `Plot1DResult`/`Plot2DResult` | `src/plot-lab.ts` | arbitrary sweeps |
| `BladeWhatIfOverride` | `src/what-if.ts` | virtual mutation |
| `BladeGroup` | `src/session-state.ts` | GUID group |
| `AnalysisSnapshot` | `src/session-state.ts` | saved configuration |
| `UiAnalysisBundle` | `src/ui-model.ts` | UI-independent package |

## 29. Реальная валидация Eskapie/Gripen

Operating point:

```text
speed=100
alpha=beta=0
p=q=r=0
group=aircraft heuristic
```

| Значение | Eskapie | Gripen2 |
|---|---:|---:|
| Machine blocks | 230 | 318 |
| Selected blocks | 201 | 279 |
| Approx. mass | 77.800001 | 82.400000 |
| Blades | 37 | 43 |
| Propeller / Small | 14 / 23 | 0 / 43 |
| dM_roll/dp | -2305.391 | -2862.446 |
| dM_pitch/dq | -1697.458 | -3346.379 |
| dM_yaw/dr | -1146.789 | -1386.097 |

Гипотеза о более сильном rotational damping Eskapie в recovered model не подтвердилась: у Gripen magnitudes всех трёх main derivatives выше.

BuildSurfaces:

```text
Eskapie: 6 reconstructable, 0 active
Gripen:  16 reconstructable, 0 active
```

Поэтому их documented results остаются blade-only.

## 30. Производительность

Пусть N=blocks, B=blades, S=active surfaces.

```text
one solve: O(B + 4S)
component heuristic: O(N²)
```

`analyzeStability()` делает 11 solves: baseline и ± perturbation для alpha, beta, p, q, r.

Standard 7-point sweep — 7 solves.

`buildUiAnalysis()` приблизительно делает:

- 11 stability solves;
- 5 contribution analyses × 3 = 15;
- 5 sweeps × 7 = 35;

Всего около 61 solver evaluations на update, без Plot Lab. Для десятков blades это дёшево, но AI optimizer должен вызывать компактный evaluator только с нужными objectives.

# Что из этого проекта можно использовать для AI-системы, которая автоматически проектирует и оптимизирует самолёты Besiege

## 31. Готовая база

### 31.1 Быстрый deterministic evaluator

`solveAerodynamics()` — чистое отображение:

```text
geometry/configuration + operating state
→ forces/moments/power
```

Подходит для evolutionary/Bayesian optimization, random search, hill climbing, Pareto search, dataset generation и surrogate models.

### 31.2 Objectives

Доступны:

- mass и CG;
- Fx/Fy/Fz;
- roll/pitch/yaw moments;
- blade/total power;
- static/damping/cross derivatives;
- sweep center/slope/range/curvature;
- q_eq и quasi radius;
- per-blade contributions.

Возможные задачи:

```text
maximize |dM_pitch/dq| under mass limit
minimize baseline pitch moment
minimize yaw/roll coupling
maximize desired control moment
minimize positive power
maximize damping across speeds
keep CG in target region
minimize alpha/beta sensitivity
```

Нужна multiobjective/Pareto optimization, а не один скрытый score.

### 31.3 Attribution как guided mutation

Per-blade contributions показывают доминирующие и мешающие blades, а также cancellation. AI может приоритизировать mutations именно этих элементов и сохранять симметричные пары.

### 31.4 What-if как design genome

Текущее пространство:

```text
GUID
enabled/disabled
flipped
Δposition
Δrotation
```

Пример candidate:

```json
{
  "blade-guid-1": {
    "flipped": true,
    "positionOffset": [0,0,1.5],
    "rotationOffsetDegrees": [5,0,0]
  }
}
```

Candidate применяется через `applyBladeWhatIfOverrides()` и оценивается тем же solver.

### 31.5 Blade Groups

Группы можно использовать как variables для symmetric pairs, nose/tail arrays и control/damping sets. Нужны symmetry-aware mutations: mirrored positions/rotations, paired flip и group constraints.

### 31.6 Robust fitness по sweeps

Не следует оптимизировать только `speed=100,alpha=0`. Plot Lab позволяет считать grids speed×alpha, speed×q, beta×r.

```text
J = Σ_V w_V * (|M_pitch(V,0)| + λ*max(0,dM_pitch/dq))
```

### 31.7 Provenance-aware fitness

Каждый результат должен сопровождаться:

```text
fitness value
confidence
warnings
runtime-validation-required
```

## 32. Рекомендуемый AI pipeline

```text
Seed .bsg
  ↓
Lossless MachineModel
  ↓
Design constraints / symmetry
  ↓
Candidate mutation
  ↓
Static geometry validation
  ↓
Fast Aero Analyzer evaluation
  ↓
Mass/CG/aero/damping objectives
  ↓
Constraint penalties
  ↓
Pareto archive
  ↓
Runtime exporter validation
  ↓
Besiege in-game test
  ↓
Update calibration/surrogate
```

## 33. Что можно оптимизировать сейчас

- enable/disable existing blades;
- flipped;
- небольшие position/rotation offsets;
- subset selection;
- damping/static balance;
- coupling;
- contribution distribution;
- robustness по speeds/angles/rates.

Это оптимизация recovered blade/BuildSurface model, а не полной Besiege machine.

## 34. Что пока нельзя надёжно оптимизировать

- structural validity: нужны attachment rules, colliders, overlaps, joints;
- real controls: нужны moving subassemblies, hinges, limits/speed/deflection;
- angular response: нужны exact inertia и time integration;
- survival: нужны loads, break limits, flex и topology;
- complete flight: нужны gravity, thrust, fuel, other aero, translation и trajectory.

## 35. Model exploitation risk

Optimizer найдёт positive F·v, floating blades, huge lever arms, overlaps, impossible CG shifts и configurations, разрушающиеся в игре.

Необходимы constraints:

```text
position/rotation bounds
symmetry
attachment feasibility
no overlaps
maximum moment arm
mass/CG bounds
power bounds
runtime validation
```

Confidence weighting:

```text
verified result       → full weight
approximate CG        → reduced confidence
heuristic component   → validation required
unknown runtime joint → not production-ready
```

## 36. Что нужно для генерации новых `.bsg`

1. Lossless XML parser.
2. Unknown attributes, mod IDs, skins, all XData, bindings, machine data.
3. BSG writer и round-trip tests.
4. GUID generation.
5. Attachment/collider validation.
6. Creation/deletion of blocks и procedural topology mutations.
7. Runtime exporter.
8. End-to-end Besiege validation.

Сейчас AI может оптимизировать только virtual modifications существующей машины.

## 37. Самые ценные компоненты для AI

1. `solveAerodynamics()` — evaluator.
2. `analyzeStability()` — objectives.
3. `analyzeBladeContributions()` — attribution.
4. `evaluatePlot1D/2D()` — robustness.
5. `applyBladeWhatIfOverrides()` — mutations.
6. Mass/CG model — constraints.
7. AnalysisGroup — aircraft isolation.
8. BuildSurface reconstruction — future surface optimization.
9. Snapshots/export — reproducible experiments.
10. Versioned provenance — version safety.

## 38. Практический итог

Проект уже подходит как быстрый low-fidelity evaluator для оптимизации существующих vanilla blades и active BuildSurfaces.

Он не подходит как единственный источник истины для генерации гарантированно летающих и физически реализуемых машин.

Правильная архитектура:

```text
Analyzer:
массовый быстрый search и ranking

Runtime exporter:
точная mass/COM/joints/components validation

Besiege:
финальная проверка и calibration data
```

Сильные стороны — recovered game-specific laws, скорость, per-element attribution и reproducible sweeps. Слабые — отсутствие полного physical graph, других aero sources и dynamics over time.
