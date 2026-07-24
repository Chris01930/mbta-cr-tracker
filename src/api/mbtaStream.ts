import { streamKey } from '../config';
import { getConfig } from '../config/configStore';
import { createSseParser } from '../lib/sse';
import { loadTrip } from './mbta';
import { applyStreamMessage, cacheTrip, createStreamState, streamTrains } from './vehicleStream';
import type { Train } from '../types';

/**
 * SSE connection to the MBTA v3 vehicle stream (the primary live source when
 * config supplies a streaming key).
 *
 * Transport is XMLHttpRequest, not fetch or EventSource: React Native has no
 * EventSource, and its fetch never exposes a readable body. RN's XHR does
 * deliver partial `responseText` at readyState LOADING — but ONLY if a
 * 'readystatechange' listener is attached via addEventListener, which is what
 * flips its internal incremental-events flag. Assigning onreadystatechange
 * instead yields one final blob at completion, i.e. no streaming at all.
 *
 * `responseText` accumulates the entire response for the life of the request,
 * so we read forward from an offset (never re-scanning) and recycle the
 * connection once the buffer passes RECYCLE_BYTES — otherwise an all-day
 * session would grow unboundedly in memory.
 *
 * Everything about the URL — host and route filter alike — comes from runtime
 * config, so pointing the app at a proxy is a config edit with no code change.
 */

/** Reconnect backoff, capped. One connection per client (citizenship rule). */
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];
/** Recycle the connection once the accumulated response passes this size. */
const RECYCLE_BYTES = 4 * 1024 * 1024;

export interface VehicleStreamHandle {
  close(): void;
}

export interface VehicleStreamOptions {
  /** Called with the full train set whenever the stream changes it. */
  onTrains(trains: Train[]): void;
  /** Called on transport failure, before the reconnect backoff. */
  onError?(reason: string): void;
}

/** Build the stream URL from config: base, route filter, and key all remote. */
export function streamUrl(): string {
  const cfg = getConfig();
  const url = new URL(cfg.mbtaApi + '/vehicles');
  url.searchParams.set('filter[route]', cfg.routeFilter);
  url.searchParams.set('include', 'trip');
  url.searchParams.set('api_key', streamKey());
  return url.toString();
}

export function openVehicleStream(opts: VehicleStreamOptions): VehicleStreamHandle {
  let closed = false;
  let xhr: XMLHttpRequest | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;

  const state = createStreamState();
  // Trip ids already requested, so a vehicle on an unknown trip is fetched once
  // rather than on every subsequent event that still references it.
  const requestedTrips = new Set<string>();

  const emit = () => opts.onTrains(streamTrains(state));

  function resolveTrips(ids: string[]): void {
    for (const id of ids) {
      if (requestedTrips.has(id)) continue;
      requestedTrips.add(id);
      void loadTrip(id)
        .then((attrs) => {
          if (closed || !attrs) return;
          cacheTrip(state, id, attrs as unknown as Record<string, unknown>);
          emit(); // the vehicle gains its train number / headsign
        })
        .catch(() => {
          // Leave it unresolved; the vehicle still renders by cab label.
          requestedTrips.delete(id);
        });
    }
  }

  function scheduleReconnect(reason: string): void {
    if (closed) return;
    opts.onError?.(reason);
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    attempt += 1;
    retry = setTimeout(connect, delay);
  }

  function connect(): void {
    if (closed) return;

    const parser = createSseParser();
    let offset = 0;
    // abort() can synchronously re-enter readystatechange with DONE, so each
    // connection ends exactly once through settle(); later events are ignored.
    let settled = false;
    const req = new XMLHttpRequest();
    xhr = req;

    /** End this connection: `null` reason recycles, a string reconnects. */
    const settle = (reason: string | null) => {
      if (settled) return;
      settled = true;
      if (xhr === req) xhr = null;
      req.abort();
      if (closed) return;
      if (reason === null) {
        attempt = 0;
        connect();
      } else {
        scheduleReconnect(reason);
      }
    };

    req.open('GET', streamUrl());
    req.setRequestHeader('Accept', 'text/event-stream');

    // MUST be addEventListener: this is what enables incremental delivery.
    req.addEventListener('readystatechange', () => {
      if (closed || settled || req !== xhr) return;

      if (req.readyState === req.HEADERS_RECEIVED && req.status !== 0 && req.status !== 200) {
        // Never surface the URL in a reason — it carries the key.
        settle(`stream HTTP ${req.status}`);
        return;
      }

      if (req.readyState !== req.LOADING && req.readyState !== req.DONE) return;

      const text = req.responseText;
      if (text.length > offset) {
        const chunk = text.slice(offset);
        offset = text.length;
        attempt = 0; // data flowing again: reset backoff

        for (const msg of parser.feed(chunk)) {
          const { changed, missingTripIds } = applyStreamMessage(state, msg);
          if (changed) emit();
          if (missingTripIds.length) resolveTrips(missingTripIds);
        }
      }

      if (req.readyState === req.DONE) {
        settle('stream closed');
      } else if (offset > RECYCLE_BYTES) {
        // Drop and reopen to release the accumulated responseText. `reset` on
        // the new connection rebuilds the vehicle set from scratch.
        settle(null);
      }
    });

    req.addEventListener('error', () => {
      if (!closed && !settled && req === xhr) settle('stream error');
    });

    req.send();
  }

  connect();

  return {
    close(): void {
      closed = true;
      if (retry) clearTimeout(retry);
      xhr?.abort();
      xhr = null;
    },
  };
}
