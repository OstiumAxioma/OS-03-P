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
  it("moves only the active slice toward the viewer", () => {
    const [base] = createSliceLayout(1, 0.5);

    expect(getSliceTarget(base, false)).toEqual(base);
    expect(getSliceTarget(base, true).x).toBeGreaterThan(base.x + 0.6);
    expect(getSliceTarget(base, true).z).toBeGreaterThan(base.z + 1);
    expect(getSliceTarget(base, true).y).toBeGreaterThan(base.y);
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
