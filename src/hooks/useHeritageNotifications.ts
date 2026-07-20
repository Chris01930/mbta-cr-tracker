import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { heritageName } from '../constants/heritage';
import { routeName } from '../constants/routes';
import { heritageMessage, heritageSightings, newHeritageArrivals } from '../lib/heritageWatch';
import { ensureNotifyPermission, presentNotification } from '../lib/notify';

/**
 * Fires a local notification when a heritage locomotive newly appears in the
 * live feed. "New" is per live session: the first live poll after entering live
 * mode is a silent baseline (locos already out don't alert), and each cab is
 * announced at most once until the user leaves and re-enters live mode.
 *
 * Only active in live mode — history scrubbing never notifies. Requests
 * notification permission lazily the first time there's anything to announce.
 */
export function useHeritageNotifications(): void {
  const mode = useStore((s) => s.mode);
  const trains = useStore((s) => s.trains);
  const heritage = useStore((s) => s.heritage);

  const seen = useRef<Set<string>>(new Set());
  const baselined = useRef(false);

  // Reset the session baseline whenever we leave live mode.
  useEffect(() => {
    if (mode !== 'live') {
      seen.current = new Set();
      baselined.current = false;
    }
  }, [mode]);

  useEffect(() => {
    if (mode !== 'live') return;
    const sightings = heritageSightings(trains, heritage);

    // First live pass: record what's already out, announce nothing.
    if (!baselined.current) {
      baselined.current = true;
      for (const s of sightings) seen.current.add(s.cab);
      return;
    }

    const arrivals = newHeritageArrivals(sightings, seen.current);
    if (arrivals.length === 0) return;
    for (const s of arrivals) seen.current.add(s.cab);

    void (async () => {
      if (!(await ensureNotifyPermission())) return;
      for (const s of arrivals) {
        const { title, body } = heritageMessage(heritageName(s.unit), routeName(s.route), s.dest);
        await presentNotification(title, body);
      }
    })();
  }, [mode, trains, heritage]);
}
