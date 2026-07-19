import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { CONFIG } from '../config';
import { getConfig } from '../config/configStore';
import type { PredictionRow } from '../api/mbta';
import { plottableTrains } from '../api/frames';
import type { DayFrames, Frame, HeartbeatState, Train } from '../types';

export type AppMode = 'live' | 'playback';

/**
 * App state. The live-mode session model: seed once from today's frames file,
 * then polls (or, later, the stream) are the source of truth. Frame snapshots
 * are committed ~1/min into a capped history for scrub/trails.
 *
 * Heritage pairing is unit number -> cab label, persisted on-device (mirrors
 * the web app's localStorage key `crHeritage`).
 */

const HERITAGE_STORAGE_KEY = 'crHeritage';

/** unit number -> cab label */
export type HeritagePairs = Record<string, string>;

interface AppState {
  // Mode: live polling vs historical playback
  mode: AppMode;

  // Live data
  trains: Train[];
  frames: Frame[]; // capped history, newest last
  lastFrameKey: string | null;

  // Playback (historical archive scrub)
  playbackDate: string | null;
  playbackDay: DayFrames | null;
  playbackIndex: number;
  playbackPlaying: boolean;
  playbackSpeed: number;
  playbackLoading: boolean;
  playbackError: string | null;

  // Heartbeat / freshness
  heartbeat: HeartbeatState;
  lastDataMs: number | null;
  seeded: boolean;

  // Selection + inspect tap cycle (0=none,1=chip,2=details,3=stops)
  selectedCab: string | null;
  inspectStage: number;

  // Predictions (explicit refresh only)
  predictions: Record<string, PredictionRow[]>; // by tripId
  predictionsAsOf: number | null;
  predictionsLoading: boolean;

  // Heritage pairing
  heritage: HeritagePairs;

  // Freight/non-revenue trackage layer toggle
  showFreight: boolean;

  // Actions
  hydrateHeritage: () => Promise<void>;
  // Playback
  enterPlayback: (date: string, day: DayFrames) => void;
  setPlaybackLoading: (date: string) => void;
  setPlaybackError: (date: string, message: string) => void;
  exitToLive: () => void;
  setPlaybackIndex: (index: number) => void;
  stepPlayback: (delta: number) => void;
  setPlaybackPlaying: (playing: boolean) => void;
  setPlaybackSpeed: (speed: number) => void;
  setTrains: (trains: Train[], source: 'stream' | 'poll') => void;
  seedFrom: (trains: Train[], frameKey: string) => void;
  commitFrame: (frame: Frame) => void;
  markStale: () => void;
  selectCab: (cab: string | null) => void;
  cycleInspect: (cab: string) => void;
  setPredictions: (rows: Record<string, PredictionRow[]>) => void;
  setPredictionsLoading: (loading: boolean) => void;
  pairHeritage: (unit: string, cab: string) => void;
  unpairHeritage: (unit: string) => void;
  toggleFreight: () => void;
}

export const useStore = create<AppState>((set, get) => ({
  mode: 'live',
  trains: [],
  frames: [],
  lastFrameKey: null,
  playbackDate: null,
  playbackDay: null,
  playbackIndex: 0,
  playbackPlaying: false,
  playbackSpeed: CONFIG.playbackSpeeds[1],
  playbackLoading: false,
  playbackError: null,
  heartbeat: 'idle',
  lastDataMs: null,
  seeded: false,
  selectedCab: null,
  inspectStage: 0,
  predictions: {},
  predictionsAsOf: null,
  predictionsLoading: false,
  heritage: {},
  showFreight: false,

  hydrateHeritage: async () => {
    try {
      const raw = await AsyncStorage.getItem(HERITAGE_STORAGE_KEY);
      if (raw) set({ heritage: JSON.parse(raw) as HeritagePairs });
    } catch {
      // ignore corrupt/missing storage
    }
  },

  setPlaybackLoading: (date) =>
    set({ mode: 'playback', playbackDate: date, playbackLoading: true, playbackError: null, playbackPlaying: false }),

  setPlaybackError: (date, message) =>
    set({ mode: 'playback', playbackDate: date, playbackLoading: false, playbackError: message, playbackDay: null }),

  enterPlayback: (date, day) => {
    // Start at the first frame that actually has trains (skip overnight empties).
    const firstWithTrains = day.frames.findIndex((f) => f.trains.length > 0);
    set({
      mode: 'playback',
      playbackDate: date,
      playbackDay: day,
      playbackIndex: firstWithTrains >= 0 ? firstWithTrains : 0,
      playbackPlaying: false,
      playbackLoading: false,
      playbackError: null,
      selectedCab: null,
      inspectStage: 0,
    });
  },

  exitToLive: () =>
    set({
      mode: 'live',
      playbackDay: null,
      playbackDate: null,
      playbackPlaying: false,
      playbackLoading: false,
      playbackError: null,
      selectedCab: null,
      inspectStage: 0,
    }),

  setPlaybackIndex: (index) =>
    set((s) => {
      const max = (s.playbackDay?.frames.length ?? 1) - 1;
      return { playbackIndex: Math.max(0, Math.min(max, Math.round(index))) };
    }),

  stepPlayback: (delta) =>
    set((s) => {
      const frames = s.playbackDay?.frames.length ?? 0;
      if (frames === 0) return s;
      const next = s.playbackIndex + delta;
      if (next >= frames - 1) return { playbackIndex: frames - 1, playbackPlaying: false }; // stop at end
      if (next <= 0) return { playbackIndex: 0 };
      return { playbackIndex: next };
    }),

  setPlaybackPlaying: (playing) =>
    set((s) => {
      // If starting playback from the last frame, rewind to the beginning.
      const atEnd = s.playbackIndex >= (s.playbackDay?.frames.length ?? 1) - 1;
      return { playbackPlaying: playing, playbackIndex: playing && atEnd ? 0 : s.playbackIndex };
    }),

  setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),

  setTrains: (trains, source) =>
    set({
      trains,
      heartbeat: source === 'stream' ? 'streaming' : 'polling',
      lastDataMs: Date.now(),
    }),

  seedFrom: (trains, frameKey) =>
    set((s) => ({
      trains: s.seeded ? s.trains : trains,
      lastFrameKey: frameKey,
      seeded: true,
    })),

  commitFrame: (frame) =>
    set((s) => {
      if (frame.key === s.lastFrameKey) return s;
      const frames = [...s.frames, frame];
      const cap = getConfig().live.maxSessionFrames;
      if (frames.length > cap) frames.splice(0, frames.length - cap);
      return { frames, lastFrameKey: frame.key };
    }),

  markStale: () => set({ heartbeat: 'stale' }),

  selectCab: (cab) => set({ selectedCab: cab, inspectStage: cab ? 1 : 0 }),

  // Per-train tap cycle: chip -> details -> stops -> nothing.
  cycleInspect: (cab) =>
    set((s) => {
      if (s.selectedCab !== cab) return { selectedCab: cab, inspectStage: 1 };
      const next = s.inspectStage + 1;
      if (next > 3) return { selectedCab: null, inspectStage: 0 };
      return { inspectStage: next };
    }),

  setPredictions: (rows) => set({ predictions: rows, predictionsAsOf: Date.now(), predictionsLoading: false }),
  setPredictionsLoading: (loading) => set({ predictionsLoading: loading }),

  pairHeritage: (unit, cab) =>
    set((s) => {
      // A cab can hold only one unit; assigning a unit to a cab clears any
      // other unit previously on that cab and any prior cab for this unit.
      const heritage: HeritagePairs = {};
      for (const [u, c] of Object.entries(s.heritage)) {
        if (u === unit) continue; // replace this unit's pairing
        if (c === cab) continue; // this cab is being reassigned
        heritage[u] = c;
      }
      heritage[unit] = cab;
      void AsyncStorage.setItem(HERITAGE_STORAGE_KEY, JSON.stringify(heritage));
      return { heritage };
    }),

  unpairHeritage: (unit) =>
    set((s) => {
      const heritage = { ...s.heritage };
      delete heritage[unit];
      void AsyncStorage.setItem(HERITAGE_STORAGE_KEY, JSON.stringify(heritage));
      return { heritage };
    }),

  toggleFreight: () => set((s) => ({ showFreight: !s.showFreight })),
}));

/** Reverse lookup: cab label -> unit number (for painting markers). */
export function cabToUnit(heritage: HeritagePairs): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [unit, cab] of Object.entries(heritage)) out[cab] = unit;
  return out;
}

/** The frame currently shown in playback mode (or undefined). */
export function currentPlaybackFrame(s: AppState): Frame | undefined {
  if (s.mode !== 'playback' || !s.playbackDay) return undefined;
  return s.playbackDay.frames[s.playbackIndex];
}

/**
 * Trains to render on the map: the scrubbed archive frame in playback mode,
 * otherwise the live poll. Everything (markers, inspect, heritage picker,
 * counts) reads through this so the two modes share one code path.
 */
export function selectDisplayedTrains(s: AppState): Train[] {
  if (s.mode === 'playback') return plottableTrains(currentPlaybackFrame(s));
  return s.trains;
}

/**
 * Hook for the displayed trains. In playback mode the selector builds a fresh
 * array each call, so we wrap it in `useShallow`: zustand then shallow-compares
 * and hands back the cached array reference when contents are unchanged. Without
 * this, `useSyncExternalStore` sees a new snapshot every render and loops
 * ("getSnapshot should be cached" -> "Maximum update depth exceeded").
 */
export function useDisplayedTrains(): Train[] {
  return useStore(useShallow(selectDisplayedTrains));
}
