export type SliceWorldDimensions = {
  width: number;
  height: number;
  thickness: number;
  worldUnitsPerMillimeter: number;
};

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
