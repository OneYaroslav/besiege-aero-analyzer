import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  EMPTY_INSPECTOR_VISIBILITY,
  INSPECTOR_DISPLAY_MODES,
  buildInspectorColorScale,
  computeInspectorBounds,
  frameInspectorCamera,
  hideSelectedBlades,
  inspectorColor,
  inspectorDisplayValue,
  isolateSelectedBlades,
  showAllBlades,
  summarizeBladeSelection,
  updateBladeSelection,
  visibleBladeGuids,
  type InspectorBounds,
  type InspectorDisplayMode,
  type InspectorViewPreset,
  type InspectorVisibilityState,
} from "../../src/inspector.ts";
import {
  collectSchematicBoundsPoints,
  resolveSchematicBlock,
  SCHEMATIC_BLOCK_GLYPH_SCALE,
  schematicBladeProfile,
  type SchematicPrimitiveKind,
  type SchematicSegment,
  type SchematicSurface,
} from "../../src/schematic-geometry.ts";
import { buildBladeRows, formatNumber, type PrecisionMode, type UiAnalysisBundle } from "../../src/ui-model.ts";
import { bladeAxes } from "../../src/physics.ts";
import { massDatabaseEntry } from "../../src/mass.ts";
import { besiegeBladeVisualLocalRotation } from "../../src/visual-mesh-cache.ts";
import { computeTooltipPosition, type TooltipPosition } from "../tooltip-position.ts";
import { loadVisualMeshLibrary, visualTemplateForBlock, type VisualMeshLibraryResult } from "../visual-mesh-cache.ts";
import type { BladeGroup } from "../../src/session-state.ts";
import type { BsgMachine } from "../../src/bsg.ts";
import type { BladeWhatIfOverride } from "../../src/what-if.ts";
import { BladeGroupsPanel } from "./BladeGroupsPanel.tsx";
import { WhatIfPanel } from "./WhatIfPanel.tsx";

export interface ViewerToggles {
  readonly blocks: boolean;
  readonly blades: boolean;
  readonly cg: boolean;
  readonly forceVectors: boolean;
  readonly totalForce: boolean;
  readonly aircraftAxes: boolean;
  readonly forceAxes: boolean;
  readonly senseAxes: boolean;
}

export const DEFAULT_VIEWER_TOGGLES: ViewerToggles = {
  blocks: true,
  blades: true,
  cg: true,
  forceVectors: false,
  totalForce: false,
  aircraftAxes: true,
  forceAxes: false,
  senseAxes: false,
};

interface ThreeViewerProps {
  readonly sourceMachine: BsgMachine;
  readonly bundle: UiAnalysisBundle;
  readonly precision: PrecisionMode;
  readonly selectedGuids: ReadonlySet<string>;
  readonly focusedGuid?: string;
  readonly toggles: ViewerToggles;
  readonly displayMode: InspectorDisplayMode;
  readonly onToggle: (toggles: ViewerToggles) => void;
  readonly onDisplayModeChange: (mode: InspectorDisplayMode) => void;
  readonly onSelectionChange: (guids: Set<string>) => void;
  readonly onFocusChange: (guid: string | undefined) => void;
  readonly onDisableSelected: () => void;
  readonly bladeGroups: readonly BladeGroup[];
  readonly onCreateBladeGroup: (name: string) => void;
  readonly onRenameBladeGroup: (id: string, name: string) => void;
  readonly onDeleteBladeGroup: (id: string) => void;
  readonly onSetBladeGroupEnabled: (group: BladeGroup, enabled: boolean) => void;
  readonly whatIfOverrides: readonly BladeWhatIfOverride[];
  readonly onSetSelectedEnabled: (enabled: boolean) => void;
  readonly onFlipSelected: () => void;
  readonly onApplySelectedTransform: (positionOffset: readonly [number, number, number], rotationOffsetDegrees: readonly [number, number, number]) => void;
  readonly onResetSelectedWhatIf: () => void;
  readonly onResetAllWhatIf: () => void;
}

interface ViewerRuntime {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly staticGroup: THREE.Group;
  readonly machineGroup: THREE.Group;
  readonly blockGroup: THREE.Group;
  readonly bladeGroup: THREE.Group;
  readonly overlayGroup: THREE.Group;
  readonly bladeVisuals: Map<string, BladeVisual>;
  readonly selectable: THREE.Object3D[];
  readonly blockSelectable: THREE.Object3D[];
  bounds: InspectorBounds;
  span: number;
  pointerDown?: { readonly x: number; readonly y: number };
}

interface BladeVisual {
  readonly root: THREE.Object3D;
  readonly meshes: readonly THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[];
  readonly outlines: readonly THREE.LineSegments[];
}

interface HoverState {
  readonly guid: string;
  readonly x: number;
  readonly y: number;
}

interface BlockInspection {
  readonly guid: string;
  readonly id: number;
  readonly type: string;
  readonly source: string;
  readonly geometry: string;
}

function disposeGroup(group: THREE.Group): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.LineSegments || object instanceof THREE.Points) {
        if (!object.geometry.userData.visualMeshCacheShared) geometries.add(object.geometry);
        const entries = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of entries) materials.add(material);
      }
    });
  }
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

function primitiveGeometry(kind: SchematicPrimitiveKind): THREE.BufferGeometry {
  switch (kind) {
    case "cylinder": return new THREE.CylinderGeometry(0.5, 0.5, 1, 14);
    case "sphere": return new THREE.SphereGeometry(0.5, 14, 9);
    case "cone": return new THREE.ConeGeometry(0.5, 1, 14);
    case "box": return new THREE.BoxGeometry(1, 1, 1);
  }
}

function createSegmentMesh(segment: SchematicSegment, shape: "round" | "square" = "round"): THREE.Group {
  const start = new THREE.Vector3(...segment.start);
  const end = new THREE.Vector3(...segment.end);
  const direction = end.clone().sub(start);
  const length = Math.max(direction.length(), 1e-6);
  const orientation = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.clone().normalize(),
  );
  const group = new THREE.Group();
  const geometry = shape === "square"
    ? new THREE.BoxGeometry(1, 1, 1)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
  const material = new THREE.MeshStandardMaterial({
    color: segment.color,
    emissive: 0x17242c,
    emissiveIntensity: 0.7,
    roughness: 0.72,
    metalness: 0.08,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.copy(orientation);
  mesh.scale.set(segment.diameter, length, segment.diameter);
  group.add(mesh);

  if (segment.endpointMarkers) {
    const markerGeometry = new THREE.BoxGeometry(
      segment.endpointMarkers.size,
      segment.endpointMarkers.thickness,
      segment.endpointMarkers.size,
    );
    const markerMaterial = new THREE.MeshStandardMaterial({
      color: segment.endpointMarkers.color,
      emissive: 0x020303,
      emissiveIntensity: 0.35,
      roughness: 0.9,
      metalness: 0.05,
    });
    for (const endpoint of [start, end]) {
      const marker = new THREE.Mesh(markerGeometry.clone(), markerMaterial.clone());
      marker.position.copy(endpoint);
      marker.quaternion.copy(orientation);
      group.add(marker);
    }
    markerGeometry.dispose();
    markerMaterial.dispose();
  }

  return group;
}

function createSurfaceMesh(surface: SchematicSurface): THREE.Mesh {
  const positions = surface.vertices.flatMap((vertex) => [...vertex]);
  const indices: number[] = [];
  for (let index = 1; index < surface.vertices.length - 1; index += 1) indices.push(0, index, index + 1);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: surface.color,
    emissive: 0x101c23,
    emissiveIntensity: 0.65,
    roughness: 0.8,
    metalness: 0.04,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: Math.max(surface.opacity, 0.62),
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  const outline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(surface.vertices.map((vertex) => new THREE.Vector3(...vertex))),
    new THREE.LineBasicMaterial({ color: 0xa8c2d0, transparent: true, opacity: 0.8 }),
  );
  mesh.add(outline);
  return mesh;
}

/** Tapered schematic plate rooted at z=0 and extending along visual block +Z. */
function createBladeGeometry(rootWidth: number, tipWidth: number, thickness: number, length: number): THREE.BufferGeometry {
  const y0 = -thickness / 2;
  const y1 = thickness / 2;
  const xr = rootWidth / 2;
  const xt = tipWidth / 2;
  const vertices = [
    -xr, y0, 0, xr, y0, 0, -xt, y0, length, xt, y0, length,
    -xr, y1, 0, xr, y1, 0, -xt, y1, length, xt, y1, length,
  ];
  const indices = [
    0, 2, 1, 1, 2, 3,
    4, 5, 6, 5, 7, 6,
    0, 1, 4, 1, 5, 4,
    2, 6, 3, 3, 6, 7,
    0, 4, 2, 2, 4, 6,
    1, 3, 5, 3, 7, 5,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function cloneCachedVisual(
  template: THREE.Object3D,
  material: THREE.MeshStandardMaterial,
  metadata: { readonly blockGuid: string; readonly blockType: string; readonly bladeGuid?: string; readonly outlineColor: number },
): { readonly object: THREE.Object3D; readonly meshes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[]; readonly outlines: THREE.LineSegments[] } {
  const object = template.clone(true);
  const meshes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] = [];
  const outlines: THREE.LineSegments[] = [];
  object.traverse((entry) => {
    if (!(entry instanceof THREE.Mesh)) return;
    entry.material = material;
    entry.userData.blockGuid = metadata.blockGuid;
    entry.userData.blockType = metadata.blockType;
    if (metadata.bladeGuid) entry.userData.bladeGuid = metadata.bladeGuid;
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(entry.geometry, 28),
      new THREE.LineBasicMaterial({ color: metadata.outlineColor, transparent: true, opacity: 0.48 }),
    );
    outline.userData.outline = true;
    entry.add(outline);
    meshes.push(entry);
    outlines.push(outline);
  });
  return { object, meshes, outlines };
}

function addArrow(group: THREE.Group, origin: readonly number[], vector: readonly number[], length: number, color: number): void {
  const direction = new THREE.Vector3(vector[0], vector[1], vector[2]);
  if (!Number.isFinite(length) || length <= 1e-9 || direction.lengthSq() <= 1e-20) return;
  const headLength = Math.min(length * 0.22, length);
  const headWidth = Math.min(length * 0.11, headLength * 0.6);
  group.add(new THREE.ArrowHelper(
    direction.normalize(),
    new THREE.Vector3(origin[0], origin[1], origin[2]),
    length,
    color,
    headLength,
    headWidth,
  ));
}

function applyCameraFrame(runtime: ViewerRuntime, preset: InspectorViewPreset, bounds = runtime.bounds): void {
  const frame = frameInspectorCamera(bounds, preset, runtime.camera.aspect, runtime.camera.fov);
  runtime.camera.position.set(...frame.position);
  runtime.camera.up.set(...frame.up);
  runtime.camera.near = frame.near;
  runtime.camera.far = frame.far;
  runtime.camera.updateProjectionMatrix();
  runtime.controls.target.set(...frame.target);
  runtime.controls.update();
}

function selectionModifier(event: PointerEvent): "replace" | "toggle" | "add" {
  if (event.ctrlKey || event.metaKey) return "toggle";
  if (event.shiftKey) return "add";
  return "replace";
}

function hierarchyIsVisible(object: THREE.Object3D): boolean {
  for (let current: THREE.Object3D | null = object; current !== null; current = current.parent) {
    if (!current.visible) return false;
  }
  return true;
}

function BladeHoverTooltip({ hover, bundle, mode, precision }: {
  readonly hover: HoverState;
  readonly bundle: UiAnalysisBundle;
  readonly mode: InspectorDisplayMode;
  readonly precision: PrecisionMode;
}) {
  const { t } = useTranslation(["viewer3d", "common"]);
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<TooltipPosition>({ top: hover.y + 12, left: hover.x + 12, placement: "below" });
  const rows = useMemo(() => buildBladeRows(bundle), [bundle]);
  const row = rows.find((entry) => entry.blade.guid === hover.guid);
  const definition = INSPECTOR_DISPLAY_MODES[mode];

  useLayoutEffect(() => {
    const popup = ref.current;
    if (!popup) return;
    const anchor = { top: hover.y, right: hover.x + 1, bottom: hover.y + 1, left: hover.x, width: 1, height: 1 };
    setPosition(computeTooltipPosition(anchor, popup.getBoundingClientRect(), {
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    }));
  }, [hover]);

  if (!row) return null;
  const displayValue = inspectorDisplayValue(mode, row, bundle.contributions);
  return createPortal(
    <div ref={ref} className="inspector-tooltip" role="tooltip" data-placement={position.placement} style={{ top: position.top, left: position.left }}>
      <strong>{row.blade.kind} · id={row.blade.id}</strong>
      <span className="inspector-tooltip-guid">{row.blade.guid}</span>
      <dl>
        <dt>{t("tooltip.position")}</dt><dd>{row.blade.position.map((value) => formatNumber(value, precision)).join(" / ")}</dd>
        <dt>{t("viewer3d:tooltip.flipped")}</dt><dd>{t(`common:status.${row.blade.flipped ? "yes" : "no"}`)}</dd>
        <dt>{t("tooltip.force")}</dt><dd>{formatNumber(Math.hypot(...row.force), precision)}</dd>
        <dt>{t("tooltip.power")}</dt><dd>{formatNumber(row.power, precision)}</dd>
        <dt>{t("tooltip.moments")}</dt><dd>{[row.rollMoment, row.pitchMoment, row.yawMoment].map((value) => formatNumber(value, precision)).join(" / ")}</dd>
        {definition.contribution && <><dt>{t(`viewer3d:modes.${mode}`)}</dt><dd>{formatNumber(displayValue ?? 0, precision)} {t(`viewer3d:units.${mode}`)}</dd></>}
      </dl>
    </div>,
    document.body,
  );
}

export function ThreeViewer(props: ThreeViewerProps) {
  const { t } = useTranslation("viewer3d");
  const mountRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<ViewerRuntime | undefined>(undefined);
  const selectedRef = useRef(props.selectedGuids);
  const callbacksRef = useRef({ onSelectionChange: props.onSelectionChange, onFocusChange: props.onFocusChange });
  const [hover, setHover] = useState<HoverState>();
  const [inspectedBlock, setInspectedBlock] = useState<BlockInspection>();
  const [visibility, setVisibility] = useState<InspectorVisibilityState>(EMPTY_INSPECTOR_VISIBILITY);
  const [forceScaleAuto, setForceScaleAuto] = useState(true);
  const [forceScaleMultiplier, setForceScaleMultiplier] = useState(1);
  const [sceneError, setSceneError] = useState<string>();
  const [visualMeshLibrary, setVisualMeshLibrary] = useState<VisualMeshLibraryResult>({ available: false, reason: "Loading local visual mesh cache…" });
  const [realMeshInstanceCount, setRealMeshInstanceCount] = useState(0);
  const normalizedToggles = useMemo(() => ({ ...DEFAULT_VIEWER_TOGGLES, ...props.toggles }), [props.toggles]);
  const rows = useMemo(() => buildBladeRows(props.bundle), [props.bundle]);
  const definition = INSPECTOR_DISPLAY_MODES[props.displayMode];
  const values = useMemo(() => rows.map((row) => inspectorDisplayValue(props.displayMode, row, props.bundle.contributions) ?? 0), [rows, props.displayMode, props.bundle.contributions]);
  const colorScale = useMemo(() => buildInspectorColorScale(values, definition.signed), [values, definition.signed]);
  const visualMeshReason = visualMeshLibrary.available ? "" : visualMeshLibrary.reason === "Loading local visual mesh cache…"
    ? t("cache.loading")
    : visualMeshLibrary.reason === "Browser mode uses schematic geometry when the local desktop cache is unavailable."
      ? t("cache.browser")
      : visualMeshLibrary.reason === "Local Besiege visual mesh cache not found."
        ? t("cache.missing")
        : t("cache.failed", { error: visualMeshLibrary.reason.replace(/^Visual mesh cache failed:\s*/, "") });
  const selectionSummary = useMemo(
    () => summarizeBladeSelection(rows, props.selectedGuids, props.displayMode, props.bundle.contributions),
    [rows, props.selectedGuids, props.displayMode, props.bundle.contributions],
  );
  const geometryKey = useMemo(() => [
    props.bundle.report.machine.name,
    `global:${props.bundle.report.machine.globalPosition.join(",")}:${props.bundle.report.machine.globalRotation.x},${props.bundle.report.machine.globalRotation.y},${props.bundle.report.machine.globalRotation.z},${props.bundle.report.machine.globalRotation.w}`,
    props.bundle.report.mass.group.blocks.map((block) => `${block.guid}:${block.id}:${block.position.join(",")}:${block.rotation.x},${block.rotation.y},${block.rotation.z},${block.rotation.w}:${block.scale.join(",")}:${JSON.stringify([...block.vectors])}:${JSON.stringify([...block.strings])}:${JSON.stringify([...block.integers])}`).join(";"),
    props.bundle.report.availableBlades.map((blade) => `${blade.guid}:${blade.id}:${blade.flipped}:${blade.position.join(",")}:${blade.rotation.x},${blade.rotation.y},${blade.rotation.z},${blade.rotation.w}`).join(";"),
  ].join("|"), [props.bundle.report.machine, props.bundle.report.mass.group.blocks, props.bundle.report.availableBlades]);

  selectedRef.current = props.selectedGuids;
  callbacksRef.current = { onSelectionChange: props.onSelectionChange, onFocusChange: props.onFocusChange };

  useEffect(() => {
    let active = true;
    void loadVisualMeshLibrary().then((library) => { if (active) setVisualMeshLibrary(library); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x090d12);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 2_000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.screenSpacePanning = true;
    controls.zoomToCursor = true;
    controls.minDistance = 0.01;
    controls.maxDistance = 100_000;

    const staticGroup = new THREE.Group();
    const machineGroup = new THREE.Group();
    const blockGroup = new THREE.Group();
    const bladeGroup = new THREE.Group();
    const overlayGroup = new THREE.Group();
    machineGroup.add(blockGroup, bladeGroup, overlayGroup);
    staticGroup.add(machineGroup);
    scene.add(staticGroup);
    scene.add(new THREE.HemisphereLight(0xc6e4f4, 0x111820, 1.7));
    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(1, 2, 1.5);
    scene.add(key);
    const runtime: ViewerRuntime = {
      scene, camera, renderer, controls, staticGroup, machineGroup, blockGroup, bladeGroup, overlayGroup,
      bladeVisuals: new Map(), selectable: [], blockSelectable: [], bounds: computeInspectorBounds([]), span: 2,
    };
    runtimeRef.current = runtime;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const updateRay = (event: PointerEvent): boolean => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      pointer.x = (event.clientX - rect.left) / rect.width * 2 - 1;
      pointer.y = -(event.clientY - rect.top) / rect.height * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      return true;
    };
    const pickBlade = (event: PointerEvent): string | undefined => {
      if (!updateRay(event)) return undefined;
      return raycaster.intersectObjects(runtime.selectable.filter(hierarchyIsVisible), false)[0]?.object.userData.bladeGuid as string | undefined;
    };
    const pickBlock = (event: PointerEvent): BlockInspection | undefined => {
      if (!updateRay(event)) return undefined;
      const object = raycaster.intersectObjects(runtime.blockSelectable.filter(hierarchyIsVisible), false)[0]?.object;
      if (!(object instanceof THREE.Mesh)) return undefined;
      return {
        guid: String(object.userData.blockGuid),
        id: Number(object.userData.blockId),
        type: String(object.userData.blockType),
        source: String(object.userData.renderSource),
        geometry: object.geometry.type,
      };
    };
    const onPointerDown = (event: PointerEvent) => { runtime.pointerDown = { x: event.clientX, y: event.clientY }; };
    const onPointerUp = (event: PointerEvent) => {
      const down = runtime.pointerDown;
      runtime.pointerDown = undefined;
      if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
      const guid = pickBlade(event) ?? null;
      if (guid === null) {
        const block = pickBlock(event);
        if (block) {
          setInspectedBlock(block);
          return;
        }
      }
      const next = updateBladeSelection(selectedRef.current, guid, selectionModifier(event));
      callbacksRef.current.onSelectionChange(next);
      callbacksRef.current.onFocusChange(guid !== null && next.has(guid) ? guid : undefined);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.buttons !== 0) { setHover(undefined); return; }
      const guid = pickBlade(event);
      const block = guid ? undefined : pickBlock(event);
      setHover(guid ? { guid, x: event.clientX, y: event.clientY } : undefined);
      renderer.domElement.style.cursor = guid || block ? "pointer" : "grab";
    };
    const onPointerLeave = () => setHover(undefined);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);

    const resize = () => {
      const width = Math.max(mount.clientWidth, 1);
      const height = Math.max(mount.clientHeight, 1);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();
    let frame = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      controls.dispose();
      disposeGroup(staticGroup);
      renderer.dispose();
      renderer.domElement.remove();
      runtimeRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    setSceneError(undefined);
    try {
    disposeGroup(runtime.blockGroup);
    disposeGroup(runtime.bladeGroup);
    runtime.bladeVisuals.clear();
    runtime.selectable.splice(0);
    runtime.blockSelectable.splice(0);
    const machine = props.bundle.report.machine;
    runtime.machineGroup.position.set(...machine.globalPosition);
    runtime.machineGroup.quaternion.set(
      machine.globalRotation.x,
      machine.globalRotation.y,
      machine.globalRotation.z,
      machine.globalRotation.w,
    ).normalize();
    const blocks = props.bundle.report.mass.group.blocks;
    const blocksByGuid = new Map(blocks.map((block) => [block.guid, block]));
    const points = collectSchematicBoundsPoints(blocks, props.bundle.report.availableBlades);
    const localBounds = computeInspectorBounds(points);
    const machineMatrix = new THREE.Matrix4().compose(
      new THREE.Vector3(...machine.globalPosition),
      new THREE.Quaternion(machine.globalRotation.x, machine.globalRotation.y, machine.globalRotation.z, machine.globalRotation.w).normalize(),
      new THREE.Vector3(1, 1, 1),
    );
    const worldPoints = points.map((point) => new THREE.Vector3(...point).applyMatrix4(machineMatrix).toArray() as [number, number, number]);
    runtime.bounds = computeInspectorBounds(worldPoints);
    runtime.span = Math.max(runtime.bounds.span, 1);
    runtime.scene.fog = new THREE.FogExp2(0x090d12, 0.018 / runtime.span);

    const grid = new THREE.GridHelper(runtime.span * 3, 30, 0x344657, 0x1c2833);
    grid.position.set(localBounds.center[0], localBounds.minimum[1] - runtime.span * 0.06, localBounds.center[2]);
    runtime.blockGroup.add(grid);

    // A subtle root-position cloud remains visible even when a schematic plate
    // is viewed exactly edge-on. It is secondary context, not the block shape.
    const rootMarkers = new THREE.BufferGeometry().setFromPoints(
      blocks.filter((block) => block.id !== 26 && block.id !== 55).map((block) => new THREE.Vector3(...block.position)),
    );
    runtime.blockGroup.add(new THREE.Points(rootMarkers, new THREE.PointsMaterial({
      color: 0xb0c4cf,
      size: 2.5,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.62,
    })));

    let realMeshInstances = 0;
    const addBlockVisual = (object: THREE.Object3D, block: (typeof blocks)[number], source: string) => {
      object.traverse((entry) => {
        if (!(entry instanceof THREE.Mesh)) return;
        entry.userData.blockGuid = block.guid;
        entry.userData.blockId = block.id;
        entry.userData.blockType = massDatabaseEntry(block.id)?.type ?? `Unknown(${block.id})`;
        entry.userData.renderSource = source;
        runtime.blockSelectable.push(entry);
      });
      runtime.blockGroup.add(object);
    };
    for (const block of blocks) {
      // Aerodynamic blade blocks are represented once by the selectable visual
      // below. Procedural blocks retain their endpoint/surface reconstruction.
      if (block.id === 26 || block.id === 55) continue;
      const resolved = resolveSchematicBlock(block, blocksByGuid);
      // Hard render boundary for Brace: id=7 never enters the generic round
      // segment path, cached prefab path, or primitive fallback.
      if (block.id === 7) {
        if (resolved.kind !== "segment") {
          throw new Error(`Brace ${block.guid} is missing serialized endpoints`);
        }
        addBlockVisual(createSegmentMesh(resolved, "square"), block, "brace-square-procedural");
        continue;
      }
      if (resolved.kind === "segment") {
        addBlockVisual(createSegmentMesh(resolved), block, "generic-round-segment");
      } else if (resolved.kind === "surface") {
        addBlockVisual(createSurfaceMesh(resolved), block, "procedural-surface");
      } else {
        const { profile } = resolved;
        const root = new THREE.Group();
        root.position.set(...block.position);
        root.quaternion.set(block.rotation.x, block.rotation.y, block.rotation.z, block.rotation.w).normalize();
        root.scale.set(...block.scale);
        const material = new THREE.MeshStandardMaterial({
          color: profile.color,
          emissive: profile.category === "wood" ? 0x1a120b : 0x101a21,
          emissiveIntensity: 0.65,
          roughness: profile.category === "surface" ? 0.74 : 0.82,
          metalness: profile.category === "wood" ? 0 : 0.08,
          transparent: false,
          opacity: 1,
          side: profile.category === "surface" ? THREE.DoubleSide : THREE.FrontSide,
        });
        // id=71 is the BuildSurface brace cap. Its extracted prefab visual is
        // oval; the analysis view intentionally uses the requested square cap.
        const template = visualMeshLibrary.available && block.id !== 71
          ? visualTemplateForBlock(visualMeshLibrary, block)
          : undefined;
        if (template) {
          const visual = cloneCachedVisual(template, material, {
            blockGuid: block.guid,
            blockType: profile.type,
            outlineColor: 0x91a8b6,
          });
          root.add(visual.object);
          realMeshInstances += 1;
        } else {
          const mesh = new THREE.Mesh(primitiveGeometry(profile.kind), material);
          mesh.position.set(
            profile.offset[0] * SCHEMATIC_BLOCK_GLYPH_SCALE,
            profile.offset[1] * SCHEMATIC_BLOCK_GLYPH_SCALE,
            profile.offset[2] * SCHEMATIC_BLOCK_GLYPH_SCALE,
          );
          mesh.quaternion.set(profile.localRotation.x, profile.localRotation.y, profile.localRotation.z, profile.localRotation.w).normalize();
          mesh.scale.set(
            profile.size[0] * SCHEMATIC_BLOCK_GLYPH_SCALE,
            profile.size[1] * SCHEMATIC_BLOCK_GLYPH_SCALE,
            profile.size[2] * SCHEMATIC_BLOCK_GLYPH_SCALE,
          );
          mesh.userData.blockGuid = block.guid;
          mesh.userData.blockType = profile.type;
          const outline = new THREE.LineSegments(
            new THREE.EdgesGeometry(mesh.geometry),
            new THREE.LineBasicMaterial({ color: 0x91a8b6, transparent: true, opacity: 0.42 }),
          );
          mesh.add(outline);
          root.add(mesh);
        }
        addBlockVisual(root, block, template ? "prefab-mesh-cache" : block.id === 71 ? "build-node-square-override" : "schematic-primitive");
      }
    }

    for (const blade of props.bundle.report.availableBlades) {
      const material = new THREE.MeshStandardMaterial({ color: 0x70808f, roughness: 0.38, metalness: 0.08, transparent: true });
      const root = new THREE.Group();
      root.position.set(...blade.position);
      root.quaternion.set(blade.rotation.x, blade.rotation.y, blade.rotation.z, blade.rotation.w).normalize();
      root.scale.set(...blade.scale);
      const template = visualMeshLibrary.available ? visualMeshLibrary.templates.get(blade.id) : undefined;
      let bladeVisual: BladeVisual;
      if (template) {
        const cached = cloneCachedVisual(template, material, {
          blockGuid: blade.guid,
          blockType: blade.kind,
          bladeGuid: blade.guid,
          outlineColor: blade.flipped ? 0xf2a75e : 0x263744,
        });
        const runtimeRotation = besiegeBladeVisualLocalRotation(blade.id, blade.flipped);
        if (runtimeRotation) {
          if (cached.meshes.length !== 1) throw new Error(`Blade visual ${blade.id} expected one cached renderer, found ${cached.meshes.length}`);
          // Full hierarchy is now Machine Global -> BSG Block -> cached prefab
          // root -> Vis. Only Vis.localRotation is runtime-controlled by
          // PropellorController; its extracted localPosition/localScale remain.
          cached.meshes[0].quaternion.set(runtimeRotation.x, runtimeRotation.y, runtimeRotation.z, runtimeRotation.w).normalize();
        }
        root.add(cached.object);
        bladeVisual = { root, meshes: cached.meshes, outlines: cached.outlines };
        realMeshInstances += 1;
      } else {
        const visual = schematicBladeProfile(blade);
        const bladeGeometry = createBladeGeometry(visual.rootWidth, visual.tipWidth, visual.thickness, visual.length);
        const mesh = new THREE.Mesh(bladeGeometry, material);
        // This plate already extends along +Z, unlike the extracted raw mesh;
        // apply the same effective visual plane twist without the raw mesh's
        // required 180-degree span reversal.
        mesh.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(blade.flipped ? -23 : 23));
        mesh.userData.bladeGuid = blade.guid;
        const outline = new THREE.LineSegments(
          new THREE.EdgesGeometry(bladeGeometry),
          new THREE.LineBasicMaterial({ color: blade.flipped ? 0xf2a75e : 0x263744 }),
        );
        outline.userData.outline = true;
        mesh.add(outline);
        root.add(mesh);
        bladeVisual = { root, meshes: [mesh], outlines: [outline] };
      }
      runtime.bladeVisuals.set(blade.guid, bladeVisual);
      runtime.selectable.push(...bladeVisual.meshes);
      runtime.bladeGroup.add(root);
    }
    setRealMeshInstanceCount(realMeshInstances);
    setVisibility(showAllBlades());
    setHover(undefined);
    setInspectedBlock(undefined);
    applyCameraFrame(runtime, "perspective");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setSceneError(`3D scene failed: ${message}`);
      console.error("3D scene construction failed", cause);
    }
  }, [geometryKey, visualMeshLibrary]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const resultByGuid = new Map(props.bundle.report.stability.baseline.blades.map((entry) => [entry.blade.guid, entry]));
    const rowByGuid = new Map(rows.map((row) => [row.blade.guid, row]));
    const visible = visibleBladeGuids(rows.map((row) => row.blade.guid), visibility);
    const modifiedGuids = new Set(props.whatIfOverrides.map((override) => override.guid));
    runtime.blockGroup.visible = normalizedToggles.blocks;
    for (const row of rows) {
      const visual = runtime.bladeVisuals.get(row.blade.guid);
      if (!visual) continue;
      visual.root.visible = normalizedToggles.blades && visible.has(row.blade.guid);
      const selected = props.selectedGuids.has(row.blade.guid);
      const focused = props.focusedGuid === row.blade.guid;
      const modified = modifiedGuids.has(row.blade.guid);
      const value = inspectorDisplayValue(props.displayMode, row, props.bundle.contributions) ?? 0;
      const baseColor = props.displayMode === "geometry"
        ? (row.blade.id === 26 ? 0x65d6f0 : 0xc884ff)
        : inspectorColor(value, colorScale);
      for (const mesh of visual.meshes) {
        mesh.material.color.setHex(row.enabled ? baseColor : 0x3a3e46);
        mesh.material.opacity = row.enabled ? 0.94 : 0.28;
        mesh.material.emissive.setHex(selected ? 0x514212 : focused ? 0x183d4b : modified ? 0x34142e : 0x000000);
        mesh.material.emissiveIntensity = selected ? 1.35 : modified ? 0.95 : 0.7;
      }
      for (const outline of visual.outlines) {
        const outlineMaterial = outline.material as THREE.LineBasicMaterial;
        outlineMaterial.color.setHex(selected ? 0xffe18b : modified ? 0xff66d9 : row.blade.flipped ? 0xf2a75e : 0x263744);
        outlineMaterial.opacity = selected || modified ? 1 : 0.48;
      }
    }

    disposeGroup(runtime.overlayGroup);
    const span = runtime.span;
    const cg = props.bundle.report.state.centerOfGravity;
    const enabledVisible = props.bundle.report.stability.baseline.blades.filter((entry) => visible.has(entry.blade.guid));
    const maxForce = Math.max(...enabledVisible.map((entry) => Math.hypot(...entry.force)), 0);
    const forceLength = (magnitude: number) => forceScaleAuto
      ? (maxForce > 1e-12 ? span * 0.24 * magnitude / maxForce * forceScaleMultiplier : 0)
      : span * 0.002 * magnitude * forceScaleMultiplier;

    for (const row of rows) {
      if (!visible.has(row.blade.guid)) continue;
      const axes = bladeAxes(row.blade);
      if (normalizedToggles.forceAxes) addArrow(runtime.overlayGroup, row.blade.position, axes.forceAxis, span * 0.14, 0x50c9ef);
      if (normalizedToggles.senseAxes) addArrow(runtime.overlayGroup, row.blade.position, axes.senseAxis, span * 0.14, 0xf2a75e);
    }
    for (const entry of enabledVisible) {
      if (normalizedToggles.forceVectors) {
        const magnitude = Math.hypot(...entry.force);
        if (magnitude > 1e-10) addArrow(runtime.overlayGroup, entry.blade.position, entry.force, forceLength(magnitude), 0x70dfa5);
      }
    }

    if (normalizedToggles.totalForce) {
      const total = props.bundle.report.stability.baseline.totalForce;
      const magnitude = Math.hypot(...total);
      addArrow(runtime.overlayGroup, cg, total, magnitude > 1e-10 ? Math.min(forceLength(magnitude), span * 0.8) : 0, 0xffffff);
    }
    if (normalizedToggles.cg) {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(span * 0.035, 20, 12),
        new THREE.MeshStandardMaterial({ color: 0xffc85b, emissive: 0x4d3410 }),
      );
      marker.position.set(...cg);
      runtime.overlayGroup.add(marker);
    }
    if (normalizedToggles.aircraftAxes) {
      addArrow(runtime.overlayGroup, cg, [1, 0, 0], span * 0.2, 0xe66767);
      addArrow(runtime.overlayGroup, cg, [0, 1, 0], span * 0.2, 0x67d78b);
      addArrow(runtime.overlayGroup, cg, [0, 0, 1], span * 0.2, 0x65a8f0);
    }

    const focused = props.focusedGuid ? rowByGuid.get(props.focusedGuid) : undefined;
    if (focused && visible.has(focused.blade.guid)) {
      runtime.overlayGroup.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...cg), new THREE.Vector3(...focused.blade.position)]),
        new THREE.LineBasicMaterial({ color: 0xffe18b }),
      ));
      const result = resultByGuid.get(focused.blade.guid);
      if (result) {
        const magnitude = Math.hypot(...result.force);
        if (magnitude > 1e-10 && !normalizedToggles.forceVectors) {
          addArrow(runtime.overlayGroup, focused.blade.position, result.force, Math.max(forceLength(magnitude), span * 0.06), 0xffe18b);
        }
      }
    }
  }, [props.bundle, props.selectedGuids, props.focusedGuid, props.displayMode, props.whatIfOverrides, normalizedToggles, visibility, forceScaleAuto, forceScaleMultiplier, rows, colorScale]);

  const setPreset = useCallback((preset: InspectorViewPreset) => {
    const runtime = runtimeRef.current;
    if (runtime) applyCameraFrame(runtime, preset);
  }, []);
  const focusSelected = useCallback(() => {
    const runtime = runtimeRef.current;
    const selectedRows = rows.filter((row) => props.selectedGuids.has(row.blade.guid));
    if (!runtime || selectedRows.length === 0) return;
    const machine = props.bundle.report.machine;
    const machineMatrix = new THREE.Matrix4().compose(
      new THREE.Vector3(...machine.globalPosition),
      new THREE.Quaternion(machine.globalRotation.x, machine.globalRotation.y, machine.globalRotation.z, machine.globalRotation.w).normalize(),
      new THREE.Vector3(1, 1, 1),
    );
    const worldPoints = selectedRows.map((row) => new THREE.Vector3(...row.blade.position).applyMatrix4(machineMatrix).toArray() as [number, number, number]);
    applyCameraFrame(runtime, "perspective", computeInspectorBounds(worldPoints));
  }, [rows, props.selectedGuids, props.bundle.report.machine]);
  const toggle = (key: keyof ViewerToggles) => props.onToggle({ ...normalizedToggles, [key]: !normalizedToggles[key] });
  const hiddenCount = rows.length - visibleBladeGuids(rows.map((row) => row.blade.guid), visibility).size;

  return (
    <section className="data-panel viewer-panel" data-tutorial="viewer">
      <div className="viewer-toolbar">
        <div className="viewer-title"><span className="panel-kicker">{t("machineLocal")} · {visualMeshLibrary.available ? t("prefabFallback") : t("schematicFallback")}</span><strong>3D Inspector</strong></div>
        <div className="viewer-presets" aria-label={t("camera.presets")}>
          <button onClick={() => setPreset("perspective")}>{t("camera.reset")}</button><button onClick={() => setPreset("perspective")}>{t("camera.perspective")}</button><button onClick={() => setPreset("front")}>{t("camera.front")}</button><button onClick={() => setPreset("rear")}>{t("camera.rear")}</button><button onClick={() => setPreset("left")}>{t("camera.left")}</button><button onClick={() => setPreset("right")}>{t("camera.right")}</button><button onClick={() => setPreset("top")}>{t("camera.top")}</button><button onClick={() => setPreset("bottom")}>{t("camera.bottom")}</button>
        </div>
        <label className="viewer-mode">{t("displayMode")}<select value={props.displayMode} onChange={(event) => props.onDisplayModeChange(event.target.value as InspectorDisplayMode)}>{(Object.entries(INSPECTOR_DISPLAY_MODES) as Array<[InspectorDisplayMode, typeof definition]>).map(([value]) => <option key={value} value={value}>{t(`modes.${value}`)}</option>)}</select></label>
        <label><input type="checkbox" checked={normalizedToggles.forceVectors} onChange={() => toggle("forceVectors")} />{t("overlays.forceVectors")}</label>
        <label><input type="checkbox" checked={normalizedToggles.cg} onChange={() => toggle("cg")} />CG</label>
        <label><input type="checkbox" checked={normalizedToggles.aircraftAxes} onChange={() => toggle("aircraftAxes")} />{t("overlays.axes")}</label>
      </div>
      <div className="viewer-body">
        <div className="viewer-canvas-wrap" data-tutorial="viewer-canvas">
          <div className="viewer-canvas" ref={mountRef} aria-label={t("canvasAria")} />
          {sceneError && <div className="viewer-scene-error" role="alert">{t("errors.scene", { error: sceneError.replace(/^3D scene failed:\s*/, "") })}</div>}
          {!normalizedToggles.blocks && <div className="viewer-scene-notice">{t("blocksHidden")}</div>}
        </div>
        <aside className="viewer-sidepanel">
          {props.displayMode === "geometry" ? <section><span className="panel-kicker">{t("legend.geometry")}</span><div className={`viewer-cache-state ${visualMeshLibrary.available ? "available" : "fallback"}`}><strong>{visualMeshLibrary.available ? t("legend.cache", { count: visualMeshLibrary.manifest.blockCount }) : t("schematicFallback")}</strong><small>{visualMeshLibrary.available ? t("legend.instances", { count: realMeshInstanceCount, excluded: visualMeshLibrary.manifest.excludedCount }) : visualMeshReason}</small></div><div className="viewer-type-legend"><span><i className="legend-large" />Propeller</span><span><i className="legend-small" />SmallPropeller</span><span><i className="legend-flipped" />{t("legend.flipped")}</span><span><i className="legend-what-if" />{t("legend.whatIf")}</span></div><small>{t("legend.chain")}</small></section> : <section className="inspector-color-legend"><span className="panel-kicker">{t("legend.autoScale")}</span><strong>{t(`modes.${props.displayMode}`)}</strong><div className={`inspector-gradient ${definition.signed ? "signed" : "sequential"}`} /><div><span>{formatNumber(colorScale.minimum, props.precision)}</span>{definition.signed && <span>0</span>}<span>{formatNumber(colorScale.maximum, props.precision)}</span></div><small>{t(`units.${props.displayMode}`)}</small></section>}
          <section className="viewer-overlays"><span className="panel-kicker">{t("overlays.title")}</span>{(["blocks", "blades", "totalForce", "forceAxes", "senseAxes"] as const).map((key) => <label key={key}><input type="checkbox" checked={normalizedToggles[key]} onChange={() => toggle(key)} />{t(`overlays.${key}`)}</label>)}<div className="axis-key"><span className="axis-x">{t("axes.x")}</span><span className="axis-y">{t("axes.y")}</span><span className="axis-z">{t("axes.z")}</span></div></section>
          <section className="viewer-block-inspector"><span className="panel-kicker">{t("blockInspector.title")}</span>{inspectedBlock ? <><strong>{inspectedBlock.type} · id={inspectedBlock.id}</strong><small>{inspectedBlock.guid}</small><dl className="selection-summary"><dt>{t("blockInspector.source")}</dt><dd>{inspectedBlock.source}</dd><dt>{t("blockInspector.geometry")}</dt><dd>{inspectedBlock.geometry}</dd></dl></> : <small>{t("blockInspector.empty")}</small>}</section>
          <section className="viewer-force-scale"><span className="panel-kicker">{t("forceScale.title")}</span><label><input type="checkbox" checked={forceScaleAuto} onChange={(event) => setForceScaleAuto(event.target.checked)} />{t("forceScale.auto")}</label><label>{t("forceScale.multiplier")} <input type="range" min="0.1" max="4" step="0.1" value={forceScaleMultiplier} onChange={(event) => setForceScaleMultiplier(Number(event.target.value))} /><output>{forceScaleMultiplier.toFixed(1)}×</output></label></section>
          <section className="viewer-selection"><span className="panel-kicker">{t("selection.title")}</span><strong>{t("selection.count", { count: selectionSummary.bladeCount })}</strong><div className="viewer-selection-actions"><button disabled={selectionSummary.bladeCount === 0} onClick={focusSelected}>{t("selection.focus")}</button><button disabled={selectionSummary.bladeCount === 0} onClick={() => setVisibility((current) => hideSelectedBlades(current, props.selectedGuids))}>{t("selection.hide")}</button><button disabled={selectionSummary.bladeCount === 0} onClick={() => setVisibility(isolateSelectedBlades(props.selectedGuids))}>{t("selection.isolate")}</button><button disabled={hiddenCount === 0 && visibility.isolatedGuids === null} onClick={() => setVisibility(showAllBlades())}>{t("selection.showAll")}</button><button className="danger-action" disabled={selectionSummary.bladeCount === 0} onClick={props.onDisableSelected}>{t("selection.disable")}</button></div>
            {selectionSummary.bladeCount > 0 && <dl className="selection-summary"><dt>{t("selection.force")}</dt><dd>{selectionSummary.totalForce.map((value) => formatNumber(value, props.precision)).join(" / ")}</dd><dt>{t("selection.power")}</dt><dd>{formatNumber(selectionSummary.totalPower, props.precision)}</dd><dt>{t("selection.moments")}</dt><dd>{[selectionSummary.rollMoment, selectionSummary.pitchMoment, selectionSummary.yawMoment].map((value) => formatNumber(value, props.precision)).join(" / ")}</dd>{selectionSummary.displayContribution !== null && <><dt>{t("selection.contribution")}</dt><dd>{formatNumber(selectionSummary.displayContribution, props.precision)} {t(`units.${props.displayMode}`)}</dd></>}</dl>}
            <small>{t("selection.help")}</small>
          </section>
          <WhatIfPanel compact sourceMachine={props.sourceMachine} bundle={props.bundle} precision={props.precision} selectedGuids={props.selectedGuids} disabledGuids={props.bundle.report.disabledBladeGuids} overrides={props.whatIfOverrides} onSetEnabled={props.onSetSelectedEnabled} onFlip={props.onFlipSelected} onApplyTransform={props.onApplySelectedTransform} onResetSelected={props.onResetSelectedWhatIf} onResetAll={props.onResetAllWhatIf} />
          <BladeGroupsPanel compact bundle={props.bundle} precision={props.precision} groups={props.bladeGroups} disabledGuids={props.bundle.report.disabledBladeGuids} selectedGuids={props.selectedGuids} onCreate={props.onCreateBladeGroup} onRename={props.onRenameBladeGroup} onDelete={props.onDeleteBladeGroup} onSelect={(guids) => props.onSelectionChange(new Set(guids))} onIsolate={(guids) => { props.onSelectionChange(new Set(guids)); setVisibility(isolateSelectedBlades(guids)); }} onSetEnabled={props.onSetBladeGroupEnabled} />
        </aside>
      </div>
      <div className="viewer-status"><span>{t("navigation.orbit")}</span><span>{t("navigation.pan")}</span><span>{t("navigation.zoom")}</span><span>{t("status", { blades: rows.length, blocks: props.bundle.report.mass.group.blocks.length, meshes: realMeshInstanceCount })}</span></div>
      {hover && <BladeHoverTooltip hover={hover} bundle={props.bundle} mode={props.displayMode} precision={props.precision} />}
    </section>
  );
}
