import { describe, expect, it } from "vitest";

import {
  SLICE_STACK_GAP,
  createSliceLayout,
  getSliceStackZ,
  getSliceTarget,
  getSliceVisualState,
  stepSpring,
  getEntryLift,
  getSelectionWave
} from "./sliceMotion";

describe("createSliceLayout", () => {
  it("centers an ordered set of upright XY slices along world Z", () => {
    const layout = createSliceLayout(5, 0.5);

    expect(layout.map((slice) => slice.index)).toEqual([0, 1, 2, 3, 4]);
    expect(layout.map((slice) => slice.z)).toEqual([-1, -0.5, 0, 0.5, 1]);
    expect(layout.every((slice) => slice.y === 0)).toBe(true);
    expect(layout.every((slice) => slice.x === 0)).toBe(true);
    expect(layout[0]).not.toHaveProperty("rotationY");
  });
});

describe("getSliceStackZ", () => {
  it("keeps a fixed surface gap when slice thickness changes", () => {
    const thinDistance = getSliceStackZ(1, 3, 0.2) - getSliceStackZ(0, 3, 0.2);
    const thickDistance = getSliceStackZ(1, 3, 1.6) - getSliceStackZ(0, 3, 1.6);

    expect(thinDistance - 0.2).toBeCloseTo(SLICE_STACK_GAP);
    expect(thickDistance - 1.6).toBeCloseTo(SLICE_STACK_GAP);
  });
});

describe("getSliceTarget", () => {
  it("previews and extracts vertically without moving the slice out of its slot", () => {
    const [base] = createSliceLayout(1, 0.5);
    const active = getSliceTarget(base, true);
    const xTravel = active.x - base.x;
    const yTravel = active.y - base.y;

    expect(getSliceTarget(base, false)).toEqual(base);
    expect(xTravel).toBe(0);
    expect(active.z).toBe(base.z);
    expect(yTravel).toBeGreaterThan(0);
    expect(yTravel).toBeLessThan(0.6);
    const extracted = getSliceTarget(base, true, 1);
    expect(extracted.x).toBe(base.x);
    expect(extracted.z).toBe(base.z);
    expect(extracted.y - base.y).toBeGreaterThan(3.95);
  });
});

describe("continuous transitions", () => {
  it("preserves position and velocity when a moving selection reverses", () => {
    const spring = { value: 0, velocity: 0 };
    for (let i = 0; i < 20; i++) stepSpring(spring, 4, 6, 1 / 60);
    const before = spring.value;
    stepSpring(spring, 0, 6, 1 / 6000);
    expect(Math.abs(spring.value - before)).toBeLessThan(0.01);
    for (let i = 0; i < 240; i++) stepSpring(spring, 0, 6, 1 / 60);
    expect(spring.value).toBeCloseTo(0, 5);
    expect(spring.velocity).toBeCloseTo(0, 5);
  });

  it("follows the same motion at 30 and 120 frames per second", () => {
    const slow = { value: 3, velocity: -2 };
    const fast = { ...slow };
    for (let i = 0; i < 30; i++) stepSpring(slow, -1, 4.2, 1 / 30);
    for (let i = 0; i < 120; i++) stepSpring(fast, -1, 4.2, 1 / 120);
    expect(slow.value).toBeCloseTo(fast.value, 8);
    expect(slow.velocity).toBeCloseTo(fast.velocity, 8);
  });

  it("settles every entrance slice and skips the motion when reduced", () => {
    for (const rank of [0, 3, 6, 99]) {
      expect(getEntryLift(rank, 100, 8, false)).toBe(0);
      expect(getEntryLift(rank, 100, 0.1, true)).toBe(0);
    }
    expect(getEntryLift(0, 7, 0.2, false)).not.toBe(getEntryLift(6, 7, 0.2, false));
  });

  it("ends selection ripples without leaving displaced neighbors", () => {
    expect(getSelectionWave(0, -0.1)).toBe(0);
    expect(getSelectionWave(2, 4)).toBe(0);
    expect(Math.abs(getSelectionWave(2, 0.4))).toBeGreaterThan(0.05);
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
