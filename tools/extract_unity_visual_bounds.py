#!/usr/bin/env python3
"""Extract renderer AABBs from vanilla block prefabs without exporting meshes.

The output contains only combined root-local bounds and provenance. It never
copies vertex/index buffers, materials, textures, or proprietary Unity meshes.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import UnityPy
from UnityPy.helpers.TypeTreeGenerator import TypeTreeGenerator

from extract_unity_masses import parse_container_prefix, pointer_path_id


def component(value: Any, name: str) -> Any:
    if isinstance(value, dict):
        return value[name]
    return getattr(value, name)


def vec3(value: Any) -> tuple[float, float, float]:
    return float(component(value, "x")), float(component(value, "y")), float(component(value, "z"))


def quat(value: Any) -> tuple[float, float, float, float]:
    return (
        float(component(value, "x")),
        float(component(value, "y")),
        float(component(value, "z")),
        float(component(value, "w")),
    )


def rotate(q: tuple[float, float, float, float], v: tuple[float, float, float]) -> tuple[float, float, float]:
    x, y, z, w = q
    length = math.sqrt(x * x + y * y + z * z + w * w)
    x, y, z, w = x / length, y / length, z / length, w / length
    vx, vy, vz = v
    tx = 2 * (y * vz - z * vy)
    ty = 2 * (z * vx - x * vz)
    tz = 2 * (x * vy - y * vx)
    return (
        vx + w * tx + (y * tz - z * ty),
        vy + w * ty + (z * tx - x * tz),
        vz + w * tz + (x * ty - y * tx),
    )


def transform_point(
    point: tuple[float, float, float],
    chain: list[tuple[tuple[float, float, float], tuple[float, float, float, float], tuple[float, float, float]]],
) -> tuple[float, float, float]:
    result = point
    for position, rotation, scale in reversed(chain):
        result = rotate(rotation, (result[0] * scale[0], result[1] * scale[1], result[2] * scale[2]))
        result = result[0] + position[0], result[1] + position[1], result[2] + position[2]
    return result


def component_ids(game_object: dict[str, Any]) -> list[int]:
    return [pointer_path_id(pointer) for _class_id, pointer in game_object.get("m_Component", [])]


def aabb_corners(aabb: Any) -> list[tuple[float, float, float]]:
    center = vec3(component(aabb, "m_Center"))
    extent = vec3(component(aabb, "m_Extent"))
    return [
        (center[0] + sx * extent[0], center[1] + sy * extent[1], center[2] + sz * extent[2])
        for sx in (-1, 1)
        for sy in (-1, 1)
        for sz in (-1, 1)
    ]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--besiege-root", type=Path, required=True)
    parser.add_argument("--unity-version", default="5.4.0f3")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    data_dir = args.besiege_root / "Besiege_Data"
    environment = UnityPy.load(str(data_dir / "level0"))
    generator = TypeTreeGenerator(args.unity_version)
    generator.load_local_dll_folder(str(data_dir / "Managed"))
    environment.typetree_generator = generator
    objects = {obj.path_id: obj for obj in environment.objects}

    entries: list[dict[str, Any]] = []
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
        root_game_object_id = pointer_path_id(container["m_GameObject"])
        root_game_object = objects[root_game_object_id].parse_as_dict()
        root_transform_id = next(
            component_id for component_id in component_ids(root_game_object)
            if objects[component_id].type.name in ("Transform", "RectTransform")
        )
        renderer_records: list[tuple[str, bool, list[tuple[float, float, float]]]] = []

        def visit(transform_id: int, chain: list[Any], root: bool = False, under_vis: bool = False) -> None:
            transform = objects[transform_id].parse_as_dict()
            game_object_id = pointer_path_id(transform["m_GameObject"])
            game_object = objects[game_object_id].parse_as_dict()
            name = str(game_object.get("m_Name", ""))
            next_under_vis = under_vis or name.lower() == "vis"
            local = (
                vec3(transform["m_LocalPosition"]),
                quat(transform["m_LocalRotation"]),
                vec3(transform["m_LocalScale"]),
            )
            next_chain = chain if root else [*chain, local]
            ids = component_ids(game_object)
            has_renderer = any(
                objects[value].type.name in ("MeshRenderer", "SkinnedMeshRenderer")
                and bool(objects[value].parse_as_dict().get("m_Enabled", True))
                for value in ids
            )
            if has_renderer:
                for component_id in ids:
                    component_type = objects[component_id].type.name
                    if component_type == "MeshFilter":
                        mesh_pointer = objects[component_id].parse_as_object().m_Mesh
                    elif component_type == "SkinnedMeshRenderer":
                        mesh_pointer = objects[component_id].parse_as_object().m_Mesh
                    else:
                        continue
                    if not getattr(mesh_pointer, "path_id", 0):
                        continue
                    mesh = mesh_pointer.deref_parse_as_object()
                    aabb = getattr(mesh, "m_LocalAABB", None)
                    if not aabb:
                        continue
                    renderer_records.append((
                        name,
                        next_under_vis,
                        [transform_point(point, next_chain) for point in aabb_corners(aabb)],
                    ))
            for child in transform.get("m_Children", []):
                child_id = pointer_path_id(child)
                if child_id:
                    visit(child_id, next_chain, under_vis=next_under_vis)

        visit(root_transform_id, [], root=True)
        primary_records = [record for record in renderer_records if record[1]]
        selected_records = primary_records or renderer_records
        renderer_names = [record[0] for record in selected_records]
        points = [point for _name, _under_vis, record_points in selected_records for point in record_points]
        if points:
            minimum = [min(point[axis] for point in points) for axis in range(3)]
            maximum = [max(point[axis] for point in points) for axis in range(3)]
            center = [(minimum[axis] + maximum[axis]) / 2 for axis in range(3)]
            size = [maximum[axis] - minimum[axis] for axis in range(3)]
        else:
            center = size = None
        entries.append({
            "id": int(info["ID"]),
            "type": str(info["name"]),
            "rootLocalRendererBounds": None if center is None else {"center": center, "size": size},
            "rendererCount": len(renderer_names),
            "rendererGameObjects": sorted(set(renderer_names)),
            "provenance": "prefab-renderer-aabb" if center is not None else "runtime-or-procedural-required",
        })

    entries.sort(key=lambda entry: entry["id"])
    result = json.dumps({
        "schemaVersion": 1,
        "gameVersion": "1.90-25346",
        "source": "Besiege_Data/level0 prefab renderer Mesh local AABBs transformed to block-root local frame",
        "meshDataExtracted": False,
        "blocks": entries,
    }, ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(result + "\n", encoding="utf-8")
    else:
        print(result)


if __name__ == "__main__":
    main()
