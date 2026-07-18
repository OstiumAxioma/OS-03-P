import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { decodeNiftiFile } from "./studyDecoding";
import { withTemporaryDirectory } from "./tempStorage";

describe("decodeNiftiFile", () => {
  it("decodes a real 3D NIfTI file through ITK-Wasm", async () => {
    await withTemporaryDirectory(async (directory) => {
      const filePath = join(directory, "tiny.nii");
      const encodedFixture = await readFile(join(process.cwd(), "test", "fixtures", "tiny.nii.base64"), "utf8");
      await writeFile(filePath, Buffer.from(encodedFixture.trim(), "base64"));

      const payload = await decodeNiftiFile(filePath);

      expect(payload.sourceType).toBe("nifti");
      expect(payload.dimensions).toEqual([4, 3, 2]);
      expect(payload.spacing).toEqual([1, 1, 1.5]);
      expect(payload.slices).toHaveLength(2);
    });
  }, 30_000);
});
