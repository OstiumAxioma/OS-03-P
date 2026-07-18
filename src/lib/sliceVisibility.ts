export const SLICE_TEXTURE_POOL_SIZE = 12;
export const DEFAULT_VISIBLE_SLICE_COUNT = 7;

export function clampVisibleSliceCount(requested: number, available: number): number {
  const safeAvailable = Math.max(0, Math.floor(Number.isFinite(available) ? available : 0));
  if (safeAvailable === 0) return 0;
  if (!Number.isFinite(requested)) return safeAvailable;
  return Math.min(safeAvailable, Math.max(1, Math.round(requested)));
}

export function selectVisibleSliceIndices(available: number, requested: number): number[] {
  const poolSize = Math.max(0, Math.floor(Number.isFinite(available) ? available : 0));
  const count = clampVisibleSliceCount(requested, poolSize);
  if (count === 0) return [];
  if (count === 1) return [Math.round((poolSize - 1) / 2)];
  if (count >= poolSize) return Array.from({ length: count }, (_, index) => index);

  return Array.from({ length: count }, (_, index) =>
    Math.round((index * (poolSize - 1)) / (count - 1))
  );
}
