import { describe, expect, it } from "vitest";

import { createSliceLayout, getSliceTarget, getSliceVisualState } from "./sliceMotion";

describe("createSliceLayout", () => {
  it("centers an ordered set of upright XY slices along world Z", () => {
    const layout = createSliceLayout(5, 0.5);

    expect(layout.map((slice) => slice.index)).toEqual([0, 1, 2, 3, 4]);
    expect(layout.map((slice) => slice.z)).toEqual([-1, -0.5, 0, 0.5, 1]);
    expect(layout.every((slice) => slice.y === 0)).toBe(true);
    expect(layout[0].x).toBeCloseTo(-layout[4].x);
  });
});

describe("getSliceTarget", () => {
  it("keeps the lateral motion while making world Y+ the dominant pull", () => {
    const [base] = createSliceLayout(1, 0.5);
    const active = getSliceTarget(base, true);
    const xTravel = active.x - base.x;
    const yTravel = active.y - base.y;

    expect(getSliceTarget(base, false)).toEqual(base);
    expect(xTravel).toBeGreaterThan(0.6);
    expect(active.z).toBe(base.z);
    expect(yTravel).toBeGreaterThan(2);
    expect(yTravel).toBeGreaterThan(xTravel * 2.5);
    expect(active.rotationY).toBeLessThan(base.rotationY);
  });
});

describe("getSliceVisualState", () => {
  it("keeps background planes frosted and restores contrast on the active plane", () => {
    const background = getSliceVisualState(false);
    const active = getSliceVisualState(true);

    expect(active.tissueIntensity).toBeGreaterThan(background.tissueIntensity);
    expect(active.sssScale).toBeGreaterThan(background.sssScale);
    expect(active.edgeOpacity).toBeGreaterThan(background.edgeOpacity);
  });
});
