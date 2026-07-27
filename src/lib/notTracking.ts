import type { ScheduledStop, ScheduledTrip } from '../api/mbta';

/**
 * "Not tracking" (dark trains): consists that are scheduled and physically
 * running but absent from the live vehicle feed entirely — dead or unlogged
 * AVL. The feed can't show them; the schedule shows their absence. Real case:
 * the cab 1815 set (carrying notable unit 1130) ran dark for over a week and
 * was only found by eyesight, parked at Rockport.
 *
 * This is a LIST, never a map marker — no synthesized positions. The map only
 * ever renders reported data.
 */

/** A train is considered in its running window this many ms before departure. */
export const DARK_GRACE_MS = 5 * 60 * 1000;

// --- Train-number decode ----------------------------------------------------

export interface TrainNumberInfo {
  /** Human branch/line label, e.g. "Rockport branch", "Haverhill". */
  branch: string;
  /** Best-guess CR route id from the number, or null if unrecognized. */
  routeId: string | null;
  /** Even = inbound (toward Boston), odd = outbound. */
  direction: 'inbound' | 'outbound';
  /** Weekday number + 5000 = weekend number. */
  weekend: boolean;
}

interface Branch {
  branch: string;
  routeId: string | null;
}

/**
 * Decode a CR timetable train number into line/branch and direction. The
 * hundreds block encodes the line; parity encodes direction; +5000 marks a
 * weekend number. Returns null for a non-numeric or empty name.
 */
export function decodeTrainNumber(name: string | null | undefined): TrainNumberInfo | null {
  if (!name) return null;
  const n = Number.parseInt(name, 10);
  if (!Number.isFinite(n)) return null;

  // Weekend numbers are the weekday number + 5000, so weekday 1..~2099 become
  // 5001..~7099. CapeFLYER's 9900-9999 block sits above that and is NOT a
  // weekend shift — exclude it so it decodes as CapeFLYER, not base 4900s.
  const weekend = n >= 5000 && n < 9900;
  const base = weekend ? n - 5000 : n;
  const { branch, routeId } = branchFor(base);
  return {
    branch,
    routeId,
    direction: base % 2 === 0 ? 'inbound' : 'outbound',
    weekend,
  };
}

/** Map a (weekend-normalized) number to its line/branch. */
function branchFor(base: number): Branch {
  // Four-digit blocks first — they'd otherwise fall through the hundreds switch.
  if (base >= 9900 && base <= 9999) return { branch: 'CapeFLYER', routeId: 'CapeFlyer' };
  if (base >= 1900 && base <= 2099) return { branch: 'New Bedford branch', routeId: 'CR-NewBedford' };
  if (base >= 1600 && base <= 1699) return { branch: 'Fairmount', routeId: 'CR-Fairmount' };
  if (base >= 1050 && base <= 1099) return { branch: 'Greenbush', routeId: 'CR-Greenbush' };
  if (base >= 1000 && base <= 1049) return { branch: 'Kingston', routeId: 'CR-Kingston' };

  switch (Math.floor(base / 100)) {
    case 0:
      return { branch: 'Rockport branch', routeId: 'CR-Newburyport' };
    case 1:
      return { branch: 'Newburyport branch', routeId: 'CR-Newburyport' };
    case 2:
      return { branch: 'Haverhill', routeId: 'CR-Haverhill' };
    case 3:
      return { branch: 'Lowell', routeId: 'CR-Lowell' };
    case 4:
      return { branch: 'Fitchburg', routeId: 'CR-Fitchburg' };
    case 5:
      return { branch: 'Worcester', routeId: 'CR-Worcester' };
    case 6:
      return { branch: 'Needham', routeId: 'CR-Needham' };
    case 7:
      return { branch: 'Franklin', routeId: 'CR-Franklin' };
    case 8:
      return { branch: 'Providence', routeId: 'CR-Providence' };
    case 9:
      return { branch: 'Stoughton', routeId: 'CR-Providence' };
    default:
      return { branch: 'Unknown', routeId: null };
  }
}

// --- Detection --------------------------------------------------------------

export interface DarkTrip {
  tripId: string;
  trainNumber: string | null;
  /** Route id: the scheduled route, else the number-decoded guess. */
  routeId: string | null;
  headsign: string | null;
  /** How long the trip has been running untracked (now - first departure). */
  darkMs: number;
  info: TrainNumberInfo | null;
  /** The next few scheduled stops from now. */
  nextStops: ScheduledStop[];
}

/**
 * The scheduled trips that are running but untracked, right now. A trip is dark
 * when (a) now is within [first departure - grace, last arrival] and (b) no live
 * vehicle's trip id matches it. A zombie vehicle sitting on a stale trip id
 * counts as tracking that trip (acceptable) — it's simply present in
 * liveTripIds. Sorted longest-dark first.
 */
export function detectNotTracking(
  trips: ScheduledTrip[],
  liveTripIds: ReadonlySet<string>,
  nowMs: number,
  graceMs: number = DARK_GRACE_MS,
): DarkTrip[] {
  const out: DarkTrip[] = [];
  for (const trip of trips) {
    const windowStart = trip.firstDepartureMs - graceMs;
    if (nowMs < windowStart || nowMs > trip.lastArrivalMs) continue; // not in its running window
    if (liveTripIds.has(trip.tripId)) continue; // tracked (a zombie counts here)

    const info = decodeTrainNumber(trip.trainNumber);
    out.push({
      tripId: trip.tripId,
      trainNumber: trip.trainNumber,
      routeId: trip.routeId ?? info?.routeId ?? null,
      headsign: trip.headsign,
      darkMs: nowMs - trip.firstDepartureMs,
      info,
      nextStops: upcomingStops(trip.stops, nowMs),
    });
  }
  out.sort((a, b) => b.darkMs - a.darkMs);
  return out;
}

/** The next 2-3 scheduled stops from now (a small grace keeps the current one). */
function upcomingStops(stops: ScheduledStop[], nowMs: number): ScheduledStop[] {
  return stops.filter((s) => s.timeMs >= nowMs - 60_000).slice(0, 3);
}

/** The set of trip ids the live feed is currently reporting. */
export function liveTripIdSet(trains: { tripId?: string | null }[]): Set<string> {
  const set = new Set<string>();
  for (const t of trains) if (t.tripId) set.add(t.tripId);
  return set;
}

// --- Display ----------------------------------------------------------------

/** "dark for 22 min" / "dark for 1h 5m" / "dark for 8d 3h"; "due" before departure. */
export function darkLabel(darkMs: number): string {
  if (darkMs <= 0) return 'due';
  const min = Math.floor(darkMs / 60_000);
  if (min < 60) return `dark for ${min} min`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `dark for ${hrs}h ${min % 60}m`;
  const days = Math.floor(hrs / 24);
  return `dark for ${days}d ${hrs % 24}h`;
}
