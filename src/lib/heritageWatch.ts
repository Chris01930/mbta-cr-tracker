import type { Train } from '../types';
import type { HeritagePairs } from '../state/store';
import { cabToUnit } from '../state/store';

/**
 * A heritage locomotive currently present in a live poll: the paired unit and
 * the identifying details for a notification. A "heritage locomotive" is a
 * train whose cab car the user has paired to a heritage unit — the MBTA feed
 * never reports the locomotive itself, so this is entirely pairing-driven.
 */
export interface HeritageSighting {
  cab: string; // the cab car label (stable session key)
  unit: string; // paired heritage road number
  route: string | null;
  dest: string | null;
}

/** Every heritage locomotive visible in this set of trains (deduped by cab). */
export function heritageSightings(trains: Train[], heritage: HeritagePairs): HeritageSighting[] {
  const unitByCab = cabToUnit(heritage);
  const byCab = new Map<string, HeritageSighting>();
  for (const t of trains) {
    if (!t.cab) continue;
    const unit = unitByCab[t.cab];
    if (!unit) continue;
    // Last occurrence wins (freshest route/dest for a repeated cab).
    byCab.set(t.cab, { cab: t.cab, unit, route: t.route, dest: t.dest });
  }
  return Array.from(byCab.values());
}

/**
 * Given the currently visible heritage locomotives and the set of cabs already
 * announced this live session, return the newly-arrived ones. Pure: the caller
 * owns the `seen` set and adds the returned cabs to it. The first call after
 * entering live mode should be treated as a silent baseline (see the hook) so a
 * heritage loco already out at launch doesn't trigger a burst of alerts.
 */
export function newHeritageArrivals(
  sightings: HeritageSighting[],
  seen: ReadonlySet<string>,
): HeritageSighting[] {
  return sightings.filter((s) => !seen.has(s.cab));
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
