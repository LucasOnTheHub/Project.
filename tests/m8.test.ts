/**
 * M8 tests — UX fluidité & LOD
 */

import { describe, it, expect } from 'vitest';

function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

function labelOpacity(cameraDist: number, near: number, far: number): number {
  return Math.max(0, Math.min(1, 1 - (cameraDist - near) / (far - near)));
}

describe('M8 — smoothstep easing', () => {
  it('returns 0 at t=0', () => { expect(smoothstep(0)).toBe(0); });
  it('returns 1 at t=1', () => { expect(smoothstep(1)).toBe(1); });
  it('returns 0.5 at t=0.5', () => { expect(smoothstep(0.5)).toBeCloseTo(0.5, 5); });
  it('clamps t below 0', () => { expect(smoothstep(-0.5)).toBe(0); });
  it('clamps t above 1', () => { expect(smoothstep(1.5)).toBe(1); });
});

describe('M8 — LOD label opacity', () => {
  const NEAR = 36;
  const FAR = 63;
  it('full opacity at near distance', () => { expect(labelOpacity(NEAR, NEAR, FAR)).toBe(1); });
  it('zero opacity at far distance', () => { expect(labelOpacity(FAR, NEAR, FAR)).toBe(0); });
  it('half opacity at midpoint', () => {
    const mid = (NEAR + FAR) / 2;
    expect(labelOpacity(mid, NEAR, FAR)).toBeCloseTo(0.5, 5);
  });
});
