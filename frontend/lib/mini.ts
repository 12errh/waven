/**
 * Compact player geometry and helpers.
 *
 * The window sizes mirror `internal/desktop/bounds.go` so the native resize and
 * the compact layout agree on the same frame. Keep the two in sync when either
 * changes.
 */

export const MINI_WIDTH = 380;
export const MINI_HEIGHT = 128;
export const MINI_MIN_WIDTH = 320;
export const MINI_MIN_HEIGHT = 112;
export const MINI_MAX_WIDTH = 560;
export const MINI_MAX_HEIGHT = 220;

/** Below this width the compact player drops its secondary controls. */
export const MINI_NARROW_WIDTH = 360;

export function isNarrowMini(width: number): boolean {
  return width > 0 && width < MINI_NARROW_WIDTH;
}

/**
 * Fraction of the track that has been played, clamped to 0–1. A track without a
 * known duration (a restored session before metadata loads) reports 0 rather
 * than NaN.
 */
export function miniProgressRatio(positionSec: number, durationSec: number): number {
  if (!Number.isFinite(positionSec) || !Number.isFinite(durationSec) || durationSec <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, positionSec / durationSec));
}

/**
 * Position (0–1) of a pointer press inside the progress strip. Used by the mini
 * player so a click seeks to that point instead of only dragging.
 */
export function miniSeekRatio(clientX: number, left: number, width: number): number {
  if (!Number.isFinite(clientX) || !Number.isFinite(left) || !Number.isFinite(width) || width <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, (clientX - left) / width));
}

