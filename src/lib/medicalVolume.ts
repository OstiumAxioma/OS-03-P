import vtkDataArray from "@kitware/vtk.js/Common/Core/DataArray";
import vtkImageData, { type vtkImageData as VtkImageData } from "@kitware/vtk.js/Common/DataModel/ImageData";

export type MedicalVolume = {
  dimensions: [number, number, number];
  values: number[];
};

export type SliceTextureData = {
  width: number;
  height: number;
  diffuse: Uint8Array;
  roughness: Uint8Array;
  thickness: Uint8Array;
};

export type IntensityMapping = "hu" | "normalized";

export type TissueSample = {
  color: [number, number, number];
  alpha: number;
  roughness: number;
  thickness: number;
};

type TissueTransferPoint = TissueSample & {
  value: number;
};

const HU_TISSUE_TRANSFER: TissueTransferPoint[] = [
  { value: -1000, color: [0, 0, 0], alpha: 0, roughness: 255, thickness: 0 },
  { value: -900, color: [42, 20, 24], alpha: 0, roughness: 244, thickness: 0 },
  { value: -700, color: [172, 82, 92], alpha: 82, roughness: 222, thickness: 72 },
  { value: -300, color: [196, 116, 104], alpha: 142, roughness: 210, thickness: 110 },
  { value: -120, color: [235, 188, 72], alpha: 190, roughness: 194, thickness: 152 },
  { value: -40, color: [238, 158, 68], alpha: 210, roughness: 184, thickness: 174 },
  { value: 20, color: [172, 54, 48], alpha: 225, roughness: 176, thickness: 214 },
  { value: 80, color: [154, 34, 40], alpha: 235, roughness: 166, thickness: 228 },
  { value: 200, color: [205, 74, 56], alpha: 242, roughness: 148, thickness: 188 },
  { value: 400, color: [235, 172, 124], alpha: 248, roughness: 124, thickness: 132 },
  { value: 1200, color: [244, 228, 212], alpha: 255, roughness: 88, thickness: 62 },
  { value: 2500, color: [255, 248, 238], alpha: 255, roughness: 70, thickness: 42 }
];

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function interpolateByte(start: number, end: number, factor: number): number {
  return Math.round(start + (end - start) * factor);
}

export function mapHuToTissue(hu: number): TissueSample {
  const value = Number.isFinite(hu) ? hu : HU_TISSUE_TRANSFER[0].value;
  const upperIndex = HU_TISSUE_TRANSFER.findIndex((point) => value <= point.value);

  if (upperIndex <= 0) {
    const first = HU_TISSUE_TRANSFER[0];
    return { color: [...first.color], alpha: first.alpha, roughness: first.roughness, thickness: first.thickness };
  }
  if (upperIndex === -1) {
    const last = HU_TISSUE_TRANSFER[HU_TISSUE_TRANSFER.length - 1];
    return { color: [...last.color], alpha: last.alpha, roughness: last.roughness, thickness: last.thickness };
  }

  const lower = HU_TISSUE_TRANSFER[upperIndex - 1];
  const upper = HU_TISSUE_TRANSFER[upperIndex];
  const factor = clamp01((value - lower.value) / (upper.value - lower.value));

  return {
    color: lower.color.map((channel, index) => interpolateByte(channel, upper.color[index], factor)) as [number, number, number],
    alpha: interpolateByte(lower.alpha, upper.alpha, factor),
    roughness: interpolateByte(lower.roughness, upper.roughness, factor),
    thickness: interpolateByte(lower.thickness, upper.thickness, factor)
  };
}

export function mapNormalizedToTissue(value: number): TissueSample {
  return mapHuToTissue(-1000 + clamp01(value) * 2200);
}

export function createMedicalVolume(width: number, height: number, depth: number): MedicalVolume {
  const values = new Array<number>(width * height * depth);

  for (let z = 0; z < depth; z += 1) {
    const nz = (z / Math.max(depth - 1, 1)) * 2 - 1;
    const taper = Math.sqrt(Math.max(0.18, 1 - nz * nz * 0.7));

    for (let y = 0; y < height; y += 1) {
      const ny = (y / Math.max(height - 1, 1)) * 2 - 1;

      for (let x = 0; x < width; x += 1) {
        const nx = (x / Math.max(width - 1, 1)) * 2 - 1;
        const radial = Math.sqrt((nx / (0.78 * taper)) ** 2 + (ny / (0.94 * taper)) ** 2);
        const noise = Math.sin(x * 1.71 + y * 0.83 + z * 1.27) * 7;
        let value = -1000;

        if (radial < 0.98) {
          value = 34 + noise;
        }

        if (radial > 0.82 && radial < 0.98) {
          value = 1120 + noise * 3;
        }

        const ventricleLeft = ((nx + 0.12) / 0.11) ** 2 + ((ny + 0.02) / 0.16) ** 2;
        const ventricleRight = ((nx - 0.12) / 0.11) ** 2 + ((ny + 0.02) / 0.16) ** 2;
        if (Math.abs(nz) < 0.42 && Math.min(ventricleLeft, ventricleRight) < 1) {
          value = -18 + noise * 0.4;
        }

        const sinusLeft = ((nx + 0.23) / 0.13) ** 2 + ((ny - 0.47) / 0.16) ** 2;
        const sinusRight = ((nx - 0.23) / 0.13) ** 2 + ((ny - 0.47) / 0.16) ** 2;
        if (nz < -0.05 && Math.min(sinusLeft, sinusRight) < 1) {
          value = -780 + noise;
        }

        const lesion = ((nx - 0.26) / 0.12) ** 2 + ((ny + 0.18) / 0.11) ** 2 + ((nz - 0.08) / 0.24) ** 2;
        if (lesion < 1 && radial < 0.78) {
          value = 92 + noise * 0.7;
        }

        values[z * width * height + y * width + x] = Math.round(value);
      }
    }
  }

  return {
    dimensions: [width, height, depth],
    values
  };
}

export function getAxialSlice(volume: MedicalVolume, sliceIndex: number): number[] {
  const [width, height, depth] = volume.dimensions;
  const safeIndex = Math.min(Math.max(Math.round(sliceIndex), 0), depth - 1);
  const planeSize = width * height;
  const offset = safeIndex * planeSize;

  return volume.values.slice(offset, offset + planeSize);
}

export function selectSliceIndices(depth: number, count: number): number[] {
  if (count <= 0 || depth <= 0) {
    return [];
  }

  const first = Math.round(depth * 0.15);
  const last = Math.min(depth - 1, Math.round(depth * 0.825));

  if (count === 1) {
    return [Math.round((first + last) / 2)];
  }

  return Array.from({ length: count }, (_, index) => Math.round(first + ((last - first) * index) / (count - 1)));
}

export function toVtkImageData(volume: MedicalVolume): VtkImageData {
  const imageData = vtkImageData.newInstance();
  const values = new Float32Array(volume.values);

  imageData.setDimensions(...volume.dimensions);
  imageData.setSpacing([0.7, 0.7, 1.2]);
  imageData.getPointData().setScalars(
    vtkDataArray.newInstance({
      name: "Synthetic CT (HU)",
      numberOfComponents: 1,
      values
    })
  );

  return imageData;
}

export function createSliceTextureData(
  imageData: VtkImageData,
  sliceIndex: number,
  intensityMapping: IntensityMapping = "hu"
): SliceTextureData {
  const [width, height, depth] = imageData.getDimensions();
  const safeIndex = Math.min(Math.max(Math.round(sliceIndex), 0), depth - 1);
  const scalars = imageData.getPointData().getScalars().getData();
  const planeSize = width * height;
  const diffuse = new Uint8Array(planeSize * 4);
  const roughness = new Uint8Array(planeSize);
  const thickness = new Uint8Array(planeSize);
  const offset = safeIndex * planeSize;
  const range = imageData.getPointData().getScalars().getRange();
  const rangeWidth = Math.max(Number.EPSILON, range[1] - range[0]);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceIndex = offset + y * width + x;
      const targetIndex = (height - 1 - y) * width + x;
      const scalar = Number(scalars[sourceIndex]);
      const sample = intensityMapping === "hu"
        ? mapHuToTissue(scalar)
        : mapNormalizedToTissue((scalar - range[0]) / rangeWidth);

      diffuse[targetIndex * 4] = sample.color[0];
      diffuse[targetIndex * 4 + 1] = sample.color[1];
      diffuse[targetIndex * 4 + 2] = sample.color[2];
      diffuse[targetIndex * 4 + 3] = sample.alpha;
      roughness[targetIndex] = sample.roughness;
      thickness[targetIndex] = sample.thickness;
    }
  }

  return { width, height, diffuse, roughness, thickness };
}
