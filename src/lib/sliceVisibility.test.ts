import { describe, expect, it } from "vitest";

import { clampVisibleSliceCount, selectVisibleSliceIndices } from "./sliceVisibility";

describe("clampVisibleSliceCount", () => {
  it("keeps the requested count between one and the available texture pool", () => {
    expect(clampVisibleSliceCount(0, 12)).toBe(1);
    expect(clampVisibleSliceCount(7, 12)).toBe(7);
    expect(clampVisibleSliceCount(30, 12)).toBe(12);
    expect(clampVisibleSliceCount(Number.NaN, 12)).toBe(12);
  });
});

describe("selectVisibleSliceIndices", () => {
  it("uses the center layer when only one slice is visible", () => {
    expect(selectVisibleSliceIndices(12, 1)).toEqual([6]);
  });

  it("selects ordered layers evenly across the available pool", () => {
    expect(selectVisibleSliceIndices(12, 7)).toEqual([0, 2, 4, 6, 7, 9, 11]);
  });

  it("returns every available layer when the request exceeds the pool", () => {
    expect(selectVisibleSliceIndices(3, 9)).toEqual([0, 1, 2]);
    expect(selectVisibleSliceIndices(0, 4)).toEqual([]);
  });
});
