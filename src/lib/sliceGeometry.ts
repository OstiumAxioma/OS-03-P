export type SliceWorldDimensions = {
  width: number;
  height: number;
  thickness: number;
  worldUnitsPerMillimeter: number;
};

export const SLICE_THICKNESS_SCALE_MIN = 0.25;
export const SLICE_THICKNESS_SCALE_MAX = 5;
export const SLICE_THICKNESS_SCALE_STEP = 0.25;
export const DEFAULT_SLICE_THICKNESS_SCALE = 0.25;
export const TISSUE_EXTRUSION_VISIBLE_THICKNESS_MIN = 0.32;
export const TISSUE_EXTRUSION_VISIBLE_THICKNESS_RATIO = 14;

export function clampSliceThicknessScale(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SLICE_THICKNESS_SCALE;
  return Math.min(SLICE_THICKNESS_SCALE_MAX, Math.max(SLICE_THICKNESS_SCALE_MIN, value));
}

export function getBottomAlignedCenterY(height: number, baselineY: number): number {
  return baselineY + Math.max(0, height) / 2;
}

export function getVisibleTissueExtrusionThickness(physicalSliceThickness: number): number {
  return Math.max(
    TISSUE_EXTRUSION_VISIBLE_THICKNESS_MIN,
    Math.max(0, physicalSliceThickness) * TISSUE_EXTRUSION_VISIBLE_THICKNESS_RATIO
  );
}

function positiveOrOne(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export function calculateSliceWorldDimensions(
  textureWidth: number,
  textureHeight: number,
  spacing: readonly [number, number, number],
  maxWidth: number,
  maxHeight: number
): SliceWorldDimensions {
  const widthPixels = positiveOrOne(textureWidth);
  const heightPixels = positiveOrOne(textureHeight);
  const spacingX = positiveOrOne(spacing[0]);
  const spacingY = positiveOrOne(spacing[1]);
  const spacingZ = positiveOrOne(spacing[2]);
  const physicalWidth = widthPixels * spacingX;
  const physicalHeight = heightPixels * spacingY;
  const worldUnitsPerMillimeter = Math.min(maxWidth / physicalWidth, maxHeight / physicalHeight);

  return {
    width: physicalWidth * worldUnitsPerMillimeter,
    height: physicalHeight * worldUnitsPerMillimeter,
    thickness: spacingZ * worldUnitsPerMillimeter,
    worldUnitsPerMillimeter
  };
}
