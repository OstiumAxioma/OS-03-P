# Y-up Physical Slice Glass Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Render physical-thickness tissue inside full glass boxes while restoring Three.js Y-up and moving hover extraction to Y+.

**Architecture:** Add a pure slice-dimension helper that maps image spacing to scene units. Keep server payloads unchanged, rebuild each client slice as separate tissue and glass boxes with equal Z depth, and remap the scene from Z-up to Y-up.

**Tech Stack:** Next.js, TypeScript, Three.js WebGPU/TSL, vtk.js, Vitest, Playwright CLI.

---

### Task 1: Define physical slice dimensions

**Files:**
- Create: `src/lib/sliceGeometry.ts`
- Create: `src/lib/sliceGeometry.test.ts`

1. Write failing tests requiring pixel spacing to affect face aspect and requiring world thickness to equal `spacingZ * sceneScale`.
2. Run `npm test -- --run src/lib/sliceGeometry.test.ts` and confirm failure because the module does not exist.
3. Implement `calculateSliceWorldDimensions` with positive-spacing fallbacks and physical fit scaling.
4. Re-run the targeted test and confirm it passes.

### Task 2: Restore Y-up motion

**Files:**
- Modify: `src/lib/sliceMotion.ts`
- Modify: `src/lib/sliceMotion.test.ts`

1. Change tests so layout stacks along Z and activation preserves Z while moving dominantly along Y+ and retaining X travel.
2. Run the targeted test and confirm the old Z-up implementation fails.
3. Rename `rotationZ` to `rotationY` and implement the Y-up layout/target.
4. Re-run targeted tests and confirm they pass.

### Task 3: Build glass and tissue volumes

**Files:**
- Modify: `src/components/SliceAtlas.tsx`

1. Restore default camera/axis Y-up and remap camera, lights, and ground.
2. Calculate physical world dimensions for loaded data.
3. Create a tissue `BoxGeometry` and a glass `BoxGeometry` with identical Z thickness; inset tissue only in X/Y.
4. Apply SSS material to all tissue faces and physical glass material to all glass faces.
5. Preserve X wave, animate Y+ extraction, raycast the outer glass box, and update debug labels/UI copy.
6. Run targeted tests and `npm run build`.

### Task 4: Document and visually verify

**Files:**
- Modify: `README.md`

1. Document Y-up and spacing-derived equal glass/tissue thickness.
2. Run the complete test suite and production build.
3. Start the isolated dev server, capture the placeholder state at the reference viewport, upload the DICOM fixture, hover a slice, and inspect console errors.
4. Compare the result with the supplied glass reference and adjust only material parameters if necessary.

