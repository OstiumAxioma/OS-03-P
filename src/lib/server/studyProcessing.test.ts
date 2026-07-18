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
  it("creates at most seven bounded textures from vtk image data", () => {
    const imageData = toVtkImageData(createMedicalVolume(24, 20, 12));
    const payload = createStudyPayload(imageData, {
      sourceType: "nifti",
      modality: "NIFTI",
      maxTextureSize: 12
    });

    expect(payload.dimensions).toEqual([24, 20, 12]);
    expect(payload.slices).toHaveLength(7);
    expect(payload.slices.every((slice) => slice.width <= 12 && slice.height <= 12)).toBe(true);

    const first = payload.slices[0];
    expect(Buffer.from(first.diffuseBase64, "base64")).toHaveLength(first.width * first.height * 4);
    expect(Buffer.from(first.roughnessBase64, "base64")).toHaveLength(first.width * first.height);
  });
});
