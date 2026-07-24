import { normalizeVehicles, type JsonApiResource } from './mbta';
import type { SseMessage } from '../lib/sse';
import type { Train } from '../types';

/**
 * The SSE vehicle stream's state machine, kept pure so the event semantics are
 * testable without a socket.
 *
 * Per the MBTA v3 streaming contract: `reset` carries a full array (with the
 * included trip resources mixed into it — cache them by id), then `add` /
 * `update` / `remove` each carry a single resource. Only vehicle resources
 * stream after reset, but trips are accepted at any point defensively.
 *
 * The rendered Train[] is produced by the same normalizeVehicles() the polling
 * path uses, so streamed and polled vehicles cannot drift apart.
 */

export interface StreamState {
  vehicles: Map<string, JsonApiResource>;
  /** trip id -> trip resource, accumulated across reset + lazy /trips fetches. */
  trips: Map<string, JsonApiResource>;
}

export function createStreamState(): StreamState {
  return { vehicles: new Map(), trips: new Map() };
}

export interface ApplyResult {
  /** Whether the rendered train set could have changed. */
  changed: boolean;
  /** Trip ids referenced by a vehicle but absent from the cache. */
  missingTripIds: string[];
}

export function applyStreamMessage(state: StreamState, msg: SseMessage): ApplyResult {
  let payload: unknown;
  try {
    payload = JSON.parse(msg.data);
  } catch {
    return { changed: false, missingTripIds: [] }; // ignore malformed frames
  }

  let changed = false;

  switch (msg.event) {
    case 'reset': {
      // Full replacement of the vehicle set. Trips accumulate rather than reset:
      // a reconnect shouldn't discard names we already resolved.
      const list = Array.isArray(payload) ? (payload as JsonApiResource[]) : [];
      state.vehicles.clear();
      for (const r of list) put(state, r);
      changed = true;
      break;
    }
    case 'add':
    case 'update': {
      const r = payload as JsonApiResource | null;
      if (r?.id) changed = put(state, r);
      break;
    }
    case 'remove': {
      const r = payload as JsonApiResource | null;
      if (r?.id && state.vehicles.delete(r.id)) changed = true;
      break;
    }
    default:
      break; // unknown event types are ignored, not fatal
  }

  return { changed, missingTripIds: changed ? missingTrips(state) : [] };
}

function put(state: StreamState, r: JsonApiResource): boolean {
  if (!r?.id) return false;
  if (r.type === 'trip') {
    state.trips.set(r.id, r);
    // A newly-known trip renames vehicles already on screen.
    return true;
  }
  if (r.type === 'vehicle') {
    state.vehicles.set(r.id, r);
    return true;
  }
  return false;
}

/** Cache a trip resolved lazily via GET /trips/{id}. */
export function cacheTrip(state: StreamState, id: string, attributes: Record<string, unknown>): void {
  state.trips.set(id, { id, type: 'trip', attributes });
}

function missingTrips(state: StreamState): string[] {
  const missing = new Set<string>();
  for (const v of state.vehicles.values()) {
    const tripId = v.relationships?.trip?.data?.id;
    if (tripId && !state.trips.has(tripId)) missing.add(tripId);
  }
  return [...missing];
}

/** Render the current state through the shared vehicle normalizer. */
export function streamTrains(state: StreamState): Train[] {
  return normalizeVehicles({
    data: [...state.vehicles.values()],
    included: [...state.trips.values()],
  });
}
