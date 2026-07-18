# Medical Slice Atlas Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a single-screen isometric medical slice experience where vtk.js-backed CT slices are embedded in upright frosted glass panels and one panel glides forward on hover or tap.

**Architecture:** A client-only React scene uses vtk.js image data as the scalar-volume source and converts selected axial planes into canvas textures. Three.js renders those textures on rounded thin glass panels with a separate ribbed perimeter treatment, an orthographic isometric camera, raycast selection, and damped pop-out motion. Pure layout and motion-target functions stay independent from WebGL so their behavior can be tested without a browser.

**Tech Stack:** Next.js, React, TypeScript, Three.js, vtk.js, Vitest, Sites hosting.

---

### Task 1: Define the slice layout and selection contract

**Files:**
- Create: `src/lib/sliceMotion.test.ts`
- Create: `src/lib/sliceMotion.ts`

**Steps:**
1. Write tests that require a centered, ordered upright-panel layout and a single selected panel target.
2. Run the tests and verify they fail because the implementation is absent.
3. Add the smallest pure implementation for centered depth positions and hover targets.
4. Run the tests and confirm all assertions pass.

### Task 2: Create vtk.js-backed medical textures

**Files:**
- Create: `src/lib/medicalVolume.ts`

**Steps:**
1. Build one deterministic synthetic CT-like scalar volume in vtk.js image data.
2. Extract evenly spaced axial slices in anatomical order.
3. Generate paired diffuse and roughness canvas textures for every selected plane.

### Task 3: Render the isometric glass array

**Files:**
- Create: `src/components/SliceAtlas.tsx`
- Create: `src/app/page.tsx`
- Create: `src/app/layout.tsx`
- Create: `src/app/globals.css`

**Steps:**
1. Set a bright `#53FFBA` scene with an orthographic isometric camera.
2. Render upright rounded glass panels, internal medical textures, frosted diffusion, and ribbed iridescent edges.
3. Raycast pointer movement and tap input to select one panel.
4. Animate the selected panel forward with damped motion and return it smoothly on leave.
5. Add restrained clinical labels, current slice state, and concise interaction guidance.

### Task 4: Validate and publish

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.mjs`
- Create: `vitest.config.ts`

**Steps:**
1. Install dependencies and run the test suite.
2. Run a production build and resolve all compile errors.
3. Inspect the page at desktop and mobile dimensions in a real browser.
4. Commit the exact validated source, push it to the Sites source repository, save a version, and deploy it with owner-only access when available.
