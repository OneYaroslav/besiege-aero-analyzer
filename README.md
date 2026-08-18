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
- analytical blade enable/disable what-if mode;
- simple Three.js engineering view;
- browser development mode and native Windows desktop packaging through Tauri 2.

The physics formulas live only in the shared core. React components do not contain a second aerodynamic implementation.

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
src-tauri/target/release/bundle/nsis/Besiege Aero Analyzer_0.1.0_x64-setup.exe
```

Native desktop JSON/CSV operations use Windows Open/Save dialogs. All calculations remain local; the production executable does not start a Vite server.

More details: [DESKTOP.md](DESKTOP.md).

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
test/                   core, analysis, import/export, and UI-independent tests
data/                   versioned Besiege mass database
src-tauri/              Tauri 2 desktop wrapper, permissions, icons, and build config
tools/                  mass-extraction utility
FEASIBILITY.md          reverse-engineering feasibility study
ANALYSIS.md             conventions and numerical comparison results
UI.md                   UI architecture, operation, and limitations
DESKTOP.md              Windows desktop development and release instructions
RUNTIME_EXPORTER.md     future runtime-exporter data contract
```

## Model limitations

- Aircraft/component grouping is spatial and explicitly marked `HEURISTIC`; it is not a reconstructed runtime joint graph.
- CG is approximate where runtime `Rigidbody.centerOfMass` or mass overrides are unavailable.
- There is no SI conversion, exact inertia response, angular acceleration, control-surface actuation, joint simulation, or multibody dynamics.
- The Three.js view uses engineering placeholders rather than proprietary Besiege meshes.
- Imported CSV datasets are visualization-only and do not affect the solver.
- Re-importing a 2D `x,y,value` CSV as a heatmap is not implemented yet.

The intended next step for exact physical-component membership is the runtime exporter described in [RUNTIME_EXPORTER.md](RUNTIME_EXPORTER.md), not an invented static joint graph.

## Game data

The repository does not include Besiege game binaries or proprietary meshes. Real `.bsg` machines remain user-supplied local inputs. Reference output files in the repository document analyzer runs but are not substitutes for the original machine files.
