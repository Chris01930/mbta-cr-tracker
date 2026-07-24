import type { Train } from '../types';
import type { HeritagePairs } from '../state/store';
import { unitsByCab } from '../state/store';

/**
 * A notable locomotive currently present in the live feed: the assigned unit
 * and the identifying details for a notification. "Notable locomotive" means a
 * train whose cab car the user has assigned a unit to — the MBTA feed never
 * reports the locomotive itself, so this is entirely assignment-driven.
 */
export interface HeritageSighting {
  cab: string; // the cab car label
  unit: string; // assigned road number
  route: string | null;
  dest: string | null;
}

/**
 * Every notable locomotive visible in this set of trains, one sighting PER
 * UNIT. A designated cab can carry two, and both deserve their own alert —
 * keying by cab alone would silently announce only one of a doubleheader.
 */
export function heritageSightings(trains: Train[], heritage: HeritagePairs): HeritageSighting[] {
  const byCab = unitsByCab(heritage);
  // Keyed by cab+unit; last occurrence wins (freshest route/dest for a cab
  // that appears more than once in the set).
  const seen = new Map<string, HeritageSighting>();
  for (const t of trains) {
    if (!t.cab) continue;
    for (const unit of byCab[t.cab] ?? []) {
      seen.set(`${t.cab}:${unit}`, { cab: t.cab, unit, route: t.route, dest: t.dest });
    }
  }
  return Array.from(seen.values());
}

/**
 * Announcement identity: cab AND unit, so adding a second unit to a cab that
 * was already announced still alerts for the newcomer.
 */
export function sightingKey(s: HeritageSighting): string {
  return `${s.cab}:${s.unit}`;
}

/**
 * Given the currently visible notable locomotives and the set already announced
 * this live session, return the newly-arrived ones. Pure: the caller owns the
 * `seen` set and adds the returned keys to it. The first call after entering
 * live mode should be treated as a silent baseline (see the hook) so a unit
 * already out at launch doesn't trigger a burst of alerts.
 */
export function newHeritageArrivals(
  sightings: HeritageSighting[],
  seen: ReadonlySet<string>,
): HeritageSighting[] {
  return sightings.filter((s) => !seen.has(sightingKey(s)));
}

/**
 * Notification copy for a heritage arrival: the locomotive name as the title,
 * the route it's on plus its destination as the body. Destination is omitted
 * gracefully when the trip has no headsign (e.g. a non-revenue move).
 */
export function heritageMessage(
  name: string,
  routeLabel: string,
  dest: string | null,
): { title: string; body: string } {
  return {
    title: `🚂 ${name}`,
    body: dest ? `${routeLabel} · to ${dest}` : routeLabel,
  };
}
