# White Background and Slice Count Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Render the website and Three.js scene against white while allowing users to choose how many evenly distributed slice boxes are visible in real time.

**Architecture:** Increase the server-generated texture pool from seven to at most twelve layers, then keep that pool loaded in the client. A pure selector maps the user's requested visible count to evenly distributed pool indices; the render loop hides unselected groups and recenters selected groups along Z without re-uploading, re-parsing, or rebuilding the renderer. The existing shared CSS variable remains the single source for both DOM and Three.js background colors.

**Tech Stack:** Next.js, React, TypeScript, Three.js WebGPU/TSL, vtk.js, Vitest, Playwright CLI.

---

### Task 1: Increase the server texture pool

**Files:**
- Modify: `src/lib/server/studyProcessing.test.ts`
- Modify: `src/lib/server/studyProcessing.ts`

1. Change the payload test to require twelve textures for a volume with at least twelve slices and add an explicit lower-limit option test.
2. Run `npm test -- --run src/lib/server/studyProcessing.test.ts` and confirm the old seven-layer implementation fails.
3. Add `maxSliceCount` to payload options, default it to twelve, clamp it to the volume depth, and keep the existing texture-size limit.
4. Re-run the targeted test and confirm it passes.

### Task 2: Select visible layers without rebuilding the scene

**Files:**
- Create: `src/lib/sliceVisibility.test.ts`
- Create: `src/lib/sliceVisibility.ts`
- Modify: `src/components/SliceAtlas.tsx`

1. Write failing tests requiring counts to clamp to the available pool and selected indices to be ordered, centered for one layer, and evenly span the pool for multiple layers.
2. Run `npm test -- --run src/lib/sliceVisibility.test.ts` and confirm failure because the module is missing.
3. Implement the minimal pure selector.
4. Add visible-count state/ref and a `1..available` range input with default seven.
5. In the render loop, show only selected groups, assign their Z positions by visible rank, filter raycasting/keyboard selection to visible groups, and clear an active selection when it becomes hidden.
6. Re-run targeted tests.

### Task 3: Switch to a shared white background and verify

**Files:**
- Modify: `src/app/globals.css`
- Modify: `README.md`

1. Change `--scene-background` to `#ffffff`; do not introduce a second scene color constant.
2. Document the twelve-layer pool and real-time visible-count slider.
3. Run `npm test`, `npm run build`, and `git diff --check`.
4. Start the isolated development server and verify white DOM/WebGPU backgrounds, count changes at 1/7/12, fixed gaps, Y+ hover behavior, WebGPU availability, and zero console errors.
