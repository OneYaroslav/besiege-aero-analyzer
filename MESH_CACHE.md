# Local Besiege visual mesh cache

The desktop 3D Inspector can replace schematic primitives with geometry-only visual meshes extracted from the user's installed Besiege 1.90-25346. No textures, Unity materials, shaders, colliders or aerodynamic axes are exported.

## Build the cache

Close and reopen the desktop application after extraction:

```powershell
.\extract-mesh-cache.ps1
```

The launcher uses the standard Steam installation path by default. A different installation can be supplied explicitly:

```powershell
.\extract-mesh-cache.ps1 -BesiegeRoot "D:\SteamLibrary\steamapps\common\Besiege"
```

Python dependencies are pinned in `tools/mesh-extractor-requirements.txt` and installed project-locally under ignored `.tools/` when missing. The extractor reads the installed Unity assets and writes the cache to:

```text
%LOCALAPPDATA%\com.yarick.besiege-aero-analyzer\mesh-cache\1.90-25346\
  manifest.json
  vanilla-blocks.glb
```

The generated files are deliberately outside the repository and are not included in the Tauri installer. Browser/Vite mode cannot read this desktop-local path and keeps the schematic fallback.

## Cache contents and versioning

`vanilla-blocks.glb` contains positions, normals, triangle indices and the selected prefab child transforms. Static blocks use a `block_<ID>` scene root. `ShorteningBlock` ids 41/63 additionally store `block_<ID>_full` and `block_<ID>_short` roots. A single neutral Three.js material is assigned at runtime.

`manifest.json` records:

- cache schema and game version;
- Unity version used for type-tree decoding;
- SHA-256 and file size for `Assembly-CSharp.dll`, `level0`, `sharedassets0.assets` and its resource file;
- ID/type/prefab renderer paths;
- the explicit extraction/fallback policy;
- GLB byte length and geometry-only flags.

The current policy extracts 91 of 103 vanilla IDs. It includes Propeller id=26, SmallPropeller id=55, Slider id=42, both verified WoodenPole/Log length variants, structural blocks and prefabs with multiple visual child meshes.

The following IDs intentionally remain procedural or schematic because the loaded-machine shape depends on serialized endpoints, mapper values or runtime state:

| ID | Type | Policy |
|---:|---|---|
| 7 | Brace | procedural endpoints |
| 9 | Spring | procedural endpoints/runtime extension |
| 16 | Suspension | schematic fallback |
| 18 | Piston | schematic fallback |
| 45 | RopeWinch | procedural endpoints/runtime length |
| 71 | BuildNode | procedural construction topology |
| 72 | BuildEdge | procedural GUID endpoints |
| 73 | BuildSurface | procedural GUID surface links |
| 75 | RopeMeasure | procedural endpoints |
| 78 | Sail | schematic fallback for runtime deformation |
| 96 | FuelLine | procedural endpoints/runtime connection |
| 97 | Parachute | schematic fallback for packed/deployed state |

Harpoon id=84 uses only its stable `/Harpoon/Vis` hierarchy; runtime projectile and rope children are excluded.

Slider id=42 uses its verified static `/Slider/Vis` mesh. `SliderBlock.SetDefaultExtension` changes the joint trigger, collider state and root placement for `preextended`, but does not replace or deform the visual mesh.

WoodenPole id=41 and Log id=63 use exact installed `Vis`/`HalfVis` meshes. The renderer selects the short template only when serialized `length == startingLength - 1`, matching `ShorteningBlock.UpdateLength`; no geometry is stretched.

## Coordinate and rendering policy

- Unity mesh numeric XYZ, normals and verified triangle winding are preserved because the existing BSG/Three.js machine-local scene already uses that numeric frame.
- Prefab visual child transforms are preserved.
- The prefab root is replaced with the parsed BSG block position, quaternion and scale.
- Negative BSG scale remains on the Three.js root; Three.js handles the resulting world-transform handedness during rendering.
- Blade visuals use the complete installed game transform chain: Machine `Global` transform, BSG block position/quaternion/scale, extracted prefab child position/scale, and `PropellorController.CheckFlipDirection` replacing `Vis.localEulerAngles` with `(0, -180°, -23°)` for normal or `(0, -180°, +23°)` for flipped. Three.js performs the hierarchical quaternion/matrix multiplication; angles are not added manually. The recovered aerodynamic `forceAxis` and `senseAxis` remain separate optional overlays.
- Unity numeric XYZ and x/y/z/w quaternion components remain in the Analyzer's documented machine-axis basis rather than being reflected a second time. This is intentional: block roots, prefab vertices, child transforms and machine axes all use the same preserved basis. A separate handedness reflection would mirror the assembled machine. Three.js handles negative-scale front-face reversal while composing the actual hierarchy.
- Colliders and physics formulas are not read or changed by this cache.

## Known limitations

- The cache targets only the verified installed Besiege 1.90-25346 assets. A different build must be investigated and extracted into its own versioned cache.
- Animated and runtime-generated visual states are intentionally not reconstructed unless an explicit verified variant policy exists. WoodenPole/Log shortening is currently the supported mapper-dependent exception.
- Skins and modded block meshes are not included.
- Geometry uses a neutral material, so visual differences that exist only in textures/materials are absent.
- AnalysisGroup selection is still responsible for deciding which BSG block roots are displayed; the cache does not infer physical connectivity.
