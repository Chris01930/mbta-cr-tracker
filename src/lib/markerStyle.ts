/**
 * Visual distinction for non-revenue trains (deadheads / equipment moves).
 * Pure helpers so the styling is unit-testable independent of the component.
 */

export interface PuckAppearance {
  backgroundColor: string;
  borderColor: string;
  chevronColor: string;
  /** Dashed ring (ghost) vs solid outline. */
  dashed: boolean;
}

/**
 * Standard (non-heritage) train marker appearance. Priority: ghost wins.
 * - ghost: DASHED ring in the route color (dark center)
 * - non-revenue: solid hollow ring in the route color (dark center)
 * - revenue: solid dot filled with the route color (white outline + chevron)
 */
export function puckAppearance(color: string, isNonRevenue: boolean, isGhost: boolean): PuckAppearance {
  if (isGhost) {
    return { backgroundColor: 'rgba(14,15,18,0.55)', borderColor: color, chevronColor: color, dashed: true };
  }
  if (isNonRevenue) {
    return { backgroundColor: 'rgba(14,15,18,0.55)', borderColor: color, chevronColor: color, dashed: false };
  }
  return { backgroundColor: color, borderColor: '#ffffff', chevronColor: '#ffffff', dashed: false };
}

/** Heritage loco icon opacity — dimmed for non-revenue movements. */
export function heritageIconOpacity(isNonRevenue: boolean): number {
  return isNonRevenue ? 0.72 : 1;
}
