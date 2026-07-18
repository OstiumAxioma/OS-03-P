export type SliceTransform = {
  index: number;
  x: number;
  y: number;
  z: number;
  rotationZ: number;
};

export type SliceVisualState = {
  tissueIntensity: number;
  sssScale: number;
  edgeOpacity: number;
};

export function createSliceLayout(count: number, spacing: number): SliceTransform[] {
  const center = (count - 1) / 2;

  return Array.from({ length: count }, (_, index) => ({
    index,
    x: (index - center) * spacing * 0.38,
    y: (index - center) * spacing,
    z: 0,
    rotationZ: -0.08
  }));
}

export function getSliceTarget(base: SliceTransform, active: boolean): SliceTransform {
  if (!active) {
    return base;
  }

  return {
    ...base,
    x: base.x + 0.78,
    z: base.z + 2.25,
    rotationZ: base.rotationZ - 0.025
  };
}

export function getSliceVisualState(active: boolean): SliceVisualState {
  return active
    ? { tissueIntensity: 1, sssScale: 1, edgeOpacity: 0.78 }
    : { tissueIntensity: 0.72, sssScale: 0.62, edgeOpacity: 0.38 };
}
