import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, extname, isAbsolute, join, normalize } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as yauzl from "yauzl";

import type { StudyKind } from "../studyTypes";
import type { StudyPayload } from "../studyTypes";
import { decodeDicomFiles, decodeNiftiFile } from "./studyDecoding";
import { withTemporaryDirectory } from "./tempStorage";

const DEFAULT_MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

type UploadFileDescriptor = {
  name: string;
  size: number;
};

export class StudyRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "StudyRequestError";
    this.status = status;
    this.code = code;
  }
}

export function validateStudyUpload(
  kind: string,
  files: UploadFileDescriptor[],
  maxUploadBytes = DEFAULT_MAX_UPLOAD_BYTES
): StudyKind {
  if (kind !== "dicom" && kind !== "nifti") {
    throw new StudyRequestError(400, "INVALID_KIND", "Study kind must be dicom or nifti.");
  }
  if (files.length === 0) {
    throw new StudyRequestError(400, "NO_FILES", "Select at least one medical image file.");
  }

  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (!Number.isFinite(totalBytes) || totalBytes > maxUploadBytes) {
    throw new StudyRequestError(413, "UPLOAD_TOO_LARGE", "The selected files exceed the configured upload limit.");
  }

  if (kind === "nifti") {
    if (files.length !== 1) {
      throw new StudyRequestError(400, "INVALID_NIFTI", "NIfTI upload requires exactly one file.");
    }
    if (!/\.nii(?:\.gz)?$/i.test(files[0].name)) {
      throw new StudyRequestError(400, "INVALID_NIFTI", "Select a .nii or .nii.gz file.");
    }
  }

  if (kind === "dicom") {
    const zipFiles = files.filter((file) => /\.zip$/i.test(file.name));
    if (zipFiles.length > 0 && files.length !== 1) {
      throw new StudyRequestError(400, "AMBIGUOUS_DICOM", "Upload a DICOM ZIP alone or select DICOM files without a ZIP.");
    }
  }

  return kind;
}

export function isSafeZipEntry(entryName: string): boolean {
  const portableName = entryName.replaceAll("\\", "/");
  const normalized = normalize(portableName).replaceAll("\\", "/");
  const segments = portableName.split("/");

  return !isAbsolute(portableName) && !/^[a-z]:\//i.test(portableName) && !segments.includes("..") && !normalized.startsWith("../");
}

function uploadLimitBytes(): number {
  const configuredMb = Number(process.env.THREEVTK_MAX_UPLOAD_MB ?? "1024");
  return Number.isFinite(configuredMb) && configuredMb > 0 ? configuredMb * 1024 * 1024 : DEFAULT_MAX_UPLOAD_BYTES;
}

function safeSuffix(fileName: string): string {
  if (/\.nii\.gz$/i.test(fileName)) {
    return ".nii.gz";
  }
  const suffix = extname(basename(fileName)).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(suffix) ? suffix : ".bin";
}

async function persistUploads(files: File[], directory: string): Promise<string[]> {
  const paths: string[] = [];

  for (let index = 0; index < files.length; index += 1) {
    const targetPath = join(/* turbopackIgnore: true */ directory, `${String(index).padStart(5, "0")}${safeSuffix(files[index].name)}`);
    const source = Readable.fromWeb(files[index].stream() as never);
    await pipeline(source, createWriteStream(targetPath));
    paths.push(targetPath);
  }

  return paths;
}

function openZip(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, validateEntrySizes: true }, (error, zipFile) => {
      if (error || !zipFile) {
        reject(error ?? new Error("Unable to open ZIP archive."));
        return;
      }
      resolve(zipFile);
    });
  });
}

async function extractDicomZip(zipPath: string, directory: string, maxBytes: number): Promise<string[]> {
  await mkdir(directory, { recursive: true });
  const zipFile = await openZip(zipPath);

  return new Promise((resolve, reject) => {
    const extracted: string[] = [];
    let extractedBytes = 0;
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      zipFile.close();
      reject(error);
    };

    zipFile.on("error", fail);
    zipFile.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(extracted);
    });
    zipFile.on("entry", (entry) => {
      if (!isSafeZipEntry(entry.fileName) || entry.isEncrypted()) {
        fail(new StudyRequestError(400, "INVALID_ZIP", "The DICOM ZIP contains an unsafe entry."));
        return;
      }
      if (entry.fileName.endsWith("/")) {
        zipFile.readEntry();
        return;
      }

      extractedBytes += entry.uncompressedSize;
      if (extractedBytes > maxBytes) {
        fail(new StudyRequestError(413, "UPLOAD_TOO_LARGE", "The extracted DICOM ZIP exceeds the upload limit."));
        return;
      }

      const targetPath = join(/* turbopackIgnore: true */ directory, `${String(extracted.length).padStart(5, "0")}.dcm`);
      zipFile.openReadStream(entry, (error, readStream) => {
        if (error) {
          fail(error);
          return;
        }
        pipeline(readStream, createWriteStream(targetPath))
          .then(() => {
            extracted.push(targetPath);
            zipFile.readEntry();
          })
          .catch(fail);
      });
    });

    zipFile.readEntry();
  });
}

export async function processStudyUpload(kindValue: string, files: File[]): Promise<StudyPayload> {
  const maxBytes = uploadLimitBytes();
  const kind = validateStudyUpload(kindValue, files, maxBytes);

  try {
    return await withTemporaryDirectory(async (directory) => {
      const storedPaths = await persistUploads(files, directory);

      if (kind === "nifti") {
        return decodeNiftiFile(storedPaths[0]);
      }

      const dicomPaths = /\.zip$/i.test(files[0].name)
        ? await extractDicomZip(storedPaths[0], join(/* turbopackIgnore: true */ directory, "dicom"), maxBytes)
        : storedPaths;
      return decodeDicomFiles(dicomPaths);
    });
  } catch (error) {
    if (error instanceof StudyRequestError) {
      throw error;
    }
    throw new StudyRequestError(422, "DECODE_FAILED", "The server could not decode this medical image study.");
  }
}
