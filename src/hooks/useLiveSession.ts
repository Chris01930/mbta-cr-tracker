import { useEffect, useRef } from 'react';
import { AppState as RNAppState } from 'react-native';
import { CONFIG } from '../config';
import { getConfig, useConfigStore } from '../config/configStore';
import { pollVehicles } from '../api/mbta';
import { openVehicleStream, type VehicleStreamHandle } from '../api/mbtaStream';
import { latestFrame, loadDayFrames } from '../api/frames';
import { easternDateKey } from '../lib/time';
import { useStore } from '../state/store';
import type { Frame, Train } from '../types';

/**
 * Live-mode session driver.
 *
 * 1. Seed once from today's frames file (fast first paint) — the archive is
 *    never re-fetched on a timer.
 * 2. Source of truth: the SSE stream when config supplies a streaming key,
 *    otherwise a 60s keyless REST poll. Both feed the same store contract.
 * 3. Watchdog every 15s: with the stream up, >60s of silence triggers one REST
 *    poll as a fallback (which flips the heartbeat to amber); >120s without any
 *    data marks the session stale (red).
 *
 * Which path runs is decided per config load, so streaming can be switched on
 * or off remotely — no app update, and no key ever lives in the binary.
 */
export function useLiveSession(): void {
  const mode = useStore((s) => s.mode);
  // Read reactively, not via IS_STREAMING_ENABLED(): the app launches on the
  // vendored (keyless) config, so the key arrives a moment later when the live
  // fetch lands. This re-runs the effect and upgrades polling -> streaming, and
  // would likewise fall back if the key were ever removed remotely.
  const streaming = useConfigStore((s) => s.config.mobileStreamKey.length > 0);
  const setTrains = useStore((s) => s.setTrains);
  const seedFrom = useStore((s) => s.seedFrom);
  const setTodayFrames = useStore((s) => s.setTodayFrames);
  const commitFrame = useStore((s) => s.commitFrame);
  const markStale = useStore((s) => s.markStale);

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchdog = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const stream = useRef<VehicleStreamHandle | null>(null);
  const lastCommitMs = useRef(0);

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
        // No frames yet today (403) or offline — the live source will populate.
      }
    }

    /**
     * Commit a frame at most once per frame_commit_interval_sec. Polling is
     * already slower than that, but the stream emits continuously and would
     * otherwise blow through the capped session history in seconds.
     */
    function maybeCommit(trains: Train[]) {
      const now = Date.now();
      if (now - lastCommitMs.current < getConfig().live.frameCommitIntervalMs) return;
      lastCommitMs.current = now;
      commitFrame(toFrame(trains));
    }

    async function poll() {
      inFlight.current?.abort();
      const ctrl = new AbortController();
      inFlight.current = ctrl;
      try {
        const trains = await pollVehicles(ctrl.signal);
        if (cancelled) return;
        setTrains(trains, 'poll');
        maybeCommit(trains);
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        // Leave the heartbeat to the watchdog; a single failed poll is expected.
      }
    }

    function tickWatchdog() {
      const { lastDataMs } = useStore.getState();
      if (lastDataMs == null) return;
      const silentFor = Date.now() - lastDataMs;
      const live = getConfig().live;
      if (silentFor > live.staleAfterMs) markStale();
      // Stream gone quiet: fall back to a single poll (keeps data flowing and
      // shows amber). The polling path has its own timer and needs no nudge.
      else if (streaming && silentFor > live.streamWatchdogMs) void poll();
    }

    seed();

    if (streaming) {
      stream.current = openVehicleStream({
        onTrains: (trains) => {
          if (cancelled) return;
          setTrains(trains, 'stream');
          maybeCommit(trains);
        },
      });
    } else {
      poll();
      pollTimer.current = setInterval(poll, getConfig().live.pollIntervalMs);
    }

    watchdog.current = setInterval(tickWatchdog, 15_000);

    // Refresh immediately when the app returns to the foreground. The stream is
    // torn down by the OS while backgrounded, so reopen rather than poll.
    const sub = RNAppState.addEventListener('change', (state) => {
      if (state !== 'active' || cancelled) return;
      if (!streaming) void poll();
    });

    return () => {
      cancelled = true;
      inFlight.current?.abort();
      stream.current?.close();
      stream.current = null;
      if (pollTimer.current) clearInterval(pollTimer.current);
      if (watchdog.current) clearInterval(watchdog.current);
      sub.remove();
    };
  }, [mode, streaming, setTrains, seedFrom, setTodayFrames, commitFrame, markStale]);
}

/** Build a frame from a live update, keyed by current Eastern HHMMSS. */
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
