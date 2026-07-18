import { describe, expect, it } from "vitest";

import { isSafeZipEntry, StudyRequestError, validateStudyUpload } from "./studyUpload";

const file = (name: string, size: number) => ({ name, size });

describe("validateStudyUpload", () => {
  it("requires a supported study kind and at least one file", () => {
    expect(() => validateStudyUpload("unknown", [])).toThrow(StudyRequestError);
    expect(() => validateStudyUpload("dicom", [])).toThrow("at least one");
  });

  it("rejects requests over the configured byte limit", () => {
    try {
      validateStudyUpload("dicom", [file("one.dcm", 6), file("two.dcm", 5)], 10);
      throw new Error("Expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(StudyRequestError);
      expect((error as StudyRequestError).status).toBe(413);
    }
  });

  it("accepts one NIfTI file and rejects ambiguous NIfTI requests", () => {
    expect(validateStudyUpload("nifti", [file("brain.nii.gz", 20)])).toBe("nifti");
    expect(() => validateStudyUpload("nifti", [file("a.nii", 10), file("b.nii", 10)])).toThrow("exactly one");
    expect(() => validateStudyUpload("nifti", [file("brain.zip", 10)])).toThrow(".nii");
  });

  it("accepts either DICOM files or one DICOM ZIP", () => {
    expect(validateStudyUpload("dicom", [file("slice-1.dcm", 10), file("slice-2.dcm", 10)])).toBe("dicom");
    expect(validateStudyUpload("dicom", [file("study.zip", 20)])).toBe("dicom");
    expect(() => validateStudyUpload("dicom", [file("study.zip", 20), file("slice.dcm", 10)])).toThrow("ZIP alone");
  });
});

describe("isSafeZipEntry", () => {
  it("rejects absolute and parent-traversal archive entries", () => {
    expect(isSafeZipEntry("series/slice-01.dcm")).toBe(true);
    expect(isSafeZipEntry("../private/file.dcm")).toBe(false);
    expect(isSafeZipEntry("C:/private/file.dcm")).toBe(false);
    expect(isSafeZipEntry("/private/file.dcm")).toBe(false);
  });
});
