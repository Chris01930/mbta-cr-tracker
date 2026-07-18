import type { ImageSourcePropType } from 'react-native';
import type { HeritageUnit } from '../types';

/**
 * The six heritage locomotives users pair to a consist's cab car. The MBTA API
 * never reports the locomotive's own number — only the cab car and train
 * number — so pairing is manual and user-editable, stored on-device.
 *
 * NEVER auto-match a vehicle label to a unit number: labels are cab cars, and
 * a coach could coincidentally share a unit's number.
 */
export const HERITAGE_UNITS: HeritageUnit[] = [
  { number: '1030', name: 'HSP46 1030' },
  { number: '1036', name: 'HSP46 1036' },
  { number: '1071', name: 'HSP46 1071' },
  { number: '1129', name: 'GP40MC 1129' },
  { number: '1130', name: 'GP40MC 1130' },
  { number: '1776', name: 'Spirit of Massachusetts 1776' },
];

export const HERITAGE_NUMBERS = HERITAGE_UNITS.map((u) => u.number);

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
