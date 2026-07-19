/**
 * Visual distinction for non-revenue trains (deadheads / equipment moves).
 * Pure helpers so the styling is unit-testable independent of the component.
 */

export interface PuckAppearance {
  backgroundColor: string;
  borderColor: string;
  chevronColor: string;
}

/**
 * Standard (non-heritage) train marker appearance:
 * - revenue: solid dot in the route color, white outline + chevron
 * - non-revenue: hollow ring in the route color (dark center, route-colored
 *   outline + chevron)
 */
export function puckAppearance(color: string, isNonRevenue: boolean): PuckAppearance {
  if (isNonRevenue) {
    return { backgroundColor: 'rgba(14,15,18,0.55)', borderColor: color, chevronColor: color };
  }
  return { backgroundColor: color, borderColor: '#ffffff', chevronColor: '#ffffff' };
}

/** Heritage loco icon opacity — dimmed for non-revenue movements. */
export function heritageIconOpacity(isNonRevenue: boolean): number {
  return isNonRevenue ? 0.72 : 1;
}
