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
physicalWidth  = originalDimensionX * spacingX
physicalHeight = originalDimensionY * spacingY
sceneScale     = min(maxWidth / physicalWidth, maxHeight / physicalHeight)
worldWidth     = physicalWidth  * sceneScale
worldHeight    = physicalHeight * sceneScale
worldThickness = spacingZ       * sceneScale
```

This preserves the physical ratio between in-plane size and slice spacing even when server textures are downsampled to 512 pixels. Placeholder glass keeps a fixed preview thickness because it has no study metadata.

After the physical base thickness is calculated, the UI can apply an independent `0.25x` to `20x` Z-thickness multiplier. Stack centers are recalculated from `currentThickness + fixedSurfaceGap`, so changing thickness never changes the visible gap or overlaps adjacent slabs.

## Slice construction

Each loaded slice contains two centered `BoxGeometry` meshes:

1. An outer glass box using `MeshPhysicalNodeMaterial` on all six faces. It uses transmission, low-to-medium roughness, IOR, attenuation, clearcoat, and PMREM environment lighting to match the pale glass reference.
2. An inner tissue box using `MeshSSSNodeMaterial` on all six faces. It has the exact same Z thickness as the glass box and is inset only in X/Y to expose the glass perimeter.

The tissue mesh renders first. The glass mesh renders afterward with depth writing disabled, so it optically covers the tissue without creating a second surface-only medical plane. Transparent air remains discarded by the tissue alpha map.

Neither mesh nor its parent group is rotated. Every slice face stays in world XY and every thickness normal stays exactly parallel to world Z; the isometric appearance comes only from the camera.

All outer glass boxes use one world-Y bottom baseline. Their center Y is derived as `baselineY + boxHeight / 2`, rather than assuming every box can be center-aligned at Y=0. Resting slices also share exactly the same X coordinate and differ only in Z; with a zero surface gap they would form one continuous rectangular prism without a stepped edge.

## Motion and verification

The active slice's X travel and sinusoidal X wave remain, but the resting stack has no per-layer X offset. Activation keeps Z fixed and makes Y+ the dominant extraction. Unit tests cover coordinate invariants and physical dimension conversion. Browser verification covers the placeholder glass reference, a real DICOM upload, the Y+ hover motion, visible tissue side thickness, WebGPU availability, and console errors.
