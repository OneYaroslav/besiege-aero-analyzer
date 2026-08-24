#!/usr/bin/env python3
"""Print exact visual hierarchy/transforms/bounds for selected vanilla prefabs."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import UnityPy
from UnityPy.helpers.TypeTreeGenerator import TypeTreeGenerator

from extract_unity_masses import parse_container_prefix, pointer_path_id
from extract_unity_visual_bounds import (
    aabb_corners,
    component_ids,
    quat,
    transform_point,
    vec3,
)


def bounds(points: list[tuple[float, float, float]]) -> dict[str, list[float]] | None:
    if not points:
        return None
    minimum = [min(point[axis] for point in points) for axis in range(3)]
    maximum = [max(point[axis] for point in points) for axis in range(3)]
    return {
        "minimum": minimum,
        "maximum": maximum,
        "center": [(minimum[axis] + maximum[axis]) / 2 for axis in range(3)],
        "size": [maximum[axis] - minimum[axis] for axis in range(3)],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--besiege-root", type=Path, required=True)
    parser.add_argument("--ids", default="26,55,63,41")
    parser.add_argument("--unity-version", default="5.4.0f3")
    args = parser.parse_args()
    selected_ids = {int(value) for value in args.ids.split(",")}

    data_dir = args.besiege_root / "Besiege_Data"
    environment = UnityPy.load(str(data_dir / "level0"))
    generator = TypeTreeGenerator(args.unity_version)
    generator.load_local_dll_folder(str(data_dir / "Managed"))
    environment.typetree_generator = generator
    objects = {obj.path_id: obj for obj in environment.objects}
    result: list[dict[str, Any]] = []

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
        if block_id not in selected_ids:
            continue

        root_go = objects[pointer_path_id(container["m_GameObject"])].parse_as_dict()
        root_transform_id = next(
            component_id for component_id in component_ids(root_go)
            if objects[component_id].type.name in ("Transform", "RectTransform")
        )
        nodes: list[dict[str, Any]] = []

        def visit(transform_id: int, parent_path: str, chain: list[Any], root: bool = False) -> None:
            transform = objects[transform_id].parse_as_dict()
            go = objects[pointer_path_id(transform["m_GameObject"])].parse_as_dict()
            name = str(go.get("m_Name", ""))
            path = f"{parent_path}/{name}"
            local = (vec3(transform["m_LocalPosition"]), quat(transform["m_LocalRotation"]), vec3(transform["m_LocalScale"]))
            next_chain = chain if root else [*chain, local]
            ids = component_ids(go)
            component_types = [objects[value].type.name for value in ids]
            mesh_records: list[dict[str, Any]] = []
            for component_id in ids:
                component_type = objects[component_id].type.name
                if component_type == "MeshFilter":
                    mesh_pointer = objects[component_id].parse_as_object().m_Mesh
                    renderer_enabled = None
                elif component_type == "SkinnedMeshRenderer":
                    component = objects[component_id].parse_as_object()
                    mesh_pointer = component.m_Mesh
                    renderer_enabled = bool(component.m_Enabled)
                else:
                    continue
                if not getattr(mesh_pointer, "path_id", 0):
                    continue
                mesh = mesh_pointer.deref_parse_as_object()
                local_aabb = getattr(mesh, "m_LocalAABB", None)
                points = [] if not local_aabb else [transform_point(point, next_chain) for point in aabb_corners(local_aabb)]
                mesh_records.append({
                    "mesh": str(getattr(mesh, "m_Name", "")),
                    "meshPathId": int(mesh_pointer.path_id),
                    "rendererEnabled": renderer_enabled,
                    "rootBounds": bounds(points),
                })
            renderers = []
            mono_behaviours = []
            for component_id in ids:
                component_obj = objects[component_id]
                if component_obj.type.name == "MeshRenderer":
                    renderers.append({"type": "MeshRenderer", "enabled": bool(component_obj.parse_as_dict().get("m_Enabled", True))})
                elif component_obj.type.name == "MonoBehaviour":
                    try:
                        mono_head = component_obj.parse_monobehaviour_head()
                        mono_behaviours.append(str(mono_head.m_Script.deref_parse_as_object().m_ClassName))
                    except Exception as cause:
                        mono_behaviours.append(f"<unparsed:{cause}>")
            nodes.append({
                "path": path,
                "active": bool(go.get("m_IsActive", True)),
                "localPosition": list(local[0]),
                "localRotation": list(local[1]),
                "localScale": list(local[2]),
                "components": component_types,
                "renderers": renderers,
                "monoBehaviours": mono_behaviours,
                "meshes": mesh_records,
            })
            for child in transform.get("m_Children", []):
                child_id = pointer_path_id(child)
                if child_id:
                    visit(child_id, path, next_chain)

        visit(root_transform_id, "", [], root=True)
        result.append({"id": block_id, "type": str(info["name"]), "nodes": nodes})

    print(json.dumps(sorted(result, key=lambda item: item["id"]), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
