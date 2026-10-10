# Besiege Aero Analyzer Desktop (Tauri 2)

Desktop package is a thin Tauri 2 shell around the existing React/Vite application. It does not contain a second UI or a second implementation of the physics formulas. Production loads the compiled `dist/` files directly from the application bundle; no localhost server is started.

## Development prerequisites

Windows x64 development requires:

- Node.js 24+ and installed packages from `package.json`;
- Rust stable `x86_64-pc-windows-msvc`;
- Microsoft Visual Studio C++ Build Tools with Desktop development with C++ and a Windows SDK;
- Microsoft Edge WebView2 Runtime.

Install JavaScript dependencies once with:

```powershell
npm install
```

The existing browser development mode remains unchanged:

```powershell
.\run-ui.ps1
```

## Desktop development

Run the Tauri development window and Vite together:

```powershell
.\run-desktop.ps1
```

Equivalent command when Node/npm are in `PATH`:

```powershell
npm run tauri dev
```

`run-desktop.ps1` also finds the bundled Codex Node runtime and the user-local Cargo installation on this workstation.

## Release build

Build the frontend, standalone release executable and NSIS installer:

```powershell
.\build-desktop.ps1
```

Equivalent command:

```powershell
npm run tauri build
```

Release artifacts:

- portable/direct executable: `src-tauri\target\release\besiege-aero-analyzer.exe`;
- NSIS installer: `src-tauri\target\release\bundle\nsis\Besiege Aero Analyzer_0.5.0_x64-setup.exe`.

The direct executable can be started without installation on a Windows system with WebView2. The NSIS package installs for the current user and checks/downloads WebView2 when needed. Neither artifact is code-signed in this PoC, so Windows SmartScreen may show an unknown-publisher warning.

The Setup wizard is available in English and Russian. It creates an application entry and uninstaller, a Start Menu shortcut inside the `Besiege Aero Analyzer` folder, and offers a Desktop shortcut on its final page. The installed application contains the compiled frontend inside the executable; it does not install Node.js, pnpm, Rust, Python, source files, tests or build caches.

## Safe development cleanup

Cargo compiler output is the main source of workspace size. Run:

```powershell
.\clean-dev.ps1
```

The default cleanup removes Rust debug and release compiler intermediates while preserving the ready-to-send release executable and NSIS Setup. It also preserves `node_modules`, `.tools`, `dist`, `.pnpm-store` and the local game mesh cache.

For a clean rebuild and maximum temporary space recovery:

```powershell
.\clean-dev.ps1 -AllBuildArtifacts -WebDist -PackageStore
```

All of those targets are regeneratable. `.tools` is removed only with the explicit `-ToolCache` switch because it contains the local reverse-engineering/extraction toolchain. The script validates every deletion target against the project directory before removing it.

## Desktop behavior

- Window title: Besiege Aero Analyzer.
- Default size: 1400×900; minimum size: 1024×680; normal resizable Windows frame.
- HTML5 drag-and-drop remains enabled for `.bsg` files on Windows (`dragDropEnabled=false` disables Tauri's competing native drop handler).
- Open `.bsg` continues to use the existing local file input and works in browser and WebView2 modes.
- Analysis JSON and Plot Lab JSON/CSV exports use native Windows **Save As** dialogs in desktop mode. JSON/CSV imports use native Windows **Open** dialogs.
- The same actions keep browser-mode file-picker/download fallbacks; React components use one shared file-I/O adapter rather than Tauri checks.
- Physics, mass model, derivatives, sweeps, what-if masks, comparisons and Three.js all execute inside the local webview.
- The 3D Inspector automatically loads the versioned geometry-only prefab cache from `%LOCALAPPDATA%` when it exists. Build it from the locally installed game with `extract-mesh-cache.ps1`; see `MESH_CACHE.md`. Generated game meshes are not bundled or committed.
- A missing mesh cache is non-fatal: the 3D Inspector uses schematic/procedural fallback geometry and its Model Status guidance points to the local extraction workflow. Besiege-owned mesh data stays outside the installer.
- The app has no remote server, external API or Rust calculation backend.
- `localStorage` contains only UI preferences. Machines are not persisted.

## Validation commands

```powershell
npm test
npm run typecheck
npm run build
npm run tauri build
```

The browser and desktop builds use the same frontend output. CLI use through `run.ps1` remains independent.

## Known limitations

- The application icon is a temporary BA project icon.
- File association for `.bsg` is not registered.
- Analysis JSON stores analysis/UI state, not the source `.bsg`; deferred restore still requires the user to open the matching machine file.
- Imported CSV overlays currently target Plot Lab 1D. Re-importing a 2D `x,y,value` CSV as a heatmap is not implemented yet.
- The executable and installer are unsigned.
- The 3D view uses geometry-only Besiege prefab meshes for 90 verified vanilla IDs when the local cache is present, including exact full/short WoodenPole and Log variants selected from BSG `length`. Browser mode, missing caches and the remaining runtime/procedural IDs keep engineering fallbacks. Textures/materials/skins are intentionally unavailable.
- Physics limitations documented in `UI.md`, `ANALYSIS.md` and `POC.md` are unchanged.
- No runtime exporter, exact inertia, runtime joint graph, multibody simulation or new aerodynamic law is included.
