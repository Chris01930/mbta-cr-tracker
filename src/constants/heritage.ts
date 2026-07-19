import { getConfig } from '../config/configStore';
import type { HeritageUnitInfo } from '../config/schema';

/**
 * Heritage locomotives users pair to a consist's cab car. The MBTA API never
 * reports the locomotive's own number — only the cab car and train number — so
 * pairing is manual and user-editable, stored on-device.
 *
 * The entire roster — road numbers, model designations, livery schemes, and
 * icon art — comes from the runtime config (`heritage_units`, authoritative).
 * Nothing is hardcoded, and icons are hosted PNG URLs loaded at runtime, so a
 * new unit appears with zero code changes.
 *
 * NEVER auto-match a vehicle label to a unit number: labels are cab cars, and
 * a coach could coincidentally share a unit's number.
 */

/** Config roster entry for a unit, or undefined if the number isn't a unit. */
export function heritageInfo(unit: string | null | undefined): HeritageUnitInfo | undefined {
  if (!unit) return undefined;
  return getConfig().heritageById[unit];
}

/** Hosted icon URL for a paired unit (undefined if the number isn't a unit). */
export function heritageIconUrl(unit: string | null | undefined): string | undefined {
  return heritageInfo(unit)?.icon;
}

/** Display label, e.g. "Boston & Maine 1030"; "Unit ####" for unknown numbers. */
export function heritageName(unit: string): string {
  const info = getConfig().heritageById[unit];
  return info ? `${info.scheme} ${info.unit}` : `Unit ${unit}`;
}

/** The heritage roster (from config). */
export function heritageUnits(): HeritageUnitInfo[] {
  return getConfig().heritageUnits;
}
