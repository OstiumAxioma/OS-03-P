export type SliceTransform = {
  index: number;
  x: number;
  y: number;
  z: number;
};

export const SLICE_STACK_GAP = 0.46;

export function getSliceStackZ(index: number, count: number, thickness: number): number {
  const center = (count - 1) / 2;
  return (index - center) * (Math.max(0, thickness) + SLICE_STACK_GAP);
}

export type SliceVisualState = {
  tissueIntensity: number;
  sssScale: number;
  edgeOpacity: number;
};

export function createSliceLayout(count: number, spacing: number): SliceTransform[] {
  const center = (count - 1) / 2;

  return Array.from({ length: count }, (_, index) => ({
    index,
    x: 0,
    y: 0,
    z: (index - center) * spacing
  }));
}

export function getSliceTarget(base: SliceTransform, active: boolean): SliceTransform {
  if (!active) {
    return base;
  }

  return {
    ...base,
    x: base.x + 0.78,
    y: base.y + 2.25
  };
}

export function getSliceVisualState(active: boolean): SliceVisualState {
  return active
    ? { tissueIntensity: 1.15, sssScale: 1, edgeOpacity: 0.78 }
    : { tissueIntensity: 1, sssScale: 0.72, edgeOpacity: 0.38 };
}
