export type TissueExtrusionCell = {
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  roughness: number;
  color: [number, number, number];
};

export type TissueExtrusionOptions = {
  width: number;
  height: number;
  diffuse: Uint8Array;
  roughness: Uint8Array;
  thickness: Uint8Array;
  maxCellsPerAxis?: number;
  alphaThreshold?: number;
};

export type TissueExtrusionSurface = {
  positions: Float32Array;
  uvs: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  gridWidth: number;
  gridHeight: number;
  cellCount: number;
  boundaryEdgeCount: number;
};

export const DEFAULT_TISSUE_EXTRUSION_MAX_CELLS_PER_AXIS = 512;
export const DEFAULT_TISSUE_EXTRUSION_ALPHA_THRESHOLD = 24;
export const TISSUE_EXTRUSION_MIN_DEPTH = 0.18;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function createTissueExtrusionCells(options: TissueExtrusionOptions): TissueExtrusionCell[] {
  const width = Math.max(1, Math.floor(options.width));
  const height = Math.max(1, Math.floor(options.height));
  const maxCellsPerAxis = Math.max(1, Math.floor(options.maxCellsPerAxis ?? DEFAULT_TISSUE_EXTRUSION_MAX_CELLS_PER_AXIS));
  const alphaThreshold = Math.max(0, Math.floor(options.alphaThreshold ?? DEFAULT_TISSUE_EXTRUSION_ALPHA_THRESHOLD));
  const step = Math.max(1, Math.ceil(Math.max(width, height) / maxCellsPerAxis));
  const cells: TissueExtrusionCell[] = [];

  for (let y = 0; y < height; y += step) {
    const blockHeight = Math.min(step, height - y);
    for (let x = 0; x < width; x += step) {
      const blockWidth = Math.min(step, width - x);
      let tissueCount = 0;
      let alphaSum = 0;
      let redSum = 0;
      let greenSum = 0;
      let blueSum = 0;
      let roughnessSum = 0;
      let thicknessSum = 0;

      for (let blockY = 0; blockY < blockHeight; blockY += 1) {
        for (let blockX = 0; blockX < blockWidth; blockX += 1) {
          const index = (y + blockY) * width + x + blockX;
          const alpha = options.diffuse[index * 4 + 3] ?? 0;
          if (alpha < alphaThreshold) continue;

          tissueCount += 1;
          alphaSum += alpha;
          redSum += options.diffuse[index * 4] ?? 0;
          greenSum += options.diffuse[index * 4 + 1] ?? 0;
          blueSum += options.diffuse[index * 4 + 2] ?? 0;
          roughnessSum += options.roughness[index] ?? 180;
          thicknessSum += options.thickness[index] ?? alpha;
        }
      }

      if (tissueCount === 0) continue;

      const coverage = tissueCount / (blockWidth * blockHeight);
      const averageThickness = thicknessSum / tissueCount / 255;
      const averageAlpha = alphaSum / tissueCount / 255;
      const depth = clamp01(Math.max(TISSUE_EXTRUSION_MIN_DEPTH, averageThickness * 0.72 + averageAlpha * 0.28) * coverage);

      cells.push({
        x: (x + blockWidth / 2) / width - 0.5,
        y: 0.5 - (y + blockHeight / 2) / height,
        width: blockWidth / width,
        height: blockHeight / height,
        depth,
        roughness: roughnessSum / tissueCount / 255,
        color: [
          Math.round(redSum / tissueCount),
          Math.round(greenSum / tissueCount),
          Math.round(blueSum / tissueCount)
        ]
      });
    }
  }

  return cells;
}

function samplePixel(options: TissueExtrusionOptions, x: number, y: number) {
  const width = Math.max(1, Math.floor(options.width));
  const height = Math.max(1, Math.floor(options.height));
  const safeX = Math.min(width - 1, Math.max(0, x));
  const safeY = Math.min(height - 1, Math.max(0, y));
  const index = safeY * width + safeX;
  const alpha = options.diffuse[index * 4 + 3] ?? 0;

  return {
    alpha,
    depth: clamp01(((options.thickness[index] ?? alpha) / 255) * 0.72 + (alpha / 255) * 0.28),
    color: [
      (options.diffuse[index * 4] ?? 0) / 255,
      (options.diffuse[index * 4 + 1] ?? 0) / 255,
      (options.diffuse[index * 4 + 2] ?? 0) / 255
    ] as [number, number, number]
  };
}

function getGridSize(sourceWidth: number, sourceHeight: number, maxCellsPerAxis: number) {
  const scale = Math.min(1, maxCellsPerAxis / sourceWidth, maxCellsPerAxis / sourceHeight);

  return {
    gridWidth: Math.max(1, Math.round(sourceWidth * scale)),
    gridHeight: Math.max(1, Math.round(sourceHeight * scale))
  };
}

function getCellSourceBounds(
  x: number,
  y: number,
  gridWidth: number,
  gridHeight: number,
  sourceWidth: number,
  sourceHeight: number
) {
  const minX = Math.floor((x / gridWidth) * sourceWidth);
  const maxX = Math.max(minX + 1, Math.floor(((x + 1) / gridWidth) * sourceWidth));
  const minY = Math.floor((y / gridHeight) * sourceHeight);
  const maxY = Math.max(minY + 1, Math.floor(((y + 1) / gridHeight) * sourceHeight));

  return {
    minX: Math.min(sourceWidth, minX),
    maxX: Math.min(sourceWidth, maxX),
    minY: Math.min(sourceHeight, minY),
    maxY: Math.min(sourceHeight, maxY)
  };
}

function sampleCell(
  options: TissueExtrusionOptions,
  x: number,
  y: number,
  gridWidth: number,
  gridHeight: number,
  sourceWidth: number,
  sourceHeight: number
) {
  const bounds = getCellSourceBounds(x, y, gridWidth, gridHeight, sourceWidth, sourceHeight);
  let alphaSum = 0;
  let maxAlpha = 0;
  let redSum = 0;
  let greenSum = 0;
  let blueSum = 0;
  let samples = 0;

  for (let sourceY = bounds.minY; sourceY < bounds.maxY; sourceY += 1) {
    for (let sourceX = bounds.minX; sourceX < bounds.maxX; sourceX += 1) {
      const sample = samplePixel(options, sourceX, sourceY);
      alphaSum += sample.alpha;
      maxAlpha = Math.max(maxAlpha, sample.alpha);
      redSum += sample.color[0];
      greenSum += sample.color[1];
      blueSum += sample.color[2];
      samples += 1;
    }
  }

  return {
    alpha: samples > 0 ? alphaSum / samples : 0,
    maxAlpha,
    color: [
      samples > 0 ? redSum / samples : 0,
      samples > 0 ? greenSum / samples : 0,
      samples > 0 ? blueSum / samples : 0
    ] as [number, number, number]
  };
}

export function createTissueExtrusionSurface(options: TissueExtrusionOptions): TissueExtrusionSurface {
  const sourceWidth = Math.max(1, Math.floor(options.width));
  const sourceHeight = Math.max(1, Math.floor(options.height));
  const maxCellsPerAxis = Math.max(1, Math.floor(options.maxCellsPerAxis ?? DEFAULT_TISSUE_EXTRUSION_MAX_CELLS_PER_AXIS));
  const alphaThreshold = Math.max(0, Math.floor(options.alphaThreshold ?? DEFAULT_TISSUE_EXTRUSION_ALPHA_THRESHOLD));
  const { gridWidth, gridHeight } = getGridSize(sourceWidth, sourceHeight, maxCellsPerAxis);
  const activeCells = new Uint8Array(gridWidth * gridHeight);
  const vertexColors = new Float32Array((gridWidth + 1) * (gridHeight + 1) * 3);
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  let cellCount = 0;
  let boundaryEdgeCount = 0;

  const sourceXFor = (x: number) => Math.min(sourceWidth - 1, Math.max(0, Math.floor((x / Math.max(gridWidth, 1)) * sourceWidth)));
  const sourceYFor = (y: number) => Math.min(sourceHeight - 1, Math.max(0, Math.floor((y / Math.max(gridHeight, 1)) * sourceHeight)));
  const vertexIndex = (x: number, y: number) => y * (gridWidth + 1) + x;
  const cellIndex = (x: number, y: number) => y * gridWidth + x;

  for (let y = 0; y < gridHeight; y += 1) {
    for (let x = 0; x < gridWidth; x += 1) {
      const sample = sampleCell(options, x, y, gridWidth, gridHeight, sourceWidth, sourceHeight);
      if (sample.maxAlpha >= alphaThreshold) {
        activeCells[cellIndex(x, y)] = 1;
        cellCount += 1;
      }
    }
  }

  for (let y = 0; y <= gridHeight; y += 1) {
    for (let x = 0; x <= gridWidth; x += 1) {
      let alphaSum = 0;
      let redSum = 0;
      let greenSum = 0;
      let blueSum = 0;
      let samples = 0;

      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const sample = samplePixel(options, sourceXFor(x + offsetX), sourceYFor(y + offsetY));
          alphaSum += sample.alpha;
          redSum += sample.color[0];
          greenSum += sample.color[1];
          blueSum += sample.color[2];
          samples += 1;
        }
      }

      const index = vertexIndex(x, y);
      const alphaWeight = clamp01(alphaSum / samples / 255);
      vertexColors[index * 3] = (redSum / samples) * alphaWeight;
      vertexColors[index * 3 + 1] = (greenSum / samples) * alphaWeight;
      vertexColors[index * 3 + 2] = (blueSum / samples) * alphaWeight;
    }
  }

  const addVertex = (x: number, y: number, z: number, colorIndex: number, gridX: number, gridY: number) => {
    positions.push(x, y, z);
    uvs.push(gridX / gridWidth, gridY / gridHeight);
    colors.push(vertexColors[colorIndex * 3], vertexColors[colorIndex * 3 + 1], vertexColors[colorIndex * 3 + 2]);
    return positions.length / 3 - 1;
  };

  const backVertexIds = new Int32Array((gridWidth + 1) * (gridHeight + 1)).fill(-1);
  const getBackVertex = (x: number, y: number) => {
    const index = vertexIndex(x, y);
    if (backVertexIds[index] >= 0) return backVertexIds[index];
    const px = x / gridWidth - 0.5;
    const py = y / gridHeight - 0.5;
    const pz = -0.5;
    const id = addVertex(px, py, pz, index, x, y);
    backVertexIds[index] = id;
    return id;
  };

  for (let y = 0; y < gridHeight; y += 1) {
    for (let x = 0; x < gridWidth; x += 1) {
      if (!activeCells[cellIndex(x, y)]) continue;
      const a = getBackVertex(x, y);
      const b = getBackVertex(x + 1, y);
      const c = getBackVertex(x + 1, y + 1);
      const d = getBackVertex(x, y + 1);
      indices.push(a, c, b, a, d, c);

      const edges: Array<[number, number, number, number, boolean]> = [
        [x, y, x + 1, y, y === 0 || !activeCells[cellIndex(x, y - 1)]],
        [x + 1, y, x + 1, y + 1, x === gridWidth - 1 || !activeCells[cellIndex(x + 1, y)]],
        [x + 1, y + 1, x, y + 1, y === gridHeight - 1 || !activeCells[cellIndex(x, y + 1)]],
        [x, y + 1, x, y, x === 0 || !activeCells[cellIndex(x - 1, y)]]
      ];

      edges.forEach(([x0, y0, x1, y1, boundary]) => {
        if (!boundary) return;
        boundaryEdgeCount += 1;
        const i0 = vertexIndex(x0, y0);
        const i1 = vertexIndex(x1, y1);
        const fx0 = x0 / gridWidth - 0.5;
        const fy0 = y0 / gridHeight - 0.5;
        const fx1 = x1 / gridWidth - 0.5;
        const fy1 = y1 / gridHeight - 0.5;
        const front0 = addVertex(fx0, fy0, 0.5, i0, x0, y0);
        const front1 = addVertex(fx1, fy1, 0.5, i1, x1, y1);
        const back1 = getBackVertex(x1, y1);
        const back0 = getBackVertex(x0, y0);
        indices.push(front0, back1, front1, front0, back0, back1);
      });
    }
  }

  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
    gridWidth,
    gridHeight,
    cellCount,
    boundaryEdgeCount
  };
}
