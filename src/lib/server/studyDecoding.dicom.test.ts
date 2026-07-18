import { describe, expect, it } from "vitest";

import { DICOM_FIXTURE_SERIES_UID, writeDicomFixtureSeries } from "../../../test/fixtures/dicomFixture";
import { decodeDicomFiles } from "./studyDecoding";
import { withTemporaryDirectory } from "./tempStorage";

describe("decodeDicomFiles", () => {
  it("decodes a real two-slice DICOM series through ITK-Wasm", async () => {
    await withTemporaryDirectory(async (directory) => {
      const filePaths = await writeDicomFixtureSeries(directory);
      const payload = await decodeDicomFiles(filePaths);

      expect(payload.sourceType).toBe("dicom");
      expect(payload.modality).toBe("CT");
      expect(payload.intensityMapping).toBe("hu");
      expect(payload.selectedSeriesUid).toBe(DICOM_FIXTURE_SERIES_UID);
      expect(payload.dimensions).toEqual([2, 2, 2]);
      expect(payload.slices).toHaveLength(2);
      const rgba = Buffer.from(payload.slices[0].diffuseBase64, "base64");
      expect(Array.from(rgba).filter((_, index) => index % 4 === 3)).toContain(0);
    });
  }, 30_000);
});
