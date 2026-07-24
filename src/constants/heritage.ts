import { getConfig } from '../config/configStore';
import type { HeritageUnitInfo } from '../config/schema';

/**
 * Notable units — locomotives users pair to a consist's cab car. The MBTA API
 * never reports the locomotive's own number — only the cab car and train number
 * — so pairing is manual and user-editable, stored on-device.
 *
 * "Notable" is the user-facing framing as of config schema v3: the roster spans
 * heritage liveries, commemorative schemes, and leased power, distinguished by
 * `category`. Pairing mechanics are identical for every category; the config
 * key stays `heritage_units` for compatibility.
 *
 * The entire roster — road numbers, model designations, livery schemes,
 * categories, and icon art — comes from the runtime config (authoritative).
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

/** The notable-unit roster (from config). */
export function heritageUnits(): HeritageUnitInfo[] {
  return getConfig().heritageUnits;
}

/**
 * "Lease power · RSTX" — the category label with the reporting mark appended
 * when the unit is owned by someone other than the MBTA.
 */
export function unitCategoryLine(info: HeritageUnitInfo): string {
  return info.owner ? `${info.categoryLabel} · ${info.owner}` : info.categoryLabel;
}

export interface UnitGroup {
  category: string;
  label: string;
  units: HeritageUnitInfo[];
}

/**
 * The roster grouped for display. Group order follows the server's declared key
 * order in `unit_categories`, so the ordering is retunable without an app
 * update; categories absent from that map (including uncategorized entries)
 * sort last, alphabetically, rather than disappearing. Empty groups are dropped.
 */
export function groupUnitsByCategory(
  units: HeritageUnitInfo[],
  categories: Record<string, string>,
): UnitGroup[] {
  const byCategory = new Map<string, HeritageUnitInfo[]>();
  for (const u of units) {
    const list = byCategory.get(u.category);
    if (list) list.push(u);
    else byCategory.set(u.category, [u]);
  }

  const declared = Object.keys(categories);
  const extra = [...byCategory.keys()].filter((c) => !declared.includes(c)).sort();

  const out: UnitGroup[] = [];
  for (const category of [...declared, ...extra]) {
    const group = byCategory.get(category);
    if (!group?.length) continue;
    out.push({ category, label: categories[category] ?? (category || 'Other'), units: group });
  }
  return out;
}
