import { describe, expect, it } from "vitest";

import { createSliceLayout, getSliceTarget, getSliceVisualState } from "./sliceMotion";

describe("createSliceLayout", () => {
  it("centers an ordered set of upright slices in depth", () => {
    const layout = createSliceLayout(5, 0.5);

    expect(layout.map((slice) => slice.index)).toEqual([0, 1, 2, 3, 4]);
    expect(layout.map((slice) => slice.z)).toEqual([-1, -0.5, 0, 0.5, 1]);
    expect(layout[0].x).toBeCloseTo(-layout[4].x);
  });
});

describe("getSliceTarget", () => {
  it("keeps the lateral motion while making world Z+ the dominant pull", () => {
    const [base] = createSliceLayout(1, 0.5);
    const active = getSliceTarget(base, true);
    const xTravel = active.x - base.x;
    const zTravel = active.z - base.z;

    expect(getSliceTarget(base, false)).toEqual(base);
    expect(xTravel).toBeGreaterThan(0.6);
    expect(active.y).toBeGreaterThan(base.y);
    expect(zTravel).toBeGreaterThan(2);
    expect(zTravel).toBeGreaterThan(xTravel * 2.5);
    expect(active.rotationY).toBeLessThan(base.rotationY);
  });
});

describe("getSliceVisualState", () => {
  it("keeps background planes frosted and restores contrast on the active plane", () => {
    const background = getSliceVisualState(false);
    const active = getSliceVisualState(true);

    expect(active.imageOpacity).toBeGreaterThan(background.imageOpacity + 0.5);
    expect(active.glassOpacity).toBeGreaterThan(background.glassOpacity);
  });
});
