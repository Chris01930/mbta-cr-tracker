import { useEffect, useRef } from 'react';
import { useConfigStore } from '../config/configStore';
import { getScheduledTrips, type ScheduledTrip } from '../api/mbta';
import { detectNotTracking, liveTripIdSet } from '../lib/notTracking';
import { easternDateKey } from '../lib/time';
import { useStore } from '../state/store';

/**
 * Drives the "not tracking" (dark train) list.
 *
 * Once per service day it fetches the scheduled trips for the config route list
 * (cached in the API layer). Then on every live-data update it recomputes which
 * scheduled trips are inside their running window yet absent from the live
 * feed, and writes the result to the store for the badge + list to render.
 *
 * Live mode only: "dark" is a statement about now. In playback the list is
 * cleared — history is what the feed reported, and absence isn't reconstructed.
 */
export function useNotTracking(): void {
  const mode = useStore((s) => s.mode);
  const trains = useStore((s) => s.trains);
  const setNotTracking = useStore((s) => s.setNotTracking);
  // Re-fetch if the route list changes under us (remote config update).
  const routeFilter = useConfigStore((s) => s.config.routeFilter);

  const scheduleRef = useRef<ScheduledTrip[] | null>(null);
  const loadedDay = useRef<string | null>(null);

  useEffect(() => {
    if (mode !== 'live') {
      setNotTracking([]);
      return;
    }

    let cancelled = false;

    const recompute = () => {
      const trips = scheduleRef.current;
      if (!trips) return;
      const live = liveTripIdSet(useStore.getState().trains);
      setNotTracking(detectNotTracking(trips, live, Date.now()));
    };

    (async () => {
      const day = easternDateKey();
      if (loadedDay.current !== day || !scheduleRef.current) {
        try {
          const trips = await getScheduledTrips(day);
          if (cancelled) return;
          scheduleRef.current = trips;
          loadedDay.current = day;
        } catch {
          // No schedule (offline / rate-limited) — nothing to compare against.
          return;
        }
      }
      if (!cancelled) recompute();
    })();

    return () => {
      cancelled = true;
    };
    // `trains` is a dependency so detection recomputes on every live update;
    // routeFilter so a route-list change refetches the day's schedule.
  }, [mode, trains, routeFilter, setNotTracking]);
}
