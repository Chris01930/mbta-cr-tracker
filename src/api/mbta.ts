import { CONFIG, CR_ROUTE_FILTER, IS_STREAMING_ENABLED } from '../config';
import type { Train, VehicleStatus } from '../types';

/**
 * MBTA v3 API client (the live plane). Polling-only MVP: keyless REST at 60s.
 * All responses are JSON:API. When a key is configured, requests attach it and
 * the higher rate limit (1,000/min) applies.
 */

// --- JSON:API minimal shapes ------------------------------------------------

interface JsonApiResource<A = Record<string, unknown>> {
  id: string;
  type: string;
  attributes?: A;
  relationships?: Record<string, { data?: { id: string; type: string } | null }>;
}

interface JsonApiDoc {
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
}

interface TripAttrs {
  name: string | null;
  headsign: string | null;
}

// --- URL helpers ------------------------------------------------------------

function withKey(url: URL): URL {
  if (IS_STREAMING_ENABLED()) url.searchParams.set('api_key', CONFIG.mbtaApiKey);
  return url;
}

function u(path: string): URL {
  return new URL(CONFIG.mbtaBaseUrl + path);
}

// --- Vehicles (live positions) ---------------------------------------------

/**
 * One poll of all CR vehicles with trip includes, normalized to Train[].
 * Keyless is fine at one poll per 60s per client (the intended cadence).
 */
export async function pollVehicles(signal?: AbortSignal): Promise<Train[]> {
  const url = u('/vehicles');
  url.searchParams.set('filter[route]', CR_ROUTE_FILTER);
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

function normalizeVehicles(doc: JsonApiDoc): Train[] {
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
    out.push({
      cab: a.label ?? null,
      train: trip?.name ?? null,
      dest: trip?.headsign ?? null,
      route: routeId,
      status: a.current_status ?? null,
      lat: a.latitude,
      lon: a.longitude,
      brg: a.bearing ?? null,
      upd: a.updated_at ?? null,
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
  url.searchParams.set('filter[route]', CR_ROUTE_FILTER);
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

/** meters/second -> mph. */
export function msToMph(spd: number | null | undefined): number | null {
  if (spd == null) return null;
  return spd * 2.23694;
}
