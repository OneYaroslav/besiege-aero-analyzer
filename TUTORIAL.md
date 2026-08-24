# Interactive Tutorial

The application includes a 22-step guided walkthrough launched from the **Tutorial** button on the initial screen or workspace header. It introduces the program, bundled aircraft, Components/Analysis Group, current aerodynamic state, static and damping response, then gives Alpha, pitch-rate, Beta, yaw-rate and roll-rate sweeps their own beginner-oriented explanation.

## Bundled aircraft

The tutorial fixture is stored at:

```text
public/tutorial/tutorial-aircraft.bsg
public/tutorial/manifest.json
```

Vite copies `public/` into `dist/`, so the same URL is available in browser development, the production web build, and Tauri's bundled frontend. The file is fetched as text, parsed with the normal BSG parser and analyzed with the normal solver. Tutorial startup selects the existing `aircraft-heuristic` AnalysisGroup; it does not introduce a tutorial-specific physics path.

To replace the aircraft, replace `tutorial-aircraft.bsg`, update `manifest.json`, and run `pnpm test`. The fixture test intentionally checks the expected machine name, block count, blade count and that the heuristic component contains every aerodynamic blade. Confirm redistribution permission before shipping a third-party machine.

## Engine

Step order, target selector, destination tab, preferred placement and optional completion condition are defined in `src/tutorial.ts`. English copy lives in `locales/en/tutorial.json`. `ui/components/TutorialOverlay.tsx` owns only presentation and DOM target tracking.

Targets use stable `data-tutorial` attributes. The overlay is rendered through a portal and uses four fixed masks around the target, leaving the spotlight area clickable. Target and card geometry are updated through `ResizeObserver`, captured scroll/resize events and a DOM observer. Card placement tries the preferred side and then the remaining sides before clamping to the viewport.

Interactive conditions currently cover:

- selecting a blade;
- creating a group containing at least two blades;
- saving a snapshot named `Baseline`;
- changing the solver-level What-if state.

Back changes only the current step; it does not undo analysis actions. Escape and **Skip Tutorial** close the guided overlay. **Finish Tutorial** keeps the tutorial aircraft loaded, while **Open Aircraft** closes the tutorial and invokes the normal browser/Tauri machine picker.
