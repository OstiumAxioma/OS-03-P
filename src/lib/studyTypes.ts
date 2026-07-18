export type StudyKind = "dicom" | "nifti";
export type IntensityMapping = "hu" | "normalized";

export type StudySlicePayload = {
  sourceIndex: number;
  width: number;
  height: number;
  diffuseBase64: string;
  roughnessBase64: string;
  thicknessBase64: string;
};

export type StudyPayload = {
  sourceType: StudyKind;
  modality: string;
  intensityMapping: IntensityMapping;
  seriesDescription?: string;
  selectedSeriesUid?: string;
  dimensions: [number, number, number];
  spacing: [number, number, number];
  totalSlices: number;
  slices: StudySlicePayload[];
};

export type StudyErrorPayload = {
  code: string;
  message: string;
};
