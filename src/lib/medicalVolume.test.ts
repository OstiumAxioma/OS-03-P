import { describe, expect, it } from "vitest";

import {
  createMedicalVolume,
  createSliceTextureData,
  getAxialSlice,
  mapHuToTissue,
  mapNormalizedToTissue,
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

  it("returns every source plane exactly once when the full depth is requested", () => {
    expect(selectSliceIndices(12, 12)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
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
  it("uses one vtk slice for tissue color, roughness, and SSS thickness textures", () => {
    const imageData = toVtkImageData(createMedicalVolume(16, 14, 10));
    const textures = createSliceTextureData(imageData, 5, "hu");

    expect(textures.diffuse).toHaveLength(16 * 14 * 4);
    expect(textures.roughness).toHaveLength(16 * 14);
    expect(textures.thickness).toHaveLength(16 * 14);
    expect(new Set(textures.diffuse).size).toBeGreaterThan(8);
    expect(new Set(textures.roughness).size).toBeGreaterThan(4);
    expect(new Set(textures.thickness).size).toBeGreaterThan(4);

    const alphaValues = Array.from(textures.diffuse.filter((_, index) => index % 4 === 3));
    expect(alphaValues).toContain(0);
  });
});

describe("mapHuToTissue", () => {
  it("makes air completely transparent", () => {
    expect(mapHuToTissue(-1000)).toMatchObject({ alpha: 0, thickness: 0 });
  });

  it("assigns distinct human tissue colors to fat, soft tissue, and bone", () => {
    const fat = mapHuToTissue(-100);
    const softTissue = mapHuToTissue(55);
    const bone = mapHuToTissue(1200);

    expect(fat.color[0]).toBeGreaterThan(fat.color[1]);
    expect(fat.color[1]).toBeGreaterThan(fat.color[2]);
    expect(softTissue.color[0]).toBeGreaterThan(softTissue.color[1] * 1.8);
    expect(softTissue.color[0]).toBeGreaterThan(softTissue.color[2] * 1.5);
    expect(bone.color.every((channel) => channel > 205)).toBe(true);
    expect(bone.alpha).toBeGreaterThanOrEqual(softTissue.alpha);
  });

  it("interpolates continuously across HU transfer points", () => {
    const lower = mapHuToTissue(49);
    const upper = mapHuToTissue(51);

    expect(Math.max(...lower.color.map((channel, index) => Math.abs(channel - upper.color[index])))).toBeLessThan(12);
    expect(Math.abs(lower.alpha - upper.alpha)).toBeLessThan(12);
  });
});

describe("mapNormalizedToTissue", () => {
  it("keeps the minimum transparent and produces tissue at the upper range", () => {
    expect(mapNormalizedToTissue(0)).toMatchObject({ alpha: 0, thickness: 0 });
    expect(mapNormalizedToTissue(1).alpha).toBeGreaterThan(220);
  });
});
