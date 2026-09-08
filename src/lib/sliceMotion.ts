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

export function getSliceTarget(base: SliceTransform, active: boolean, inspection = 0): SliceTransform {
  if (!active) {
    return base;
  }

  return {
    ...base,
    y: base.y + 0.4 + 3.8 * Math.max(0, Math.min(1, inspection))
  };
}

export type MotionSpring = { value: number; velocity: number };

// Exact critically damped integration, retaining momentum on interrupted input.
export function stepSpring(state: MotionSpring, target: number, rate: number, dt: number) {
  const offset = state.value - target;
  const impulse = state.velocity + rate * offset;
  const decay = Math.exp(-rate * dt);
  state.value = target + (offset + impulse * dt) * decay;
  state.velocity = (state.velocity - rate * impulse * dt) * decay;
}

export function smoothStep(value: number) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * t * (10 + t * (-15 + 6 * t));
}

export function getEntryLift(rank: number, count: number, elapsed: number, reduced: boolean) {
  if (reduced) return 0;
  const delay = (rank / Math.max(1, count - 1)) * 0.65;
  const progress = smoothStep((elapsed - delay) / 1.75);
  return (1 - progress) * (1.1 + Math.sin(progress * Math.PI) * 1.5);
}

// Signed wave packet from the reference, with a shorter amplitude for this stack.
export function getSelectionWave(distance: number, age: number) {
  if (age < 0 || age > 3.2) return 0;
  const phase = Math.abs(distance) - age * 8;
  return 0.32 * smoothStep(age / 0.2) * Math.exp(-age * 1.15)
    * Math.cos(phase * 0.58) * Math.exp(-0.5 * (phase / 3.4) ** 2);
}

export function getSliceVisualState(active: boolean): SliceVisualState {
  return active
    ? { tissueIntensity: 1.15, sssScale: 1, edgeOpacity: 0.78 }
    : { tissueIntensity: 1, sssScale: 0.72, edgeOpacity: 0.38 };
}
