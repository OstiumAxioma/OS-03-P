import { describe, expect, it } from "vitest";

import { createMedicalVolume, toVtkImageData } from "../medicalVolume";
import { chooseLargestDicomSeries, createStudyPayload, validateVolumeDimensions } from "./studyProcessing";

describe("chooseLargestDicomSeries", () => {
  it("selects the series containing the most image files", () => {
    const selected = chooseLargestDicomSeries([
      { filePath: "local-a-1.dcm", seriesUid: "series-a", modality: "CT", description: "HEAD" },
      { filePath: "local-b-1.dcm", seriesUid: "series-b", modality: "MR", description: "SCOUT" },
      { filePath: "local-a-2.dcm", seriesUid: "series-a", modality: "CT", description: "HEAD" }
    ]);

    expect(selected.seriesUid).toBe("series-a");
    expect(selected.modality).toBe("CT");
    expect(selected.filePaths).toEqual(["local-a-1.dcm", "local-a-2.dcm"]);
  });
});

describe("validateVolumeDimensions", () => {
  it("rejects images that are not three-dimensional volumes", () => {
    expect(() => validateVolumeDimensions([32, 32])).toThrow("3D");
    expect(validateVolumeDimensions([32, 32, 8])).toEqual([32, 32, 8]);
  });
});

describe("createStudyPayload", () => {
  it("creates one texture layer for every source slice by default", () => {
    const imageData = toVtkImageData(createMedicalVolume(24, 20, 15));
    const payload = createStudyPayload(imageData, {
      sourceType: "nifti",
      modality: "NIFTI",
      maxTextureSize: 12
    });

    expect(payload.dimensions).toEqual([24, 20, 15]);
    expect(payload.intensityMapping).toBe("normalized");
    expect(payload.slices).toHaveLength(15);
    expect(payload.slices.map((slice) => slice.sourceIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(payload.slices.every((slice) => slice.width <= 12 && slice.height <= 12)).toBe(true);

    const first = payload.slices[0];
    expect(Buffer.from(first.diffuseBase64, "base64")).toHaveLength(first.width * first.height * 4);
    expect(Buffer.from(first.roughnessBase64, "base64")).toHaveLength(first.width * first.height);
    expect(Buffer.from(first.thicknessBase64, "base64")).toHaveLength(first.width * first.height);
  });

  it("honors a smaller requested texture-pool size", () => {
    const imageData = toVtkImageData(createMedicalVolume(12, 10, 9));
    const payload = createStudyPayload(imageData, {
      sourceType: "nifti",
      modality: "NIFTI",
      maxSliceCount: 3
    });

    expect(payload.slices).toHaveLength(3);
    expect(payload.slices.map((slice) => slice.sourceIndex)).toEqual([1, 4, 7]);
  });

  it("marks CT studies as HU-mapped and preserves transparent air", () => {
    const imageData = toVtkImageData(createMedicalVolume(16, 14, 8));
    const payload = createStudyPayload(imageData, {
      sourceType: "dicom",
      modality: "CT"
    });

    expect(payload.intensityMapping).toBe("hu");
    const rgba = Buffer.from(payload.slices[0].diffuseBase64, "base64");
    const alpha = Array.from(rgba).filter((_, index) => index % 4 === 3);
    expect(alpha).toContain(0);
  });
});
