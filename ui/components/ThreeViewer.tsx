import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { UiAnalysisBundle } from "../../src/ui-model.ts";

export interface ViewerToggles {
  readonly blocks: boolean;
  readonly blades: boolean;
  readonly cg: boolean;
  readonly forceVectors: boolean;
  readonly forceAxes: boolean;
  readonly senseAxes: boolean;
}

export const DEFAULT_VIEWER_TOGGLES: ViewerToggles = {
  blocks: true,
  blades: true,
  cg: true,
  forceVectors: true,
  forceAxes: false,
  senseAxes: false,
};

interface ThreeViewerProps {
  readonly bundle: UiAnalysisBundle;
  readonly selectedGuid?: string;
  readonly toggles: ViewerToggles;
  readonly onToggle: (toggles: ViewerToggles) => void;
  readonly onSelect: (guid: string) => void;
}

export function ThreeViewer({ bundle, selectedGuid, toggles, onToggle, onSelect }: ThreeViewerProps) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x090d12);
    scene.fog = new THREE.FogExp2(0x090d12, 0.012);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 2000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const positions = bundle.report.mass.group.blocks.map((block) => new THREE.Vector3(...block.position));
    const bounds = new THREE.Box3().setFromPoints(positions);
    const center = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
    const size = bounds.isEmpty() ? new THREE.Vector3(10, 10, 10) : bounds.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z, 5);
    controls.target.copy(center);
    camera.position.copy(center).add(new THREE.Vector3(span * 1.25, span * 0.8, span * 1.35));
    camera.near = Math.max(span / 1000, 0.01);
    camera.far = span * 100;
    camera.updateProjectionMatrix();

    scene.add(new THREE.HemisphereLight(0xb8ddf1, 0x18202a, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(center.x + span, center.y + span, center.z + span);
    scene.add(key);
    const grid = new THREE.GridHelper(span * 3, 30, 0x344657, 0x1c2833);
    grid.position.y = bounds.min.y - span * 0.06;
    scene.add(grid);
    const axes = new THREE.AxesHelper(span * 0.22);
    axes.position.copy(center);
    scene.add(axes);

    const geometry = new THREE.BoxGeometry(span * 0.025, span * 0.025, span * 0.025);
    if (toggles.blocks) {
      const material = new THREE.MeshStandardMaterial({ color: 0x485665, roughness: 0.8, metalness: 0.05 });
      for (const block of bundle.report.mass.group.blocks) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(...block.position);
        mesh.quaternion.set(block.rotation.x, block.rotation.y, block.rotation.z, block.rotation.w);
        scene.add(mesh);
      }
    }

    const resultByGuid = new Map(bundle.report.stability.baseline.blades.map((entry) => [entry.blade.guid, entry]));
    const maxForce = Math.max(...bundle.report.stability.baseline.blades.map((entry) => Math.hypot(...entry.force)), 1);
    const bladeGeometry = new THREE.BoxGeometry(span * 0.035, span * 0.012, span * 0.18);
    const selectable: THREE.Object3D[] = [];
    if (toggles.blades) {
      for (const blade of bundle.report.availableBlades) {
        const enabled = resultByGuid.has(blade.guid);
        const material = new THREE.MeshStandardMaterial({
          color: blade.guid === selectedGuid ? 0xffe18b : enabled ? (blade.id === 26 ? 0x65d6f0 : 0xc884ff) : 0x3a3e46,
          emissive: blade.guid === selectedGuid ? 0x594614 : 0x000000,
          roughness: 0.45,
        });
        const mesh = new THREE.Mesh(bladeGeometry, material);
        mesh.position.set(...blade.position);
        mesh.quaternion.set(blade.rotation.x, blade.rotation.y, blade.rotation.z, blade.rotation.w);
        mesh.userData.bladeGuid = blade.guid;
        selectable.push(mesh);
        scene.add(mesh);
      }
    }

    const arrow = (origin: readonly [number, number, number], direction: readonly [number, number, number], length: number, color: number) => {
      const vector = new THREE.Vector3(...direction);
      if (vector.lengthSq() < 1e-14) return;
      scene.add(new THREE.ArrowHelper(vector.normalize(), new THREE.Vector3(...origin), length, color, length * 0.18, length * 0.09));
    };
    for (const entry of bundle.report.stability.baseline.blades) {
      if (toggles.forceAxes) arrow(entry.blade.position, entry.forceAxis, span * 0.13, 0x50c9ef);
      if (toggles.senseAxes) arrow(entry.blade.position, entry.senseAxis, span * 0.13, 0xf2a75e);
      if (toggles.forceVectors) {
        const magnitude = Math.hypot(...entry.force);
        arrow(entry.blade.position, entry.force, span * (0.04 + 0.18 * magnitude / maxForce), 0x70dfa5);
      }
    }

    if (toggles.cg) {
      const cgGeometry = new THREE.SphereGeometry(span * 0.045, 24, 16);
      const cgMaterial = new THREE.MeshStandardMaterial({ color: 0xffc85b, emissive: 0x4d3410 });
      const cg = new THREE.Mesh(cgGeometry, cgMaterial);
      cg.position.set(...bundle.report.state.centerOfGravity);
      scene.add(cg);
    }

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const onPointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = (event.clientX - rect.left) / rect.width * 2 - 1;
      pointer.y = -(event.clientY - rect.top) / rect.height * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(selectable, false)[0];
      const guid = hit?.object.userData.bladeGuid as string | undefined;
      if (guid) onSelect(guid);
    };
    renderer.domElement.addEventListener("pointerdown", onPointer);

    const resize = () => {
      const width = Math.max(mount.clientWidth, 1);
      const height = Math.max(mount.clientHeight, 1);
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
      renderer.domElement.removeEventListener("pointerdown", onPointer);
      controls.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [bundle, selectedGuid, toggles, onSelect]);

  const toggle = (key: keyof ViewerToggles) => onToggle({ ...toggles, [key]: !toggles[key] });
  return (
    <section className="data-panel viewer-panel">
      <div className="viewer-toolbar">
        <div><span className="panel-kicker">MACHINE-LOCAL PLACEHOLDERS</span><strong>3D diagnostic view</strong></div>
        {(Object.keys(toggles) as Array<keyof ViewerToggles>).map((key) => (
          <label key={key}><input type="checkbox" checked={toggles[key]} onChange={() => toggle(key)} />{key.replace(/([A-Z])/g, " $1")}</label>
        ))}
      </div>
      <div className="viewer-canvas" ref={mountRef} />
      <div className="viewer-legend"><span className="legend-block" />blocks <span className="legend-large" />Propeller <span className="legend-small" />SmallPropeller <span className="legend-cg" />CG</div>
    </section>
  );
}
