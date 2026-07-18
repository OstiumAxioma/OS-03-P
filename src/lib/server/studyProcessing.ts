import type { vtkImageData as VtkImageData } from "@kitware/vtk.js/Common/DataModel/ImageData";

import { createSliceTextureData, selectSliceIndices } from "../medicalVolume";
import type { IntensityMapping, StudyKind, StudyPayload } from "../studyTypes";

export type DicomFileMetadata = {
  filePath: string;
  seriesUid: string;
  modality?: string;
  description?: string;
};

export type DicomSeriesSelection = {
  seriesUid: string;
  modality: string;
  description?: string;
  filePaths: string[];
};

type StudyPayloadOptions = {
  sourceType: StudyKind;
  modality: string;
  seriesDescription?: string;
  selectedSeriesUid?: string;
  maxTextureSize?: number;
};

export function chooseLargestDicomSeries(records: DicomFileMetadata[]): DicomSeriesSelection {
  if (records.length === 0) {
    throw new Error("No readable DICOM images were found.");
  }

  const groups = new Map<string, DicomFileMetadata[]>();
  records.forEach((record) => {
    const key = record.seriesUid || "unknown-series";
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  });

  const selected = [...groups.entries()].reduce((largest, candidate) =>
    candidate[1].length > largest[1].length ? candidate : largest
  );
  const [seriesUid, files] = selected;

  return {
    seriesUid,
    modality: files[0].modality || "DICOM",
    description: files[0].description || undefined,
    filePaths: files.map((file) => file.filePath)
  };
}

export function validateVolumeDimensions(dimensions: readonly number[]): [number, number, number] {
  if (dimensions.length < 3 || dimensions.slice(0, 3).some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error("Only 3D medical image volumes are supported.");
  }

  return [Math.round(dimensions[0]), Math.round(dimensions[1]), Math.round(dimensions[2])];
}

function resizeSlice(
  width: number,
  height: number,
  diffuse: Uint8Array,
  roughness: Uint8Array,
  thickness: Uint8Array,
  maxTextureSize: number
): {
  width: number;
  height: number;
  diffuse: Uint8Array;
  roughness: Uint8Array;
  thickness: Uint8Array;
} {
  const scale = Math.min(1, maxTextureSize / width, maxTextureSize / height);
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  if (targetWidth === width && targetHeight === height) {
    return { width, height, diffuse, roughness, thickness };
  }

  const targetDiffuse = new Uint8Array(targetWidth * targetHeight * 4);
  const targetRoughness = new Uint8Array(targetWidth * targetHeight);
  const targetThickness = new Uint8Array(targetWidth * targetHeight);

  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(height - 1, Math.floor((y / targetHeight) * height));
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor((x / targetWidth) * width));
      const sourceIndex = sourceY * width + sourceX;
      const targetIndex = y * targetWidth + x;
      targetRoughness[targetIndex] = roughness[sourceIndex];
      targetThickness[targetIndex] = thickness[sourceIndex];
      targetDiffuse.set(diffuse.subarray(sourceIndex * 4, sourceIndex * 4 + 4), targetIndex * 4);
    }
  }

  return {
    width: targetWidth,
    height: targetHeight,
    diffuse: targetDiffuse,
    roughness: targetRoughness,
    thickness: targetThickness
  };
}

export function createStudyPayload(imageData: VtkImageData, options: StudyPayloadOptions): StudyPayload {
  const dimensions = validateVolumeDimensions(imageData.getDimensions());
  const spacingValues = imageData.getSpacing();
  const spacing: [number, number, number] = [spacingValues[0], spacingValues[1], spacingValues[2]];
  const indices = selectSliceIndices(dimensions[2], Math.min(7, dimensions[2]));
  const maxTextureSize = options.maxTextureSize ?? 512;
  const intensityMapping: IntensityMapping = options.modality.trim().toUpperCase() === "CT" ? "hu" : "normalized";
  const slices = indices.map((sourceIndex) => {
    const source = createSliceTextureData(imageData, sourceIndex, intensityMapping);
    const resized = resizeSlice(
      source.width,
      source.height,
      source.diffuse,
      source.roughness,
      source.thickness,
      maxTextureSize
    );

    return {
      sourceIndex,
      width: resized.width,
      height: resized.height,
      diffuseBase64: Buffer.from(resized.diffuse).toString("base64"),
      roughnessBase64: Buffer.from(resized.roughness).toString("base64"),
      thicknessBase64: Buffer.from(resized.thickness).toString("base64")
    };
  });

  return {
    sourceType: options.sourceType,
    modality: options.modality,
    intensityMapping,
    seriesDescription: options.seriesDescription,
    selectedSeriesUid: options.selectedSeriesUid,
    dimensions,
    spacing,
    totalSlices: dimensions[2],
    slices
  };
}
