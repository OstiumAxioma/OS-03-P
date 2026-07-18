# Y-up Physical Slice Glass Design

## Goal

Restore Three.js' default Y-up coordinate convention, pull the active slice along world Y+, and render every medical slice as a physically scaled tissue slab inside a complete glass slab.

## Coordinate system

- X is lateral screen/world movement.
- Y is world up and the active extraction direction.
- Z is slice-stack depth.
- Slice faces lie in the XY plane and their physical depth lies on Z.
- The camera, debug axis, ground, lighting, animation copy, and README use the same convention.

## Physical dimensions

The displayed plane is fitted to the existing maximum width and height using physical dimensions rather than pixel aspect alone:

```text
physicalWidth  = textureWidth  * spacingX
physicalHeight = textureHeight * spacingY
sceneScale     = min(maxWidth / physicalWidth, maxHeight / physicalHeight)
worldWidth     = physicalWidth  * sceneScale
worldHeight    = physicalHeight * sceneScale
worldThickness = spacingZ       * sceneScale
```

This preserves the physical ratio between in-plane size and slice spacing. Placeholder glass keeps a fixed preview thickness because it has no study metadata.

## Slice construction

Each loaded slice contains two centered `BoxGeometry` meshes:

1. An outer glass box using `MeshPhysicalNodeMaterial` on all six faces. It uses transmission, low-to-medium roughness, IOR, attenuation, clearcoat, and PMREM environment lighting to match the pale glass reference.
2. An inner tissue box using `MeshSSSNodeMaterial` on all six faces. It has the exact same Z thickness as the glass box and is inset only in X/Y to expose the glass perimeter.

The tissue mesh renders first. The glass mesh renders afterward with depth writing disabled, so it optically covers the tissue without creating a second surface-only medical plane. Transparent air remains discarded by the tissue alpha map.

## Motion and verification

The existing X offset and sinusoidal X wave remain. Activation keeps Z fixed and makes Y+ the dominant extraction. Unit tests cover coordinate invariants and physical dimension conversion. Browser verification covers the placeholder glass reference, a real DICOM upload, the Y+ hover motion, visible tissue side thickness, WebGPU availability, and console errors.

