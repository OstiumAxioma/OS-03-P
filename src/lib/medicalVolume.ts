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
};

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

export function createSliceTextureData(imageData: VtkImageData, sliceIndex: number): SliceTextureData {
  const [width, height, depth] = imageData.getDimensions();
  const safeIndex = Math.min(Math.max(Math.round(sliceIndex), 0), depth - 1);
  const scalars = imageData.getPointData().getScalars().getData();
  const planeSize = width * height;
  const diffuse = new Uint8Array(planeSize * 4);
  const roughness = new Uint8Array(planeSize);
  const offset = safeIndex * planeSize;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceIndex = offset + y * width + x;
      const targetIndex = (height - 1 - y) * width + x;
      const hu = Number(scalars[sourceIndex]);
      const windowed = Math.min(1, Math.max(0, (hu + 160) / 1320));
      const tone = Math.round(Math.pow(windowed, 0.62) * 236);
      const alpha = hu < -900 ? 34 : 238;

      diffuse[targetIndex * 4] = Math.min(255, tone + 8);
      diffuse[targetIndex * 4 + 1] = Math.min(255, tone + 14);
      diffuse[targetIndex * 4 + 2] = Math.min(255, tone + 12);
      diffuse[targetIndex * 4 + 3] = alpha;
      roughness[targetIndex] = Math.round(174 + (1 - windowed) * 56 + Math.abs(Math.sin(hu * 0.031)) * 18);
    }
  }

  return { width, height, diffuse, roughness };
}
