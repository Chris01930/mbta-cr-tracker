import { useEffect, useRef } from 'react';
import { AppState as RNAppState } from 'react-native';
import { CONFIG } from '../config';
import { getConfig } from '../config/configStore';
import { pollVehicles } from '../api/mbta';
import { latestFrame, loadDayFrames } from '../api/frames';
import { easternDateKey } from '../lib/time';
import { useStore } from '../state/store';
import type { Frame, Train } from '../types';

/**
 * Live-mode session driver for the polling-only MVP.
 *
 * 1. Seed once from today's frames file (fast first paint) — archive is never
 *    re-fetched on a timer.
 * 2. Poll /vehicles every 60s (keyless cadence); each poll becomes the source
 *    of truth and is committed as a frame for scrub/trails.
 * 3. Watchdog every 15s marks the session stale after >120s without data.
 *
 * When a streaming key is added later, this is the place to swap the poll loop
 * for an SSE connection; the store contract stays identical.
 */
export function useLivePolling(): void {
  const mode = useStore((s) => s.mode);
  const setTrains = useStore((s) => s.setTrains);
  const seedFrom = useStore((s) => s.seedFrom);
  const setTodayFrames = useStore((s) => s.setTodayFrames);
  const commitFrame = useStore((s) => s.commitFrame);
  const markStale = useStore((s) => s.markStale);

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchdog = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => {
    // Pause the live session while scrubbing history (respects rate limits).
    if (mode !== 'live') return;

    let cancelled = false;

    async function seed() {
      try {
        const date = easternDateKey();
        const day = await loadDayFrames(date);
        if (cancelled) return;
        // Keep today's whole archive (midnight -> now) so live-mode features can
        // look back across the full day, not just this session.
        setTodayFrames(day.frames);
        const frame = latestFrame(day);
        if (frame) seedFrom(frame.trains, frame.key);
      } catch {
        // No frames yet today (403) or offline — polling will populate.
      }
    }

    async function poll() {
      inFlight.current?.abort();
      const ctrl = new AbortController();
      inFlight.current = ctrl;
      try {
        const trains = await pollVehicles(ctrl.signal);
        if (cancelled) return;
        setTrains(trains, 'poll');
        commitFrame(toFrame(trains));
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        // Leave heartbeat to the watchdog; a single failed poll is expected.
      }
    }

    function tickWatchdog() {
      const { lastDataMs } = useStore.getState();
      if (lastDataMs == null) return;
      if (Date.now() - lastDataMs > getConfig().live.staleAfterMs) markStale();
    }

    seed();
    poll();
    pollTimer.current = setInterval(poll, getConfig().live.pollIntervalMs);
    watchdog.current = setInterval(tickWatchdog, 15_000);

    // Poll immediately when the app returns to the foreground.
    const sub = RNAppState.addEventListener('change', (state) => {
      if (state === 'active') poll();
    });

    return () => {
      cancelled = true;
      inFlight.current?.abort();
      if (pollTimer.current) clearInterval(pollTimer.current);
      if (watchdog.current) clearInterval(watchdog.current);
      sub.remove();
    };
  }, [mode, setTrains, seedFrom, setTodayFrames, commitFrame, markStale]);
}

/** Build a frame from a live poll, keyed by current Eastern HHMMSS. */
function toFrame(trains: Train[]): Frame {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CONFIG.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .format(now)
    .replace(/:/g, '');
  return { key: parts, time: now.toISOString(), trains };
}
