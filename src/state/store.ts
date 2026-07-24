import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { CONFIG } from '../config';
import { getConfig } from '../config/configStore';
import type { PredictionRow } from '../api/mbta';
import { plottableTrains } from '../api/frames';
import type { DayFrames, Frame, HeartbeatState, Train } from '../types';
import {
  assignOutcome,
  canReduceCapacity,
  capacityFor,
  newDesignation,
  orderedUnitsOnCab,
  primaryUnitForCab,
  prunePositions,
  unitsOnCab,
  type AssignedAt,
  type AssignOutcome,
  type ConsistKind,
  type Designation,
  type Designations,
  type HeritagePairs,
  type PositionTag,
} from '../lib/consists';

export type AppMode = 'live' | 'playback';
export type { HeritagePairs };

/**
 * App state. The live-mode session model: seed once from today's frames file,
 * then the stream (or polls) are the source of truth. Frame snapshots are
 * committed ~1/min into a capped history for scrub/trails.
 *
 * Notable-unit assignment is unit number -> cab label, persisted on-device
 * (mirrors the web app's localStorage key `crHeritage`). Consist designations
 * live in a SEPARATE key rather than reshaping that one: an install with no
 * designations behaves exactly as it did before, so existing single pairings
 * migrate untouched, and a cab's capacity is derived rather than stored.
 */

const HERITAGE_STORAGE_KEY = 'crHeritage';
const CONSISTS_STORAGE_KEY = 'crConsists.v1';
const LAYER_PREFS_KEY = 'layerPrefs.v1';

/** Everything the consist sidecar persists. */
interface ConsistStore {
  designations: Designations;
  assignedAt: AssignedAt;
}

interface AppState {
  // Mode: live polling vs historical playback
  mode: AppMode;

  // Live data
  trains: Train[];
  frames: Frame[]; // capped session history, newest last (since app launch)
  lastFrameKey: string | null;
  // Today's archived frames (midnight -> last archive write), loaded once at
  // seed. Together with `frames` this gives the full current day in live mode
  // (archive covers before launch; session covers launch -> now).
  todayFrames: Frame[];

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
  selectedKey: string | null;
  inspectStage: number;

  // Predictions (explicit refresh only)
  predictions: Record<string, PredictionRow[]>; // by tripId
  predictionsAsOf: number | null;
  predictionsLoading: boolean;

  // Notable-unit assignment (unit -> cab) + consist designations (by cab)
  heritage: HeritagePairs;
  designations: Designations;
  assignedAt: AssignedAt;

  // Map layer toggles (persisted)
  showTrails: boolean; // movement history lines
  showRoutes: boolean; // CR network line overlay (off = trails more visible)
  showStations: boolean; // CR station dots
  showGhosts: boolean; // ghost (no-cab) vehicles
  showRevenue: boolean; // in-service (revenue) trains
  showNonRevenue: boolean; // deadhead / non-revenue trains

  // Actions
  hydrateHeritage: () => Promise<void>;
  hydrateConsists: () => Promise<void>;
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
  setTodayFrames: (frames: Frame[]) => void;
  commitFrame: (frame: Frame) => void;
  markStale: () => void;
  selectKey: (key: string | null) => void;
  cycleInspect: (key: string) => void;
  setPredictions: (rows: Record<string, PredictionRow[]>) => void;
  setPredictionsLoading: (loading: boolean) => void;
  /**
   * Assign a unit to a cab, enforcing that cab's capacity. Returns the outcome
   * so the CALLER can prompt — the store must not own UI decisions, and an
   * over-capacity assignment is a question ("mark this cab as a sandwich or a
   * doubleheader?"), not a failure to swallow. Only 'ok' mutates state.
   */
  pairHeritage: (unit: string, cab: string) => AssignOutcome;
  unpairHeritage: (unit: string) => void;
  /** Create or re-kind a designation. Blocked if it would shed an assignment. */
  setDesignation: (cab: string, kind: ConsistKind) => DesignationResult;
  /** Delete a designation outright. Blocked while 2 units are assigned. */
  removeDesignation: (cab: string) => DesignationResult;
  /** Edit the freeform locos / position tags / note of an existing designation. */
  updateDesignation: (
    cab: string,
    patch: Partial<Pick<Designation, 'locos' | 'positions' | 'note'>>,
  ) => void;
  /** Choose which assigned unit's icon leads the marker. */
  setPrimaryUnit: (cab: string, unit: string) => void;
  toggleTrails: () => void;
  toggleRoutes: () => void;
  toggleStations: () => void;
  toggleGhosts: () => void;
  toggleRevenue: () => void;
  toggleNonRevenue: () => void;
  hydrateLayerPrefs: () => Promise<void>;
}

/** Outcome of a designation edit; 'blocked' never mutates state. */
export type DesignationResult =
  | { status: 'ok' }
  | { status: 'blocked'; cab: string; assigned: string[]; capacity: number };

type LayerPrefs = Pick<
  AppState,
  'showTrails' | 'showRoutes' | 'showStations' | 'showGhosts' | 'showRevenue' | 'showNonRevenue'
>;

const DEFAULT_LAYER_PREFS: LayerPrefs = {
  showTrails: true,
  showRoutes: true,
  showStations: true,
  showGhosts: true,
  showRevenue: true,
  showNonRevenue: true,
};

/** Capacity a cab falls back to once its designation is removed. */
const CAPACITY_AFTER_REMOVAL = 1;

function persistHeritage(heritage: HeritagePairs): void {
  void AsyncStorage.setItem(HERITAGE_STORAGE_KEY, JSON.stringify(heritage));
}

function persistConsists(s: Pick<AppState, 'designations' | 'assignedAt'>): void {
  const payload: ConsistStore = { designations: s.designations, assignedAt: s.assignedAt };
  void AsyncStorage.setItem(CONSISTS_STORAGE_KEY, JSON.stringify(payload));
}

/**
 * When a unit leaves a cab, clear it as that cab's primary so the marker falls
 * back to whoever remains. The designation itself is untouched.
 */
function clearPrimaryIfUnassigned(
  designations: Designations,
  heritage: HeritagePairs,
  unit: string,
): Designations {
  const out: Designations = {};
  let changed = false;
  for (const [cab, d] of Object.entries(designations)) {
    if (d.primaryUnit === unit && heritage[unit] !== cab) {
      const { primaryUnit: _dropped, ...rest } = d;
      out[cab] = rest;
      changed = true;
    } else {
      out[cab] = d;
    }
  }
  return changed ? out : designations;
}

function persistLayerPrefs(s: AppState): void {
  const prefs: LayerPrefs = {
    showTrails: s.showTrails,
    showRoutes: s.showRoutes,
    showStations: s.showStations,
    showGhosts: s.showGhosts,
    showRevenue: s.showRevenue,
    showNonRevenue: s.showNonRevenue,
  };
  void AsyncStorage.setItem(LAYER_PREFS_KEY, JSON.stringify(prefs));
}

export const useStore = create<AppState>((set, get) => ({
  mode: 'live',
  trains: [],
  frames: [],
  lastFrameKey: null,
  todayFrames: [],
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
  selectedKey: null,
  inspectStage: 0,
  predictions: {},
  predictionsAsOf: null,
  predictionsLoading: false,
  heritage: {},
  designations: {},
  assignedAt: {},
  ...DEFAULT_LAYER_PREFS,

  hydrateHeritage: async () => {
    try {
      const raw = await AsyncStorage.getItem(HERITAGE_STORAGE_KEY);
      if (raw) set({ heritage: JSON.parse(raw) as HeritagePairs });
    } catch {
      // ignore corrupt/missing storage
    }
  },

  hydrateConsists: async () => {
    // Absent (every install before this feature) leaves designations empty, so
    // every cab has a capacity of one and prior pairings behave unchanged.
    try {
      const raw = await AsyncStorage.getItem(CONSISTS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<ConsistStore>;
      set({ designations: parsed.designations ?? {}, assignedAt: parsed.assignedAt ?? {} });
    } catch {
      // ignore corrupt storage — designations are advisory, never load-bearing
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
      selectedKey: null,
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
      selectedKey: null,
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

  setTodayFrames: (frames) => set({ todayFrames: frames }),

  commitFrame: (frame) =>
    set((s) => {
      if (frame.key === s.lastFrameKey) return s;
      const frames = [...s.frames, frame];
      const cap = getConfig().live.maxSessionFrames;
      if (frames.length > cap) frames.splice(0, frames.length - cap);
      return { frames, lastFrameKey: frame.key };
    }),

  markStale: () => set({ heartbeat: 'stale' }),

  selectKey: (key) => set({ selectedKey: key, inspectStage: key ? 1 : 0 }),

  // Per-train tap cycle: chip -> details -> stops -> nothing.
  cycleInspect: (key) =>
    set((s) => {
      if (s.selectedKey !== key) return { selectedKey: key, inspectStage: 1 };
      const next = s.inspectStage + 1;
      if (next > 3) return { selectedKey: null, inspectStage: 0 };
      return { inspectStage: next };
    }),

  setPredictions: (rows) => set({ predictions: rows, predictionsAsOf: Date.now(), predictionsLoading: false }),
  setPredictionsLoading: (loading) => set({ predictionsLoading: loading }),

  pairHeritage: (unit, cab) => {
    const s = get();
    const outcome = assignOutcome(s.heritage, s.designations, unit, cab);
    if (outcome.status !== 'ok') return outcome; // caller prompts; nothing changes

    // A unit is on at most one cab, so this move also frees its previous one.
    // Units already on the target stay put — capacity was checked above.
    const heritage: HeritagePairs = { ...s.heritage, [unit]: cab };
    const assignedAt: AssignedAt = { ...s.assignedAt, [unit]: Date.now() };
    set({ heritage, assignedAt });
    persistHeritage(heritage);
    persistConsists(get());
    return outcome;
  },

  unpairHeritage: (unit) =>
    set((s) => {
      const heritage = { ...s.heritage };
      delete heritage[unit];
      const assignedAt = { ...s.assignedAt };
      delete assignedAt[unit];

      // Drop a stale primary pointer, but keep the designation itself: the
      // consist is still a sandwich whether or not a unit is assigned to it.
      const designations = clearPrimaryIfUnassigned(s.designations, heritage, unit);

      persistHeritage(heritage);
      persistConsists({ ...s, designations, assignedAt });
      return { heritage, assignedAt, designations };
    }),

  setDesignation: (cab, kind) => {
    const s = get();
    const existing = s.designations[cab];
    // Both kinds hold two, so re-kinding never sheds an assignment today; the
    // guard is written against capacity so a future kind can't quietly break it.
    if (!canReduceCapacity(s.heritage, cab, capacityFor(newDesignation(cab, kind, 0)))) {
      return {
        status: 'blocked',
        cab,
        assigned: unitsOnCab(s.heritage, cab),
        capacity: capacityFor(existing),
      };
    }

    const designation: Designation = existing
      ? { ...existing, kind, positions: prunePositions(existing.positions, kind) }
      : newDesignation(cab, kind, Date.now());
    const designations = { ...s.designations, [cab]: designation };
    set({ designations });
    persistConsists(get());
    return { status: 'ok' };
  },

  removeDesignation: (cab) => {
    const s = get();
    // Removing drops capacity to one: refuse rather than silently unassign.
    if (!canReduceCapacity(s.heritage, cab, CAPACITY_AFTER_REMOVAL)) {
      return {
        status: 'blocked',
        cab,
        assigned: unitsOnCab(s.heritage, cab),
        capacity: CAPACITY_AFTER_REMOVAL,
      };
    }
    const designations = { ...s.designations };
    delete designations[cab];
    set({ designations });
    persistConsists(get());
    return { status: 'ok' };
  },

  updateDesignation: (cab, patch) =>
    set((s) => {
      const existing = s.designations[cab];
      if (!existing) return s;
      const next: Designation = { ...existing, ...patch };
      // Keep tags consistent with the kind even if a caller passes stray ones.
      next.positions = prunePositions(next.positions, next.kind);
      const designations = { ...s.designations, [cab]: next };
      persistConsists({ ...s, designations });
      return { designations };
    }),

  setPrimaryUnit: (cab, unit) =>
    set((s) => {
      const existing = s.designations[cab];
      // Primary only means anything for a designated cab holding two units.
      if (!existing || !unitsOnCab(s.heritage, cab).includes(unit)) return s;
      const designations = { ...s.designations, [cab]: { ...existing, primaryUnit: unit } };
      persistConsists({ ...s, designations });
      return { designations };
    }),

  toggleTrails: () => {
    set((s) => ({ showTrails: !s.showTrails }));
    persistLayerPrefs(get());
  },
  toggleRoutes: () => {
    set((s) => ({ showRoutes: !s.showRoutes }));
    persistLayerPrefs(get());
  },
  toggleStations: () => {
    set((s) => ({ showStations: !s.showStations }));
    persistLayerPrefs(get());
  },
  toggleGhosts: () => {
    set((s) => ({ showGhosts: !s.showGhosts }));
    persistLayerPrefs(get());
  },
  toggleRevenue: () => {
    set((s) => ({ showRevenue: !s.showRevenue }));
    persistLayerPrefs(get());
  },
  toggleNonRevenue: () => {
    set((s) => ({ showNonRevenue: !s.showNonRevenue }));
    persistLayerPrefs(get());
  },

  hydrateLayerPrefs: async () => {
    try {
      const raw = await AsyncStorage.getItem(LAYER_PREFS_KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as Partial<LayerPrefs>;
      set({
        showTrails: p.showTrails ?? DEFAULT_LAYER_PREFS.showTrails,
        showRoutes: p.showRoutes ?? DEFAULT_LAYER_PREFS.showRoutes,
        showStations: p.showStations ?? DEFAULT_LAYER_PREFS.showStations,
        showGhosts: p.showGhosts ?? DEFAULT_LAYER_PREFS.showGhosts,
        showRevenue: p.showRevenue ?? DEFAULT_LAYER_PREFS.showRevenue,
        showNonRevenue: p.showNonRevenue ?? DEFAULT_LAYER_PREFS.showNonRevenue,
      });
    } catch {
      // ignore corrupt prefs — defaults stand
    }
  },
}));

/**
 * Reverse lookup: cab label -> the units assigned to it. A designated cab may
 * hold two, so this returns a list; callers that render a single icon pick the
 * primary via primaryUnitForCab().
 */
export function unitsByCab(heritage: HeritagePairs): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [unit, cab] of Object.entries(heritage)) {
    const list = out[cab];
    if (list) list.push(unit);
    else out[cab] = [unit];
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.localeCompare(b));
  return out;
}

/** The units on a cab in assignment order, primary first. */
export function displayUnitsForCab(
  s: Pick<AppState, 'heritage' | 'assignedAt' | 'designations'>,
  cab: string,
): string[] {
  const ordered = orderedUnitsOnCab(s.heritage, s.assignedAt, cab);
  const primary = primaryUnitForCab(s.heritage, s.assignedAt, s.designations, cab);
  if (!primary) return ordered;
  return [primary, ...ordered.filter((u) => u !== primary)];
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
