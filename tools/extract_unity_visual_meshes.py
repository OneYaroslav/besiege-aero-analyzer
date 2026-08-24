#!/usr/bin/env python3
"""Build a local geometry-only GLB cache from installed Besiege vanilla prefabs.

The cache contains positions, normals, indices and visual child transforms only.
It deliberately does not export textures, materials, shaders or colliders. The
generated GLB is user-local game data and must not be committed or bundled.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import struct
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

import UnityPy
from UnityPy.helpers.MeshHelper import MeshHandler
from UnityPy.helpers.TypeTreeGenerator import TypeTreeGenerator

from extract_unity_masses import parse_container_prefix, pointer_path_id
from extract_unity_visual_bounds import component_ids, quat, vec3


GAME_VERSION = "1.90-25346"
UNITY_VERSION = "5.4.0f3"
CACHE_SCHEMA_VERSION = 2
CACHE_FILE_NAME = "vanilla-blocks.glb"
MANIFEST_FILE_NAME = "manifest.json"


@dataclass
class VisualNode:
    name: str
    path: str
    active: bool
    under_vis: bool
    position: tuple[float, float, float]
    rotation: tuple[float, float, float, float]
    scale: tuple[float, float, float]
    renderer_enabled: bool
    mesh_pointers: list[Any] = field(default_factory=list)
    children: list["VisualNode"] = field(default_factory=list)


class GlbBuilder:
    def __init__(self) -> None:
        self.binary = bytearray()
        self.buffer_views: list[dict[str, Any]] = []
        self.accessors: list[dict[str, Any]] = []
        self.meshes: list[dict[str, Any]] = []
        self.nodes: list[dict[str, Any]] = []
        self._mesh_indices: dict[tuple[str, int], int] = {}

    def append_buffer_view(self, payload: bytes, target: int) -> int:
        while len(self.binary) % 4:
            self.binary.append(0)
        offset = len(self.binary)
        self.binary.extend(payload)
        index = len(self.buffer_views)
        self.buffer_views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(payload), "target": target})
        return index

    def add_accessor(
        self,
        view: int,
        component_type: int,
        count: int,
        value_type: str,
        minimum: list[float] | None = None,
        maximum: list[float] | None = None,
    ) -> int:
        accessor: dict[str, Any] = {
            "bufferView": view,
            "byteOffset": 0,
            "componentType": component_type,
            "count": count,
            "type": value_type,
        }
        if minimum is not None:
            accessor["min"] = minimum
        if maximum is not None:
            accessor["max"] = maximum
        index = len(self.accessors)
        self.accessors.append(accessor)
        return index

    @staticmethod
    def mesh_key(mesh: Any, path_id: int) -> tuple[str, int]:
        asset = getattr(getattr(mesh, "object_reader", None), "assets_file", None)
        return str(getattr(asset, "name", "unknown")), path_id

    def add_unity_mesh(self, pointer: Any) -> int:
        mesh = pointer.deref_parse_as_object()
        key = self.mesh_key(mesh, int(pointer.path_id))
        existing = self._mesh_indices.get(key)
        if existing is not None:
            return existing

        handler = MeshHandler(mesh)
        handler.process()
        vertices = [tuple(float(value) for value in vertex[:3]) for vertex in handler.m_Vertices]
        normals = [tuple(float(value) for value in normal[:3]) for normal in handler.m_Normals]
        if not vertices or len(normals) != len(vertices):
            raise RuntimeError(f"Mesh {getattr(mesh, 'm_Name', key)} has no complete position/normal data")

        vertex_payload = struct.pack(f"<{len(vertices) * 3}f", *(value for vertex in vertices for value in vertex))
        normal_payload = struct.pack(f"<{len(normals) * 3}f", *(value for normal in normals for value in normal))
        position_view = self.append_buffer_view(vertex_payload, 34962)
        normal_view = self.append_buffer_view(normal_payload, 34962)
        position_accessor = self.add_accessor(
            position_view,
            5126,
            len(vertices),
            "VEC3",
            [min(vertex[axis] for vertex in vertices) for axis in range(3)],
            [max(vertex[axis] for vertex in vertices) for axis in range(3)],
        )
        normal_accessor = self.add_accessor(normal_view, 5126, len(normals), "VEC3")

        primitives: list[dict[str, Any]] = []
        for triangles in handler.get_triangles():
            flat_indices = [int(index) for triangle in triangles for index in triangle]
            if not flat_indices:
                continue
            max_index = max(flat_indices)
            if max_index <= 0xFFFF:
                index_payload = struct.pack(f"<{len(flat_indices)}H", *flat_indices)
                component_type = 5123
            else:
                index_payload = struct.pack(f"<{len(flat_indices)}I", *flat_indices)
                component_type = 5125
            index_view = self.append_buffer_view(index_payload, 34963)
            index_accessor = self.add_accessor(index_view, component_type, len(flat_indices), "SCALAR", [min(flat_indices)], [max_index])
            # MeshHandler produces triangles whose geometric cross product agrees
            # with the decoded outward normals. Preserve that winding. BSG roots
            # and prefab child transforms are likewise kept in Unity numeric XYZ,
            # matching the existing machine-local Three.js scene convention.
            primitives.append({
                "attributes": {"POSITION": position_accessor, "NORMAL": normal_accessor},
                "indices": index_accessor,
                "mode": 4,
            })
        if not primitives:
            raise RuntimeError(f"Mesh {getattr(mesh, 'm_Name', key)} has no triangle primitives")

        mesh_index = len(self.meshes)
        self.meshes.append({"name": str(getattr(mesh, "m_Name", f"mesh_{mesh_index}")), "primitives": primitives})
        self._mesh_indices[key] = mesh_index
        return mesh_index

    @staticmethod
    def transform_fields(node: VisualNode, include: bool) -> dict[str, Any]:
        if not include:
            return {}
        return {
            "translation": list(node.position),
            "rotation": list(node.rotation),
            "scale": list(node.scale),
        }

    def emit_visual_tree(self, root: VisualNode, selected: set[int], block_id: int, block_type: str, node_name: str | None = None) -> int:
        def emit(node: VisualNode, is_root: bool = False) -> int | None:
            child_indices = [value for child in node.children if (value := emit(child)) is not None]
            selected_here = id(node) in selected
            if not is_root and not selected_here and not child_indices:
                return None

            mesh_indices = [self.add_unity_mesh(pointer) for pointer in node.mesh_pointers] if selected_here else []
            entry: dict[str, Any] = {
                "name": (node_name or f"block_{block_id}") if is_root else f"{block_id}:{node.path}",
                **self.transform_fields(node, not is_root),
            }
            if mesh_indices:
                entry["mesh"] = mesh_indices[0]
                for extra_index, mesh_index in enumerate(mesh_indices[1:], start=2):
                    child_indices.append(len(self.nodes))
                    self.nodes.append({"name": f"{block_id}:{node.path}:mesh{extra_index}", "mesh": mesh_index})
            if child_indices:
                entry["children"] = child_indices
            if is_root:
                entry["extras"] = {"blockId": block_id, "blockType": block_type, "geometryOnly": True}
            index = len(self.nodes)
            self.nodes.append(entry)
            return index

        emitted = emit(root, is_root=True)
        if emitted is None:
            raise RuntimeError(f"No visual tree emitted for block {block_id} {block_type}")
        return emitted

    def write(self, output: Path, scene_nodes: list[int]) -> None:
        while len(self.binary) % 4:
            self.binary.append(0)
        document = {
            "asset": {"version": "2.0", "generator": "Besiege Aero Analyzer geometry-only extractor"},
            "scene": 0,
            "scenes": [{"name": "Vanilla block mesh library", "nodes": scene_nodes}],
            "nodes": self.nodes,
            "meshes": self.meshes,
            "buffers": [{"byteLength": len(self.binary)}],
            "bufferViews": self.buffer_views,
            "accessors": self.accessors,
        }
        json_payload = json.dumps(document, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        json_payload += b" " * ((4 - len(json_payload) % 4) % 4)
        bin_payload = bytes(self.binary)
        total_length = 12 + 8 + len(json_payload) + 8 + len(bin_payload)
        glb = b"".join([
            struct.pack("<III", 0x46546C67, 2, total_length),
            struct.pack("<II", len(json_payload), 0x4E4F534A),
            json_payload,
            struct.pack("<II", len(bin_payload), 0x004E4942),
            bin_payload,
        ])
        temporary = output.with_suffix(output.suffix + ".tmp")
        temporary.write_bytes(glb)
        temporary.replace(output)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def source_fingerprint(path: Path) -> dict[str, Any]:
    return {"path": path.name, "size": path.stat().st_size, "sha256": file_sha256(path)}


def default_output_directory() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    if not local_app_data:
        raise RuntimeError("LOCALAPPDATA is not available; pass --output-dir explicitly")
    return Path(local_app_data) / "com.yarick.besiege-aero-analyzer" / "mesh-cache" / GAME_VERSION


def load_policy(path: Path) -> tuple[str, dict[int, dict[str, Any]]]:
    policy = json.loads(path.read_text(encoding="utf-8"))
    if policy.get("schemaVersion") != 1 or policy.get("gameVersion") != GAME_VERSION:
        raise RuntimeError(f"Unsupported mesh policy {path}")
    return str(policy["defaultMode"]), {int(entry["id"]): entry for entry in policy.get("overrides", [])}


def build_visual_tree(transform_id: int, objects: dict[int, Any]) -> VisualNode:
    def visit(current_id: int, parent_path: str, under_vis: bool, ancestors_active: bool, root: bool = False) -> VisualNode:
        transform = objects[current_id].parse_as_dict()
        game_object = objects[pointer_path_id(transform["m_GameObject"])].parse_as_dict()
        name = str(game_object.get("m_Name", ""))
        path = f"{parent_path}/{name}"
        next_under_vis = under_vis or name.lower() == "vis"
        # Prefab roots are intentionally inactive in level0. Ignore only the root
        # flag; local inactive child variants remain excluded by default.
        local_active = True if root else bool(game_object.get("m_IsActive", True))
        active = ancestors_active and local_active
        ids = component_ids(game_object)
        renderer_components = [
            objects[value] for value in ids
            if objects[value].type.name in ("MeshRenderer", "SkinnedMeshRenderer")
        ]
        has_renderer = bool(renderer_components)
        renderer_enabled = any(bool(value.parse_as_dict().get("m_Enabled", True)) for value in renderer_components)
        pointers: list[Any] = []
        if has_renderer:
            for component_id in ids:
                component_type = objects[component_id].type.name
                if component_type == "MeshFilter":
                    pointer = objects[component_id].parse_as_object().m_Mesh
                elif component_type == "SkinnedMeshRenderer":
                    pointer = objects[component_id].parse_as_object().m_Mesh
                else:
                    continue
                if getattr(pointer, "path_id", 0):
                    pointers.append(pointer)
        node = VisualNode(
            name=name,
            path=path,
            active=active,
            under_vis=next_under_vis,
            position=vec3(transform["m_LocalPosition"]),
            rotation=quat(transform["m_LocalRotation"]),
            scale=vec3(transform["m_LocalScale"]),
            renderer_enabled=renderer_enabled,
            mesh_pointers=pointers,
        )
        node.children = [
            visit(child_id, path, next_under_vis, active)
            for child in transform.get("m_Children", [])
            if (child_id := pointer_path_id(child))
        ]
        return node

    return visit(transform_id, "", False, True, root=True)


def flatten_nodes(root: VisualNode) -> Iterable[VisualNode]:
    yield root
    for child in root.children:
        yield from flatten_nodes(child)


def select_visual_nodes(root: VisualNode, policy: dict[str, Any]) -> list[VisualNode]:
    candidates = [node for node in flatten_nodes(root) if node.active and node.renderer_enabled and node.mesh_pointers]
    prefixes = [str(value) for value in policy.get("includePathPrefixes", [])]
    if prefixes:
        selected = [node for node in candidates if any(node.path == prefix or node.path.startswith(prefix + "/") for prefix in prefixes)]
    else:
        under_vis = [node for node in candidates if node.under_vis]
        selected = under_vis or candidates
    if not selected:
        raise RuntimeError(f"No active visual MeshFilter matches policy for {root.name}")
    return selected


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--besiege-root", type=Path, required=True)
    parser.add_argument("--game-version", default=GAME_VERSION)
    parser.add_argument("--unity-version", default=UNITY_VERSION)
    parser.add_argument("--policy", type=Path, default=Path(__file__).resolve().parents[1] / "data" / "vanilla-visual-mesh-policy.json")
    parser.add_argument("--output-dir", type=Path, default=None)
    args = parser.parse_args()
    if args.game_version != GAME_VERSION:
        raise RuntimeError(f"This extractor policy supports Besiege {GAME_VERSION}, got {args.game_version}")

    data_dir = args.besiege_root / "Besiege_Data"
    managed_dir = data_dir / "Managed"
    level0_path = data_dir / "level0"
    output_dir = args.output_dir or default_output_directory()
    output_dir.mkdir(parents=True, exist_ok=True)
    default_mode, overrides = load_policy(args.policy)

    environment = UnityPy.load(str(level0_path))
    generator = TypeTreeGenerator(args.unity_version)
    generator.load_local_dll_folder(str(managed_dir))
    environment.typetree_generator = generator
    objects = {obj.path_id: obj for obj in environment.objects}

    builder = GlbBuilder()
    scene_nodes: list[int] = []
    extracted: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    seen_ids: set[int] = set()
    for obj in environment.objects:
        if obj.type.name != "MonoBehaviour":
            continue
        try:
            head = obj.parse_monobehaviour_head()
            if head.m_Script.deref_parse_as_object().m_ClassName != "BlockPrefabContainer":
                continue
            container = parse_container_prefix(obj)
        except Exception:
            continue

        info = container["Info"]
        block_id = int(info["ID"])
        block_type = str(info["name"])
        if block_id in seen_ids:
            raise RuntimeError(f"Duplicate vanilla block ID {block_id}")
        seen_ids.add(block_id)
        block_policy = {"mode": default_mode, **overrides.get(block_id, {})}
        if block_policy["mode"] not in ("static-prefab", "shortening-prefab"):
            excluded.append({"id": block_id, "type": block_type, "policy": block_policy["mode"], "reason": block_policy.get("reason", "")})
            continue

        root_game_object = objects[pointer_path_id(container["m_GameObject"])].parse_as_dict()
        root_transform_id = next(
            component_id for component_id in component_ids(root_game_object)
            if objects[component_id].type.name in ("Transform", "RectTransform")
        )
        visual_root = build_visual_tree(root_transform_id, objects)
        if block_policy["mode"] == "shortening-prefab":
            variant_entries: dict[str, Any] = {}
            all_nodes = list(flatten_nodes(visual_root))
            for variant_name in ("full", "short"):
                variant_policy = block_policy["variants"][variant_name]
                renderer_path = str(variant_policy["rendererPath"])
                selected = [node for node in all_nodes if node.active and node.path == renderer_path and node.mesh_pointers]
                if len(selected) != 1:
                    raise RuntimeError(f"Block {block_id} {variant_name} expected one renderer at {renderer_path}, found {len(selected)}")
                node_name = f"block_{block_id}_{variant_name}"
                root_node_index = builder.emit_visual_tree(
                    visual_root, {id(node) for node in selected}, block_id, block_type, node_name=node_name,
                )
                scene_nodes.append(root_node_index)
                variant_entries[variant_name] = {
                    "nodeName": node_name,
                    "length": int(variant_policy["length"]),
                    "rendererCount": sum(len(node.mesh_pointers) for node in selected),
                    "rendererPaths": [node.path for node in selected],
                }
            extracted.append({
                "id": block_id,
                "type": block_type,
                "nodeName": variant_entries["full"]["nodeName"],
                "policy": "shortening-prefab",
                "rendererCount": sum(entry["rendererCount"] for entry in variant_entries.values()),
                "rendererPaths": [path for entry in variant_entries.values() for path in entry["rendererPaths"]],
                "variants": variant_entries,
                "note": block_policy.get("reason", ""),
            })
        else:
            selected = select_visual_nodes(visual_root, block_policy)
            root_node_index = builder.emit_visual_tree(visual_root, {id(node) for node in selected}, block_id, block_type)
            scene_nodes.append(root_node_index)
            extracted.append({
                "id": block_id,
                "type": block_type,
                "nodeName": f"block_{block_id}",
                "policy": "static-prefab",
                "rendererCount": sum(len(node.mesh_pointers) for node in selected),
                "rendererPaths": [node.path for node in selected],
                "note": block_policy.get("reason", ""),
            })

    if len(seen_ids) != 103:
        raise RuntimeError(f"Expected 103 vanilla block IDs, found {len(seen_ids)}")
    extracted.sort(key=lambda entry: entry["id"])
    excluded.sort(key=lambda entry: entry["id"])
    scene_nodes.sort(key=lambda index: (int(builder.nodes[index]["extras"]["blockId"]), builder.nodes[index]["name"]))
    glb_path = output_dir / CACHE_FILE_NAME
    builder.write(glb_path, scene_nodes)

    source_paths = [
        managed_dir / "Assembly-CSharp.dll",
        level0_path,
        data_dir / "sharedassets0.assets",
        data_dir / "sharedassets0.assets.resS",
    ]
    manifest = {
        "schemaVersion": CACHE_SCHEMA_VERSION,
        "gameVersion": args.game_version,
        "unityVersion": args.unity_version,
        "cacheFormat": "glb-geometry-only",
        "glbFile": CACHE_FILE_NAME,
        "meshDataExtracted": True,
        "texturesExtracted": False,
        "materialsExtracted": False,
        "collidersExtracted": False,
        "coordinateConvention": {
            "positions": "Unity numeric XYZ preserved in the existing machine-local Three.js frame",
            "normals": "Unity decoded normals preserved",
            "triangleWinding": "MeshHandler winding preserved after verified positive face-normal dot products",
            "rootTransform": "Prefab root ignored; BSG position/quaternion/scale is applied by the Inspector",
        },
        "sources": [source_fingerprint(path) for path in source_paths],
        "policyFile": args.policy.name,
        "blockCount": len(extracted),
        "excludedCount": len(excluded),
        "uniqueMeshCount": len(builder.meshes),
        "nodeCount": len(builder.nodes),
        "glbByteLength": glb_path.stat().st_size,
        "blocks": extracted,
        "excludedBlocks": excluded,
    }
    manifest_path = output_dir / MANIFEST_FILE_NAME
    temporary_manifest = manifest_path.with_suffix(".json.tmp")
    temporary_manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary_manifest.replace(manifest_path)
    print(json.dumps({
        "cacheDirectory": str(output_dir),
        "manifest": str(manifest_path),
        "glb": str(glb_path),
        "blockCount": len(extracted),
        "excludedCount": len(excluded),
        "uniqueMeshCount": len(builder.meshes),
        "glbByteLength": glb_path.stat().st_size,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
