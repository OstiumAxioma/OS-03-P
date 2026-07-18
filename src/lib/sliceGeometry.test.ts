import { describe, expect, it } from "vitest";

import {
  SLICE_THICKNESS_SCALE_MAX,
  SLICE_THICKNESS_SCALE_MIN,
  calculateSliceWorldDimensions,
  clampSliceThicknessScale,
  getBottomAlignedCenterY
} from "./sliceGeometry";

describe("calculateSliceWorldDimensions", () => {
  it("fits the physical in-plane aspect instead of the pixel aspect", () => {
    const dimensions = calculateSliceWorldDimensions(512, 256, [0.5, 1, 2], 5.1, 3.95);

    expect(dimensions.width).toBeCloseTo(3.95);
    expect(dimensions.height).toBeCloseTo(3.95);
    expect(dimensions.worldUnitsPerMillimeter).toBeCloseTo(3.95 / 256);
  });

  it("uses the same physical scale for the Z spacing and the slice face", () => {
    const dimensions = calculateSliceWorldDimensions(400, 200, [0.8, 0.8, 2.4], 5.1, 3.95);

    expect(dimensions.thickness).toBeCloseTo(2.4 * dimensions.worldUnitsPerMillimeter);
    expect(dimensions.width / dimensions.thickness).toBeCloseTo((400 * 0.8) / 2.4);
  });

  it("falls back to unit spacing for invalid metadata", () => {
    const dimensions = calculateSliceWorldDimensions(100, 50, [0, Number.NaN, -2], 5, 4);

    expect(dimensions.width).toBeCloseTo(5);
    expect(dimensions.height).toBeCloseTo(2.5);
    expect(dimensions.thickness).toBeCloseTo(0.05);
  });
});

describe("clampSliceThicknessScale", () => {
  it("keeps the user multiplier within the supported slider range", () => {
    expect(clampSliceThicknessScale(0)).toBe(SLICE_THICKNESS_SCALE_MIN);
    expect(clampSliceThicknessScale(3.5)).toBe(3.5);
    expect(clampSliceThicknessScale(100)).toBe(SLICE_THICKNESS_SCALE_MAX);
    expect(clampSliceThicknessScale(Number.NaN)).toBe(1);
  });
});

describe("getBottomAlignedCenterY", () => {
  it("places different box heights on the same physical Y baseline", () => {
    const baselineY = -1.975;
    const shortCenterY = getBottomAlignedCenterY(2.4, baselineY);
    const tallCenterY = getBottomAlignedCenterY(3.95, baselineY);

    expect(shortCenterY - 2.4 / 2).toBeCloseTo(baselineY);
    expect(tallCenterY - 3.95 / 2).toBeCloseTo(baselineY);
  });
});
