#!/usr/bin/env python3
"""Extract vanilla block Rigidbody metadata from Besiege's serialized level0.

Requires UnityPy plus TypeTreeGeneratorAPI. The script only reads game files and
writes the resulting JSON to stdout so the checked-in database can be reviewed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import UnityPy
from UnityPy.helpers.TypeTreeGenerator import TypeTreeGenerator


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def pointer_path_id(value: Any) -> int:
    if not isinstance(value, dict):
        return 0
    return int(value.get("m_PathID", 0))


def parse_container_prefix(obj: Any) -> dict[str, Any]:
    """Parse the stable BlockPrefabContainer prefix through Info.name.

    The installed Assembly contains Info fields added after level0 was
    serialized. Type/ID/name precede that version boundary and are verified by
    PrefabMaster.InitPrefab. Rigidbody is discovered from the root GameObject's
    built-in component list, not from a potentially shifted custom pointer.
    """
    node = obj.generate_monobehaviour_node()
    info_index = next(index for index, child in enumerate(node.m_Children) if child.m_Name == "Info")
    node.m_Children = node.m_Children[: info_index + 1]
    info_node = node.m_Children[info_index]
    name_index = next(index for index, child in enumerate(info_node.m_Children) if child.m_Name == "name")
    info_node.m_Children = info_node.m_Children[: name_index + 1]
    return obj.parse_as_dict(node=node, check_read=False)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--besiege-root", type=Path, required=True)
    parser.add_argument("--game-version", default="1.90-25346")
    parser.add_argument("--unity-version", default="5.4.0f3")
    args = parser.parse_args()

    data_dir = args.besiege_root / "Besiege_Data"
    managed_dir = data_dir / "Managed"
    level0_path = data_dir / "level0"
    assembly_path = managed_dir / "Assembly-CSharp.dll"

    environment = UnityPy.load(str(level0_path))
    generator = TypeTreeGenerator(args.unity_version)
    generator.load_local_dll_folder(str(managed_dir))
    environment.typetree_generator = generator
    objects = {obj.path_id: obj for obj in environment.objects}

    blocks: list[dict[str, Any]] = []
    for obj in environment.objects:
        if obj.type.name != "MonoBehaviour":
            continue
        try:
            head = obj.parse_monobehaviour_head()
            script = head.m_Script.deref_parse_as_object()
            if script.m_ClassName != "BlockPrefabContainer":
                continue
            container = parse_container_prefix(obj)
        except Exception:
            continue

        info = container["Info"]
        game_object_path_id = pointer_path_id(container["m_GameObject"])
        game_object = head.m_GameObject.deref_parse_as_object()
        game_object_data = objects[game_object_path_id].parse_as_dict()
        component_path_ids = [pointer_path_id(pointer) for _class_id, pointer in game_object_data["m_Component"]]
        rigidbody_path_id = next(
            (path_id for path_id in component_path_ids if objects[path_id].type.name == "Rigidbody"),
            0,
        )
        rigidbody = objects[rigidbody_path_id].parse_as_dict() if rigidbody_path_id else None

        entry: dict[str, Any] = {
            "id": int(info["ID"]),
            "type": str(info["name"]),
            "prefabGameObject": game_object.m_Name,
            "hasRigidbody": rigidbody is not None,
            "mass": float(rigidbody["m_Mass"]) if rigidbody else None,
            "massProvenance": "prefab-verified",
            "localCenterOfMass": None,
            "centerOfMassProvenance": "runtime-required" if rigidbody else "not-applicable",
            "inertiaTensor": None,
            "inertiaTensorRotation": None,
            "inertiaProvenance": "runtime-required" if rigidbody else "not-applicable",
            "serializedRigidbody": None,
        }
        if rigidbody:
            entry["serializedRigidbody"] = {
                "drag": float(rigidbody["m_Drag"]),
                "angularDrag": float(rigidbody["m_AngularDrag"]),
                "useGravity": bool(rigidbody["m_UseGravity"]),
                "isKinematicInPrefab": bool(rigidbody["m_IsKinematic"]),
            }
        blocks.append(entry)

    blocks.sort(key=lambda entry: entry["id"])
    ids = [entry["id"] for entry in blocks]
    if len(blocks) != 103 or len(set(ids)) != len(ids):
        raise RuntimeError(f"Expected 103 unique vanilla prefabs, found {len(blocks)} entries / {len(set(ids))} IDs")
    rigidbody_count = sum(1 for entry in blocks if entry["hasRigidbody"])
    if rigidbody_count != 101:
        raise RuntimeError(f"Expected 101 Rigidbody prefabs, found {rigidbody_count}")

    result = {
        "schemaVersion": 1,
        "gameVersion": args.game_version,
        "unityVersion": args.unity_version,
        "assemblyCSharpSha256": sha256(assembly_path),
        "source": {
            "asset": "Besiege_Data/level0",
            "mapping": "BlockPrefabContainer.Info.ID -> root GameObject Rigidbody component",
            "extractor": "tools/extract_unity_masses.py",
            "notes": [
                "m_Mass is serialized and prefab-verified.",
                "Unity 5.4 Rigidbody serialization in this asset has no centerOfMass or inertia fields.",
                "Runtime exporter is required for exact local COM and inertia.",
            ],
        },
        "blocks": blocks,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
