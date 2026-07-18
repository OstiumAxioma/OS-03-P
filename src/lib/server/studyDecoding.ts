import { readDicomTagsNode, readImageDicomFileSeriesNode } from "@itk-wasm/dicom";
import { readImageNode } from "@itk-wasm/image-io";
import vtkITKHelper from "@kitware/vtk.js/Common/DataModel/ITKHelper";

import type { StudyPayload } from "../studyTypes";
import { chooseLargestDicomSeries, createStudyPayload, type DicomFileMetadata } from "./studyProcessing";

const DICOM_TAGS = ["0020|000e", "0008|0060", "0008|103e"];

function assertItkVolume(image: { imageType?: { dimension?: number }; size?: readonly number[] }): void {
  if (image.imageType?.dimension !== 3 || image.size?.length !== 3 || image.size.some((value) => value <= 0)) {
    throw new Error("Only 3D medical image volumes are supported.");
  }
}

export async function decodeNiftiFile(filePath: string): Promise<StudyPayload> {
  const image = await readImageNode(filePath);
  assertItkVolume(image);
  const imageData = vtkITKHelper.convertItkToVtkImage(image, { scalarArrayName: "NIfTI scalars" });

  return createStudyPayload(imageData, {
    sourceType: "nifti",
    modality: "NIFTI"
  });
}

async function readDicomFileMetadata(filePath: string): Promise<DicomFileMetadata | null> {
  try {
    const result = await readDicomTagsNode(filePath, { tagsToRead: { tags: DICOM_TAGS } });
    const tags = new Map(result.tags.map(([tag, value]) => [tag.toLowerCase(), value.trim()]));

    return {
      filePath,
      seriesUid: tags.get("0020|000e") || "unknown-series",
      modality: tags.get("0008|0060") || "DICOM",
      description: tags.get("0008|103e") || undefined
    };
  } catch {
    return null;
  }
}

export async function decodeDicomFiles(filePaths: string[]): Promise<StudyPayload> {
  const metadata: DicomFileMetadata[] = [];
  for (const filePath of filePaths) {
    const record = await readDicomFileMetadata(filePath);
    if (record) {
      metadata.push(record);
    }
  }

  const selected = chooseLargestDicomSeries(metadata);
  const { outputImage } = await readImageDicomFileSeriesNode({ inputImages: selected.filePaths });
  assertItkVolume(outputImage);
  const imageData = vtkITKHelper.convertItkToVtkImage(outputImage, { scalarArrayName: "DICOM scalars" });

  return createStudyPayload(imageData, {
    sourceType: "dicom",
    modality: selected.modality,
    seriesDescription: selected.description,
    selectedSeriesUid: selected.seriesUid
  });
}
