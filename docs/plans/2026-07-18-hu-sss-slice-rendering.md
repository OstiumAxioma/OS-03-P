# HU Tissue Slice SSS Rendering Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Render every medical slice as one sharp-edged box with HU-colored, air-transparent tissue and GPU subsurface scattering in a Z-up scene.

**Architecture:** The Node processing layer converts scalar voxels into RGBA tissue color, roughness, and SSS thickness textures. The client uses one `BoxGeometry` per slice, a `MeshSSSNodeMaterial` for front/back tissue faces, a physical side material, and a `WebGPURenderer` with WebGL2 fallback and PMREM environment lighting.

**Tech Stack:** Next.js 16, TypeScript, vtk.js, ITK-Wasm, Three.js WebGPU/TSL, Vitest, Playwright CLI.

---

### Task 1: Define HU tissue transfer output

**Files:**
- Modify: `src/lib/medicalVolume.test.ts`
- Modify: `src/lib/medicalVolume.ts`

**Step 1: Write the failing tests**

Add assertions that `mapHuToTissue(-1000)` returns alpha 0, fat is yellow-biased, soft tissue is red-biased, bone is bright and dense, and neighboring HU values interpolate continuously. Add an assertion that `createSliceTextureData` returns RGBA, roughness, and thickness buffers.

**Step 2: Run test to verify it fails**

Run: `npm test -- --run src/lib/medicalVolume.test.ts`

Expected: FAIL because `mapHuToTissue` and the thickness output do not exist and air currently has non-zero alpha.

**Step 3: Implement the transfer function**

Add an exported `mapHuToTissue(hu)` that linearly interpolates ordered HU knots and returns byte color, alpha, roughness, and thickness values. Add normalized-scalar mapping for non-CT data. Extend `createSliceTextureData` to accept mapping mode and emit all three textures with vertically corrected pixels.

**Step 4: Run test to verify it passes**

Run: `npm test -- --run src/lib/medicalVolume.test.ts`

Expected: PASS.

### Task 2: Carry tissue textures through the upload API

**Files:**
- Modify: `src/lib/studyTypes.ts`
- Modify: `src/lib/server/studyProcessing.test.ts`
- Modify: `src/lib/server/studyProcessing.ts`

**Step 1: Write the failing tests**

Require `StudyPayload.intensityMapping` to be `hu` for CT and `normalized` for NIfTI. Require each returned slice to contain `thicknessBase64` with exactly `width * height` bytes and an RGBA diffuse texture whose air pixels may have alpha 0.

**Step 2: Run test to verify it fails**

Run: `npm test -- --run src/lib/server/studyProcessing.test.ts`

Expected: FAIL because the response has no mapping mode or thickness texture.

**Step 3: Implement API propagation**

Extend the public payload types. Resize thickness using the same nearest-neighbor coordinates as diffuse and roughness. Select HU mode only when modality is CT; otherwise use normalized mode. Encode thickness as Base64 without adding patient tags.

**Step 4: Run test to verify it passes**

Run: `npm test -- --run src/lib/server/studyProcessing.test.ts`

Expected: PASS.

### Task 3: Change the scene to Z-up sharp boxes

**Files:**
- Modify: `src/lib/sliceMotion.test.ts`
- Modify: `src/lib/sliceMotion.ts`
- Modify: `src/components/SliceAtlas.tsx`

**Step 1: Write the failing motion tests**

Require layout depth to vary on Y, base Z to remain zero, rotation to be around Z, and the active target to preserve Y while increasing Z by more than 2. Require Z displacement to dominate X displacement while retaining X offset.

**Step 2: Run test to verify it fails**

Run: `npm test -- --run src/lib/sliceMotion.test.ts`

Expected: FAIL because the current layout stacks along Z and uses `rotationY`.

**Step 3: Implement Z-up motion and geometry**

Update motion types to `rotationZ`. Set the main and axis camera up vectors to Z. Replace every `RoundedBoxGeometry`, `PlaneGeometry`, edge strip and outline with one `BoxGeometry` Mesh per slice; rotate its local XY front face into the world XZ plane. Keep X hover wave and animate the selected box along world Z+.

**Step 4: Run motion tests**

Run: `npm test -- --run src/lib/sliceMotion.test.ts`

Expected: PASS.

### Task 4: Add WebGPU PBR and SSS material

**Files:**
- Modify: `src/components/SliceAtlas.tsx`
- Modify: `src/app/globals.css`

**Step 1: Add a source-level renderer contract test**

Create a focused test that reads the component source and requires `WebGPURenderer`, `MeshSSSNodeMaterial`, `RoomEnvironment`, `BoxGeometry`, and Z-up camera configuration while rejecting `RoundedBoxGeometry` and the old image plane. This guards the chosen renderer architecture without mocking a GPU.

**Step 2: Run test to verify it fails**

Run: `npm test -- --run src/components/SliceAtlas.rendering.test.ts`

Expected: FAIL against the current WebGL rounded-box implementation.

**Step 3: Implement renderer initialization and SSS nodes**

Import Three.js from `three/webgpu` and texture nodes from `three/tsl`. Initialize `WebGPURenderer` asynchronously, generate a PMREM from `RoomEnvironment`, bind RGBA/roughness/thickness `DataTexture` instances, and configure `MeshSSSNodeMaterial` thickness nodes. Use the tissue material on front/back box material groups and the edge material on the other four groups. Dispose renderer, render target, node materials, textures and geometries on replacement.

**Step 4: Run focused and full tests**

Run: `npm test`

Expected: all tests pass.

### Task 5: Build and browser verification

**Files:**
- Modify: `README.md`

**Step 1: Document the renderer and mapping semantics**

Document WebGPU with WebGL2 fallback, CT HU palette, normalized NIfTI fallback, air alpha behavior, Z-up coordinates and the non-diagnostic visualization disclaimer.

**Step 2: Build**

Run: `npm run build`

Expected: Next.js production build and TypeScript checks succeed.

**Step 3: Run the application**

Run: `npm run dev`

Expected: page and `/api/studies` are available on `http://localhost:3000`.

**Step 4: Verify in a real browser**

Upload the test NIfTI and generated DICOM fixtures. Confirm no black rectangle remains around air, each layer has sharp box edges, the upper debug arrow is Z+, hover preserves X wave and pulls upward on Z+, and the browser console contains no renderer errors. Capture a screenshot for visual inspection.

**Step 5: Commit**

Commit the implementation on `feature/hu-sss-rendering`, merge it locally into `feature/server-medical-upload`, rerun tests, and remove the temporary worktree without touching the user's existing `next-env.d.ts` change.
