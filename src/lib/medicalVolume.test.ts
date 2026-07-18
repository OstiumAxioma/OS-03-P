import { describe, expect, it } from "vitest";

import {
  createMedicalVolume,
  createSliceTextureData,
  getAxialSlice,
  selectSliceIndices,
  toVtkImageData
} from "./medicalVolume";

describe("createMedicalVolume", () => {
  it("creates a deterministic CT-like scalar field", () => {
    const volume = createMedicalVolume(32, 32, 20);

    expect(volume.dimensions).toEqual([32, 32, 20]);
    expect(volume.values).toHaveLength(32 * 32 * 20);
    expect(Math.min(...volume.values)).toBeLessThan(-800);
    expect(Math.max(...volume.values)).toBeGreaterThan(900);
  });
});

describe("getAxialSlice", () => {
  it("returns one complete plane from the scalar field", () => {
    const volume = createMedicalVolume(24, 20, 12);

    expect(getAxialSlice(volume, 6)).toHaveLength(24 * 20);
  });
});

describe("selectSliceIndices", () => {
  it("selects ordered planes across the useful volume range", () => {
    expect(selectSliceIndices(40, 5)).toEqual([6, 13, 20, 26, 33]);
  });
});

describe("toVtkImageData", () => {
  it("stores the generated scalar volume in vtk.js image data", () => {
    const imageData = toVtkImageData(createMedicalVolume(12, 10, 8));

    expect(imageData.getDimensions()).toEqual([12, 10, 8]);
    expect(imageData.getPointData().getScalars().getNumberOfTuples()).toBe(12 * 10 * 8);
  });
});

describe("createSliceTextureData", () => {
  it("uses one vtk slice for paired diffuse and roughness textures", () => {
    const imageData = toVtkImageData(createMedicalVolume(16, 14, 10));
    const textures = createSliceTextureData(imageData, 5);

    expect(textures.diffuse).toHaveLength(16 * 14 * 4);
    expect(textures.roughness).toHaveLength(16 * 14);
    expect(new Set(textures.diffuse).size).toBeGreaterThan(8);
    expect(new Set(textures.roughness).size).toBeGreaterThan(4);
  });
});
