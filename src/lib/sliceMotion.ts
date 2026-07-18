export type SliceTransform = {
  index: number;
  x: number;
  y: number;
  z: number;
  rotationY: number;
};

export type SliceVisualState = {
  imageOpacity: number;
  glassOpacity: number;
  edgeOpacity: number;
};

export function createSliceLayout(count: number, spacing: number): SliceTransform[] {
  const center = (count - 1) / 2;

  return Array.from({ length: count }, (_, index) => ({
    index,
    x: (index - center) * spacing * 0.38,
    y: 0,
    z: (index - center) * spacing,
    rotationY: -0.08
  }));
}

export function getSliceTarget(base: SliceTransform, active: boolean): SliceTransform {
  if (!active) {
    return base;
  }

  return {
    ...base,
    x: base.x + 0.78,
    y: base.y + 0.18,
    z: base.z + 1.35,
    rotationY: base.rotationY - 0.025
  };
}

export function getSliceVisualState(active: boolean): SliceVisualState {
  return active
    ? { imageOpacity: 0.86, glassOpacity: 0.66, edgeOpacity: 0.8 }
    : { imageOpacity: 0.24, glassOpacity: 0.44, edgeOpacity: 0.52 };
}
