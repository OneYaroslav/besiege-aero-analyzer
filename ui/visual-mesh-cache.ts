import { invoke, isTauri } from "@tauri-apps/api/core";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  parseVisualMeshCacheManifest,
  type VisualMeshCacheManifest,
} from "../src/visual-mesh-cache.ts";
import type { BsgBlock } from "../src/bsg.ts";

export interface VisualMeshLibrary {
  readonly available: true;
  readonly manifest: VisualMeshCacheManifest;
  readonly templates: ReadonlyMap<number, THREE.Object3D>;
  readonly shorteningTemplates: ReadonlyMap<number, Readonly<{ full: THREE.Object3D; short: THREE.Object3D; fullLength: number; shortLength: number }>>;
}

export interface UnavailableVisualMeshLibrary {
  readonly available: false;
  readonly reason: string;
}

export type VisualMeshLibraryResult = VisualMeshLibrary | UnavailableVisualMeshLibrary;

function normalizeBinaryResponse(value: unknown): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
  if (Array.isArray(value) && value.every((entry) => typeof entry === "number" && entry >= 0 && entry <= 255)) return Uint8Array.from(value).buffer;
  throw new Error("Tauri returned an unsupported binary GLB response");
}

function parseGlb(buffer: ArrayBuffer): Promise<GLTF> {
  return new Promise((resolve, reject) => new GLTFLoader().parse(buffer, "", resolve, reject));
}

let visualMeshLibraryPromise: Promise<VisualMeshLibraryResult> | undefined;

export function loadVisualMeshLibrary(): Promise<VisualMeshLibraryResult> {
  if (visualMeshLibraryPromise) return visualMeshLibraryPromise;
  const load = async (): Promise<VisualMeshLibraryResult> => {
    if (!isTauri()) return { available: false, reason: "Browser mode uses schematic geometry when the local desktop cache is unavailable." };
    const manifestText = await invoke<string | null>("visual_mesh_cache_manifest");
    if (manifestText === null) return { available: false, reason: "Local Besiege visual mesh cache not found." };
    const manifest = parseVisualMeshCacheManifest(manifestText);
    const rawGlb = await invoke<unknown>("visual_mesh_cache_glb");
    const glb = normalizeBinaryResponse(rawGlb);
    if (glb.byteLength !== manifest.glbByteLength) throw new Error(`Visual mesh cache GLB size mismatch: ${glb.byteLength} != ${manifest.glbByteLength}`);
    const parsed = await parseGlb(glb);
    const templates = new Map<number, THREE.Object3D>();
    const shorteningTemplates = new Map<number, { full: THREE.Object3D; short: THREE.Object3D; fullLength: number; shortLength: number }>();
    const prepareTemplate = (nodeName: string): THREE.Object3D => {
      const template = parsed.scene.getObjectByName(nodeName);
      if (!template) throw new Error(`Visual mesh cache GLB is missing node ${nodeName}`);
      template.removeFromParent();
      template.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.userData.visualMeshCacheShared = true;
      });
      return template;
    };
    for (const block of manifest.blocks) {
      if (block.variants) {
        const full = prepareTemplate(block.variants.full.nodeName);
        const short = prepareTemplate(block.variants.short.nodeName);
        templates.set(block.id, full);
        shorteningTemplates.set(block.id, {
          full,
          short,
          fullLength: block.variants.full.length,
          shortLength: block.variants.short.length,
        });
      } else {
        templates.set(block.id, prepareTemplate(block.nodeName));
      }
    }
    return { available: true, manifest, templates, shorteningTemplates };
  };
  visualMeshLibraryPromise = load().catch((cause: unknown): UnavailableVisualMeshLibrary => ({
    available: false,
    reason: `Visual mesh cache failed: ${cause instanceof Error ? cause.message : String(cause)}`,
  }));
  return visualMeshLibraryPromise;
}

/** Mirrors ShorteningBlock.UpdateLength: only startingLength - 1 uses HalfVis. */
export function visualTemplateForBlock(library: VisualMeshLibrary, block: BsgBlock): THREE.Object3D | undefined {
  const variants = library.shorteningTemplates.get(block.id);
  if (!variants) return library.templates.get(block.id);
  const length = block.integers.get("length") ?? variants.fullLength;
  return length === variants.shortLength ? variants.short : variants.full;
}
