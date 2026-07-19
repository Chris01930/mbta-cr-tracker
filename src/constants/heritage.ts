import type { ImageSourcePropType } from 'react-native';
import { getConfig } from '../config/configStore';
import type { HeritageUnit } from '../types';

/**
 * Heritage locomotives users pair to a consist's cab car. The MBTA API never
 * reports the locomotive's own number — only the cab car and train number — so
 * pairing is manual and user-editable, stored on-device.
 *
 * NEVER auto-match a vehicle label to a unit number: labels are cab cars, and
 * a coach could coincidentally share a unit's number.
 *
 * The *which units exist* list comes from the runtime config (`heritage_units`),
 * so a new unit can be added server-side. Human-readable names and icon art are
 * baked in (config only carries numbers); an unrecognized number still works
 * with a generic "Unit ####" label and no custom icon.
 */

/** Baked-in friendly names by unit number. */
export const HERITAGE_NAMES: Record<string, string> = {
  '1030': 'HSP46 1030',
  '1036': 'HSP46 1036',
  '1071': 'HSP46 1071',
  '1129': 'GP40MC 1129',
  '1130': 'GP40MC 1130',
  '1776': 'Spirit of Massachusetts 1776',
};

/**
 * Per-unit icon art (front-elevation loco illustrations). Metro requires static
 * require() paths, so this is a literal map keyed by unit number. When a train's
 * cab is paired to one of these units, its marker renders this icon instead of
 * the standard route-colored circle.
 */
export const HERITAGE_ICONS: Record<string, ImageSourcePropType> = {
  '1030': require('../../assets/loco_1030.png'),
  '1036': require('../../assets/loco_1036.png'),
  '1071': require('../../assets/loco_1071.png'),
  '1129': require('../../assets/loco_1129.png'),
  '1130': require('../../assets/loco_1130.png'),
  '1776': require('../../assets/loco_1776.png'),
};

export function heritageIcon(unit: string | null | undefined): ImageSourcePropType | undefined {
  return unit ? HERITAGE_ICONS[unit] : undefined;
}

export function heritageName(unit: string): string {
  return HERITAGE_NAMES[unit] ?? `Unit ${unit}`;
}

/** The active heritage unit list (numbers from config + baked-in names). */
export function heritageUnits(): HeritageUnit[] {
  return getConfig().heritageUnits.map((number) => ({ number, name: heritageName(number) }));
}
