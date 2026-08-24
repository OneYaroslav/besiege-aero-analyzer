# Besiege Aero Analyzer

Local engineering software for analyzing aerodynamic blade machines saved as Besiege `.bsg` files.

The project parses machine files, applies the recovered vanilla `Propeller` (`id=26`) and `SmallPropeller` (`id=55`) force model, and calculates forces, moments, power, stability derivatives, rotational damping, sweeps, mass-model CG, and per-blade contributions. It includes a React/Vite engineering UI, a Tauri 2 Windows desktop wrapper, and a CLI built on the same calculation core.

> Research status: this is an independent analysis tool, not an official Besiege product. Values are reported in game units unless a conversion is explicitly verified.

## Highlights

- local `.bsg` parsing with no file upload;
- recovered Besiege 1.90-25346 normal-air AxialDrag law;
- vanilla blade detection, including position, quaternion rotation, scale, and `flipped`;
- per-blade force, moment about CG, and `F·v`;
- versioned mass database and approximate automatic CG;
- explicit all/include/exclude analysis groups and a clearly marked aircraft heuristic;
- static stability and rotational damping derivatives;
- alpha, beta, roll-rate, pitch-rate, and yaw-rate sweeps;
- per-blade derivative contribution analysis;
- Single and Compare modes;
- Plot Lab with configurable 1D plots and 2D heatmaps;
- external CSV overlays and JSON analysis-state restore;
- extended GUID-based What-if Lab: enable/disable, virtual flip, move and aircraft-axis rotation offsets without editing the source `.bsg`;
- GUID-based Blade Groups synchronized with the Blade Table and 3D Inspector;
- configuration Snapshots with restore, duplication and numerical state-to-state delta comparison;
- Three.js 3D Inspector with selection, physics overlays and an optional locally extracted geometry-only vanilla mesh cache;
- browser development mode and native Windows desktop packaging through Tauri 2.
- bundled 22-step interactive tutorial covering the program purpose, Components/Analysis Group, current state, static and damping response, five standard sweeps, 3D Inspector, Blade Groups, Snapshots and What-if workflow.

The physics formulas live only in the shared core. React components do not contain a second aerodynamic implementation.

What-if transforms are applied to a virtual `BsgMachine` before the shared mass/group/aero analysis. The resulting blade position, quaternion and flipped state therefore propagate through baseline forces/moments, derivatives, standard sweeps, Plot Lab, Compare, contributions, Snapshots and the 3D Inspector from one source of truth.

## Coordinate convention

Machine-local axes are fixed as:

- forward: `+Z`;
- up: `+Y`;
- right: `+X`;
- roll rate `p`: about `+Z`;
- pitch rate `q`: about `+X`;
- yaw rate `r`: about `+Y`.

See [ANALYSIS.md](ANALYSIS.md) for derivative definitions, units, assumptions, and the Escape/Gripen comparison. The reconstruction evidence is documented in [FEASIBILITY.md](FEASIBILITY.md).

## Windows desktop application

Development prerequisites:

- Node.js 24+;
- pnpm or npm;
- Rust stable with the `x86_64-pc-windows-msvc` target;
- Visual Studio C++ Build Tools with a Windows SDK;
- Microsoft Edge WebView2 Runtime.

Install dependencies and launch the desktop development build:

```powershell
pnpm install
.\run-desktop.ps1
```

Build the standalone executable and NSIS installer:

```powershell
.\build-desktop.ps1
```

Artifacts are produced locally under:

```text
src-tauri/target/release/besiege-aero-analyzer.exe
src-tauri/target/release/bundle/nsis/Besiege Aero Analyzer_0.5.0_x64-setup.exe
```

Native desktop JSON/CSV operations use Windows Open/Save dialogs. All calculations remain local; the production executable does not start a Vite server.

More details: [DESKTOP.md](DESKTOP.md).

### Optional real block geometry

The desktop Inspector can use the original geometry of 91 verified vanilla block prefabs without textures or game materials, including Slider and exact full/short WoodenPole and Log meshes. The cache is extracted from the user's own Besiege 1.90-25346 installation and stays outside both Git and the installer:

```powershell
.\extract-mesh-cache.ps1
```

See [MESH_CACHE.md](MESH_CACHE.md) for the format, source hashes, supported IDs and procedural fallback policy. Browser mode remains usable with schematic geometry when the local cache is unavailable.

## Browser development mode

```powershell
pnpm install
pnpm dev
```

On Windows, the convenience launcher also locates the bundled Codex Node runtime when ordinary Node.js is not in `PATH`:

```powershell
.\run-ui.ps1
```

Open the local URL printed by Vite, then drag a `.bsg` file into the loader or use **Open .bsg**.

## CLI

Basic analysis:

```powershell
.\run.ps1 --bsg "C:\path\machine.bsg" --v 0,0,100 --omega 0,0,0 --cg auto
```

Stability analysis and JSON output:

```powershell
.\run.ps1 --bsg "C:\path\machine.bsg" --analyze-stability --speed 100 --json
```

Compare two machines at the same operating point:

```powershell
.\run.ps1 --compare "C:\path\machine-a.bsg" "C:\path\machine-b.bsg" --mass-group aircraft-heuristic --analyze-stability
```

Full CLI and physics-PoC notes: [POC.md](POC.md).

## Tests and builds

```powershell
pnpm test
pnpm typecheck
pnpm build
pnpm desktop:build
```

The real-machine integration test uses `BESIEGE_BSG_FIXTURE` when supplied. On the original development installation it falls back to the local `Проект Ескапе.bsg`; on other systems it is skipped when that file is unavailable.

## Repository layout

```text
src/                    parser, mass/group model, physics, analysis, Plot Lab, CLI
ui/                     React engineering interface and browser/Tauri file adapter
locales/                bundled i18next resources split by UI namespace
public/tutorial/        bundled tutorial BSG fixture and provenance manifest
test/                   core, analysis, import/export, and UI-independent tests
data/                   versioned Besiege mass database
src-tauri/              Tauri 2 desktop wrapper, permissions, icons, and build config
tools/                  mass/bounds/geometry extraction utilities
FEASIBILITY.md          reverse-engineering feasibility study
ANALYSIS.md             conventions and numerical comparison results
UI.md                   UI architecture, operation, and limitations
TUTORIAL.md             guided walkthrough architecture and bundled fixture
DESKTOP.md              Windows desktop development and release instructions
MESH_CACHE.md           local geometry-only prefab cache and fallback policy
RUNTIME_EXPORTER.md     future runtime-exporter data contract
```

## Model limitations

- Aircraft/component grouping is spatial and explicitly marked `HEURISTIC`; it is not a reconstructed runtime joint graph.
- CG is approximate where runtime `Rigidbody.centerOfMass` or mass overrides are unavailable.
- There is no SI conversion, exact inertia response, angular acceleration, control-surface actuation, joint simulation, or multibody dynamics.
- The desktop 3D Inspector uses local geometry-only vanilla prefab meshes when the cache exists; procedural/runtime-dependent IDs and browser mode use engineering fallbacks. Textures, materials, skins and modded meshes are not extracted.
- Imported CSV datasets are visualization-only and do not affect the solver.
- Re-importing a 2D `x,y,value` CSV as a heatmap is not implemented yet.
- What-if Move/Rotate currently uses machine/aircraft axes only (`+X` pitch/right, `+Y` yaw/up, `+Z` roll/forward). Local-space editing, 3D gizmos and writing modified geometry back to `.bsg` are intentionally out of scope.

The intended next step for exact physical-component membership is the runtime exporter described in [RUNTIME_EXPORTER.md](RUNTIME_EXPORTER.md), not an invented static joint graph.

## Game data

The repository does not include Besiege game binaries or proprietary meshes. The optional generated GLB lives under `%LOCALAPPDATA%\com.yarick.besiege-aero-analyzer\mesh-cache\1.90-25346` and is never bundled. Real `.bsg` machines remain user-supplied local inputs. Reference output files in the repository document analyzer runs but are not substitutes for the original machine files.
