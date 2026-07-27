import type { Frame, Train } from '../types';
import { trainKey } from './trains';

/**
 * A single distinct train in the day's roster: its latest fix plus how many
 * frames it appeared in and the last frame index it was seen at (for seeking in
 * playback). "Roster" = every distinct entity (by tracking key) that appears in
 * the day's data, not just the current instant.
 */
export interface RosterEntry {
  key: string;
  train: Train; // latest fix
  frames: number; // how many snapshots it appeared in
  lastFrameIndex: number; // index into the source frames of its most recent fix (-1 if live-only)
}

/**
 * Aggregate distinct trains across the day's frames (oldest -> newest), keeping
 * each entity's most recent fix. `live` (the current poll) is folded in last so
 * live positions win. Non-plottable rows are skipped.
 */
export function buildRoster(frames: Frame[], live: Train[] = []): RosterEntry[] {
  const byKey = new Map<string, RosterEntry>();

  const consider = (t: Train, frameIndex: number) => {
    if (!Number.isFinite(t.lat) || !Number.isFinite(t.lon)) return;
    const key = trainKey(t);
    const existing = byKey.get(key);
    if (existing) {
      existing.train = t; // later occurrence is fresher
      existing.frames += 1;
      existing.lastFrameIndex = frameIndex;
    } else {
      byKey.set(key, { key, train: t, frames: 1, lastFrameIndex: frameIndex });
    }
  };

  frames.forEach((f, i) => f.trains.forEach((t) => consider(t, i)));
  live.forEach((t) => consider(t, -1));

  return Array.from(byKey.values());
}

export type RosterFilter = 'all' | 'nonRevenue' | 'ghost';

/** Filter + sort the roster. "All" surfaces ghost/non-revenue entries first. */
export function filterRoster(roster: RosterEntry[], filter: RosterFilter): RosterEntry[] {
  const rows = roster.filter((r) => {
    if (filter === 'nonRevenue') return r.train.isNonRevenue;
    if (filter === 'ghost') return r.train.isGhost;
    return true;
  });
  const special = (t: Train) => (t.isGhost ? 2 : 0) + (t.isNonRevenue ? 1 : 0);
  return rows.sort((a, b) => {
    const s = special(b.train) - special(a.train); // interesting ones first
    if (s !== 0) return s;
    return rosterLabel(a.train).localeCompare(rosterLabel(b.train), undefined, { numeric: true });
  });
}

/** Sortable label: cab number, else vid, else a stable fallback. */
function rosterLabel(t: Train): string {
  return t.cab ?? t.vid ?? 'zzz';
}

/** Counts for the filter chips. */
export function rosterCounts(roster: RosterEntry[]): { all: number; nonRevenue: number; ghost: number } {
  let nonRevenue = 0;
  let ghost = 0;
  for (const r of roster) {
    if (r.train.isNonRevenue) nonRevenue += 1;
    if (r.train.isGhost) ghost += 1;
  }
  return { all: roster.length, nonRevenue, ghost };
}

export interface ClassPresence {
  nonRevenue: boolean;
  ghost: boolean;
}

/**
 * Whether the dataset contains at least one train in each optional class
 * (non-revenue, ghost). Drives whether the corresponding layer toggle is even
 * shown: ten days of production data have zero of either, so the rows stay
 * hidden until a qualifying train actually appears — without touching parsing,
 * model fields, or rendering. Scans frames + the current live set, short-
 * circuiting once both classes are found.
 */
export function presentTrainClasses(frames: Frame[], live: Train[] = []): ClassPresence {
  let nonRevenue = false;
  let ghost = false;
  const scan = (t: Train) => {
    if (t.isNonRevenue) nonRevenue = true;
    if (t.isGhost) ghost = true;
  };
  for (const f of frames) {
    for (const t of f.trains) {
      scan(t);
      if (nonRevenue && ghost) return { nonRevenue, ghost };
    }
  }
  for (const t of live) {
    scan(t);
    if (nonRevenue && ghost) return { nonRevenue, ghost };
  }
  return { nonRevenue, ghost };
}
