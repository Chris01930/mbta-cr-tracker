import { streamKey } from '../config';
import { getConfig } from '../config/configStore';
import type { Train, VehicleStatus } from '../types';

/**
 * MBTA v3 API client (the live plane): REST polling, predictions, schedules and
 * trip lookups. All responses are JSON:API. Streaming lives in mbtaStream.ts.
 *
 * Every base URL is built from `endpoints.mbta_api` in runtime config and every
 * route filter from `routes[]`, so repointing the app at a proxy is a config
 * edit — no host or route id is written down in this file.
 */

// --- JSON:API minimal shapes ------------------------------------------------

export interface JsonApiResource<A = Record<string, unknown>> {
  id: string;
  type: string;
  attributes?: A;
  relationships?: Record<string, { data?: { id: string; type: string } | null }>;
}

export interface JsonApiDoc {
  data?: JsonApiResource[] | JsonApiResource;
  included?: JsonApiResource[];
}

interface VehicleAttrs {
  label: string | null;
  latitude: number | null;
  longitude: number | null;
  bearing: number | null;
  speed: number | null; // meters/second
  current_status: VehicleStatus | null;
  updated_at: string | null;
  revenue?: string | null; // "REVENUE" | "NON_REVENUE" (may be absent)
}

interface TripAttrs {
  name: string | null;
  headsign: string | null;
}

// --- URL helpers ------------------------------------------------------------

/**
 * Attach the config-supplied key when there is one. These endpoints all work
 * keyless; the key just raises the rate limit from ~20/min to 1,000/min.
 */
function withKey(url: URL): URL {
  const key = streamKey();
  if (key) url.searchParams.set('api_key', key);
  return url;
}

function u(path: string): URL {
  return new URL(getConfig().mbtaApi + path);
}

// --- Vehicles (live positions) ---------------------------------------------

/**
 * One poll of all CR vehicles with trip includes, normalized to Train[].
 * Keyless is fine at one poll per 60s per client (the intended cadence).
 */
export async function pollVehicles(signal?: AbortSignal): Promise<Train[]> {
  const url = u('/vehicles');
  url.searchParams.set('filter[route]', getConfig().routeFilter);
  url.searchParams.set('include', 'trip');
  withKey(url);

  const res = await fetch(url.toString(), {
    signal,
    headers: { Accept: 'application/vnd.api+json' },
  });
  if (!res.ok) throw new Error(`vehicles: HTTP ${res.status}`);
  const doc = (await res.json()) as JsonApiDoc;
  return normalizeVehicles(doc);
}

export function normalizeVehicles(doc: JsonApiDoc): Train[] {
  const trips = new Map<string, TripAttrs>();
  for (const inc of doc.included ?? []) {
    if (inc.type === 'trip') trips.set(inc.id, (inc.attributes as unknown as TripAttrs) ?? {});
  }
  const list = Array.isArray(doc.data) ? doc.data : doc.data ? [doc.data] : [];
  const out: Train[] = [];
  for (const v of list) {
    if (v.type !== 'vehicle') continue;
    const a = (v.attributes as unknown as VehicleAttrs) ?? ({} as VehicleAttrs);
    if (a.latitude == null || a.longitude == null) continue; // no position -> not plottable
    const tripId = v.relationships?.trip?.data?.id ?? null;
    const routeId = v.relationships?.route?.data?.id ?? null;
    const trip = tripId ? trips.get(tripId) : undefined;
    const cab = a.label ?? null;
    out.push({
      cab,
      train: trip?.name ?? null,
      dest: trip?.headsign ?? null,
      route: routeId,
      status: a.current_status ?? null,
      lat: a.latitude,
      lon: a.longitude,
      brg: a.bearing ?? null,
      upd: a.updated_at ?? null,
      isNonRevenue: a.revenue === 'NON_REVENUE',
      isGhost: cab == null,
      vid: v.id, // resource id — tracking key for ghosts
      tripId,
      spd: a.speed ?? null,
    });
  }
  return out;
}

// --- Predictions (next stops per train) ------------------------------------

export interface PredictionRow {
  tripId: string;
  stopName: string;
  stopSequence: number;
  /** arrival_time || departure_time (ISO). */
  time: string;
}

/**
 * One bulk predictions request for the given trip ids, on explicit user
 * refresh only (never auto-poll). Rows are grouped by trip, sorted by
 * stop_sequence, past stops filtered client-side by the caller.
 */
export async function loadPredictions(
  tripIds: string[],
  signal?: AbortSignal,
): Promise<Map<string, PredictionRow[]>> {
  const ids = tripIds.filter(Boolean);
  const grouped = new Map<string, PredictionRow[]>();
  if (ids.length === 0) return grouped;

  const url = u('/predictions');
  url.searchParams.set('filter[trip]', ids.join(','));
  url.searchParams.set('include', 'stop');
  url.searchParams.set('fields[prediction]', 'arrival_time,departure_time,stop_sequence');
  url.searchParams.set('fields[stop]', 'name');
  withKey(url);

  const res = await fetch(url.toString(), { signal, headers: { Accept: 'application/vnd.api+json' } });
  if (!res.ok) throw new Error(`predictions: HTTP ${res.status}`);
  const doc = (await res.json()) as JsonApiDoc;

  const stopNames = new Map<string, string>();
  for (const inc of doc.included ?? []) {
    if (inc.type === 'stop') stopNames.set(inc.id, (inc.attributes?.name as string) ?? inc.id);
  }
  const list = Array.isArray(doc.data) ? doc.data : [];
  for (const p of list) {
    const a = p.attributes ?? {};
    const time = (a.arrival_time as string) || (a.departure_time as string);
    if (!time) continue; // drop rows with neither
    const tripId = p.relationships?.trip?.data?.id;
    const stopId = p.relationships?.stop?.data?.id;
    if (!tripId) continue;
    const row: PredictionRow = {
      tripId,
      stopName: stopId ? stopNames.get(stopId) ?? stopId : '—',
      stopSequence: (a.stop_sequence as number) ?? 0,
      time,
    };
    const arr = grouped.get(tripId) ?? [];
    arr.push(row);
    grouped.set(tripId, arr);
  }
  for (const arr of grouped.values()) arr.sort((x, y) => x.stopSequence - y.stopSequence);
  return grouped;
}

// --- Trip lookup (lazy, for stream cache misses) ---------------------------

export async function loadTrip(tripId: string, signal?: AbortSignal): Promise<TripAttrs | null> {
  const url = u(`/trips/${encodeURIComponent(tripId)}`);
  withKey(url);
  const res = await fetch(url.toString(), { signal, headers: { Accept: 'application/vnd.api+json' } });
  if (!res.ok) return null;
  const doc = (await res.json()) as JsonApiDoc;
  const r = Array.isArray(doc.data) ? doc.data[0] : doc.data;
  return (r?.attributes as unknown as TripAttrs) ?? null;
}

// --- Station resolution + schedules ----------------------------------------

export interface StationRef {
  /** parent_station id (fallback: stop id), e.g. place-WML-0214. */
  id: string;
  name: string;
}

/** Resolve the nearest CR stop to a coordinate, returning its parent station. */
export async function resolveStation(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<StationRef | null> {
  const url = u('/stops');
  url.searchParams.set('filter[route_type]', '2');
  url.searchParams.set('filter[latitude]', String(lat));
  url.searchParams.set('filter[longitude]', String(lng));
  url.searchParams.set('filter[radius]', '0.02');
  url.searchParams.set('sort', 'distance');
  url.searchParams.set('page[limit]', '1');
  withKey(url);

  const res = await fetch(url.toString(), { signal, headers: { Accept: 'application/vnd.api+json' } });
  if (!res.ok) throw new Error(`stops: HTTP ${res.status}`);
  const doc = (await res.json()) as JsonApiDoc;
  const stop = Array.isArray(doc.data) ? doc.data[0] : doc.data;
  if (!stop) return null;
  const parent = stop.relationships?.parent_station?.data?.id;
  return {
    id: parent ?? stop.id,
    name: (stop.attributes?.name as string) ?? stop.id,
  };
}

export interface ScheduleRow {
  tripName: string | null;
  headsign: string | null;
  /** arrival_time || departure_time (ISO). */
  time: string;
  /** MBTA direction_id: 0 = Outbound (from Boston), 1 = Inbound (to Boston). */
  directionId: number | null;
}

/** Today's timetable at a station (parent id). Cache ~10 min per station. */
export async function loadSchedules(
  stationId: string,
  signal?: AbortSignal,
): Promise<ScheduleRow[]> {
  const url = u('/schedules');
  url.searchParams.set('filter[stop]', stationId);
  url.searchParams.set('filter[route]', getConfig().routeFilter);
  url.searchParams.set('include', 'trip');
  url.searchParams.set('fields[schedule]', 'arrival_time,departure_time,direction_id');
  url.searchParams.set('fields[trip]', 'name,headsign');
  withKey(url);

  const res = await fetch(url.toString(), { signal, headers: { Accept: 'application/vnd.api+json' } });
  if (!res.ok) throw new Error(`schedules: HTTP ${res.status}`);
  const doc = (await res.json()) as JsonApiDoc;

  const trips = new Map<string, TripAttrs>();
  for (const inc of doc.included ?? []) {
    if (inc.type === 'trip') trips.set(inc.id, (inc.attributes as unknown as TripAttrs) ?? {});
  }
  const list = Array.isArray(doc.data) ? doc.data : [];
  const out: ScheduleRow[] = [];
  for (const s of list) {
    const a = s.attributes ?? {};
    const time = (a.arrival_time as string) || (a.departure_time as string);
    if (!time) continue;
    const tripId = s.relationships?.trip?.data?.id;
    const trip = tripId ? trips.get(tripId) : undefined;
    out.push({
      tripName: trip?.name ?? null,
      headsign: trip?.headsign ?? null,
      time,
      directionId: typeof a.direction_id === 'number' ? (a.direction_id as number) : null,
    });
  }
  out.sort((x, y) => x.time.localeCompare(y.time));
  return out;
}

// --- Route-wide scheduled trips (for "not tracking" detection) --------------

/** One scheduled stop on a trip: name + the time it's due (arrival||departure). */
export interface ScheduledStop {
  name: string;
  timeMs: number;
}

/**
 * A scheduled trip for the whole service day, aggregated from its per-stop
 * schedule rows. Used to detect trips that are running but absent from the live
 * vehicle feed ("dark" / not tracking) — the feed can't show them, but the
 * schedule shows their absence.
 */
export interface ScheduledTrip {
  tripId: string;
  trainNumber: string | null; // trip name = timetable train number
  routeId: string | null;
  headsign: string | null;
  directionId: number | null;
  /** Earliest departure across the trip (falls back to earliest arrival). */
  firstDepartureMs: number;
  /** Latest arrival across the trip (falls back to latest departure). */
  lastArrivalMs: number;
  /** Every scheduled stop, ordered by time. */
  stops: ScheduledStop[];
}

interface ScheduledTripAttrs extends TripAttrs {
  direction_id?: number | null;
}

/**
 * Today's scheduled trips across the config route list. One heavy call per
 * service day (cache it — see getScheduledTrips): the payload spans every CR
 * trip's stops. The query mirrors the doc's schedule pattern, adding
 * include=stop + fields[stop]=name so each row's stop can be named for the
 * "next stops" preview; direction_id comes from the trip.
 */
export async function loadScheduledTrips(signal?: AbortSignal): Promise<ScheduledTrip[]> {
  const url = u('/schedules');
  url.searchParams.set('filter[route]', getConfig().routeFilter);
  url.searchParams.set('include', 'trip,stop');
  url.searchParams.set('fields[schedule]', 'arrival_time,departure_time');
  url.searchParams.set('fields[trip]', 'name,headsign,direction_id');
  url.searchParams.set('fields[stop]', 'name');
  withKey(url);

  const res = await fetch(url.toString(), { signal, headers: { Accept: 'application/vnd.api+json' } });
  if (!res.ok) throw new Error(`schedules(route): HTTP ${res.status}`);
  const doc = (await res.json()) as JsonApiDoc;

  const trips = new Map<string, ScheduledTripAttrs>();
  const stopNames = new Map<string, string>();
  for (const inc of doc.included ?? []) {
    if (inc.type === 'trip') trips.set(inc.id, (inc.attributes as unknown as ScheduledTripAttrs) ?? {});
    else if (inc.type === 'stop') stopNames.set(inc.id, (inc.attributes?.name as string) ?? inc.id);
  }

  // Accumulate per trip: extreme times + the ordered stop list.
  interface Acc {
    routeId: string | null;
    firstDepartureMs: number;
    lastArrivalMs: number;
    stops: ScheduledStop[];
  }
  const byTrip = new Map<string, Acc>();
  const list = Array.isArray(doc.data) ? doc.data : [];
  for (const s of list) {
    const tripId = s.relationships?.trip?.data?.id;
    if (!tripId) continue;
    const a = s.attributes ?? {};
    const arr = a.arrival_time ? Date.parse(a.arrival_time as string) : NaN;
    const dep = a.departure_time ? Date.parse(a.departure_time as string) : NaN;
    // Departure represents "leaving this stop"; arrival "reaching" it. Use the
    // one present, preferring departure for the trip start and arrival for end.
    const depOrArr = Number.isNaN(dep) ? arr : dep;
    const arrOrDep = Number.isNaN(arr) ? dep : arr;
    if (Number.isNaN(depOrArr) && Number.isNaN(arrOrDep)) continue; // unscheduled row

    let acc = byTrip.get(tripId);
    if (!acc) {
      acc = { routeId: null, firstDepartureMs: Infinity, lastArrivalMs: -Infinity, stops: [] };
      byTrip.set(tripId, acc);
    }
    if (!acc.routeId) acc.routeId = s.relationships?.route?.data?.id ?? null;
    if (!Number.isNaN(depOrArr)) acc.firstDepartureMs = Math.min(acc.firstDepartureMs, depOrArr);
    if (!Number.isNaN(arrOrDep)) acc.lastArrivalMs = Math.max(acc.lastArrivalMs, arrOrDep);

    const stopId = s.relationships?.stop?.data?.id;
    const stopTime = Number.isNaN(arrOrDep) ? depOrArr : arrOrDep;
    if (stopId && !Number.isNaN(stopTime)) {
      acc.stops.push({ name: stopNames.get(stopId) ?? stopId, timeMs: stopTime });
    }
  }

  const out: ScheduledTrip[] = [];
  for (const [tripId, acc] of byTrip) {
    if (!Number.isFinite(acc.firstDepartureMs) || !Number.isFinite(acc.lastArrivalMs)) continue;
    const trip = trips.get(tripId);
    acc.stops.sort((x, y) => x.timeMs - y.timeMs);
    out.push({
      tripId,
      trainNumber: trip?.name ?? null,
      routeId: acc.routeId,
      headsign: trip?.headsign ?? null,
      directionId: typeof trip?.direction_id === 'number' ? trip.direction_id : null,
      firstDepartureMs: acc.firstDepartureMs,
      lastArrivalMs: acc.lastArrivalMs,
      stops: acc.stops,
    });
  }
  return out;
}

/**
 * Scheduled trips for a service day, fetched at most once per day. Concurrent
 * callers share the in-flight request; a new day refetches. Kept in memory
 * (not persisted) — a restart re-fetching today's schedule once is acceptable.
 */
let scheduleCache: { day: string; trips: ScheduledTrip[] } | null = null;
let scheduleInflight: { day: string; promise: Promise<ScheduledTrip[]> } | null = null;

export async function getScheduledTrips(day: string, signal?: AbortSignal): Promise<ScheduledTrip[]> {
  if (scheduleCache?.day === day) return scheduleCache.trips;
  if (scheduleInflight?.day === day) return scheduleInflight.promise;
  const promise = loadScheduledTrips(signal)
    .then((trips) => {
      scheduleCache = { day, trips };
      scheduleInflight = null;
      return trips;
    })
    .catch((err) => {
      scheduleInflight = null;
      throw err;
    });
  scheduleInflight = { day, promise };
  return promise;
}

/** Test-only: clear the per-day schedule cache. */
export function resetScheduleCache(): void {
  scheduleCache = null;
  scheduleInflight = null;
}

/** meters/second -> mph. */
export function msToMph(spd: number | null | undefined): number | null {
  if (spd == null) return null;
  return spd * 2.23694;
}
