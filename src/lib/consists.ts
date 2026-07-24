import { coarseAgoLabel } from './time';

/**
 * Consist designations: a user-marked note that a cab label runs in a
 * non-standard configuration, and the capacity rules that follow from it.
 *
 *   sandwich     — one locomotive on EACH end, the cab car riding within.
 *   doubleheader — two locomotives coupled on the SAME end.
 *
 * Why this exists: the MBTA feed reports only the cab car, so a consist with
 * two locomotives still arrives as one vehicle. Designating the cab is what
 * lets a user assign two notable units to it.
 *
 * Storage stays unit -> cab (a unit is on at most one cab); capacity is
 * enforced at assignment time by counting units already mapped to the target.
 * That keeps existing single pairings valid with no migration — a cab with no
 * designation simply has a capacity of one, exactly as before.
 */

export type ConsistKind = 'sandwich' | 'doubleheader';
export type PositionTag = 'OB' | 'IB' | 'lead' | 'trail';

/** The two position tags each designation kind allows. Untagged is always OK. */
export const POSITIONS: Record<ConsistKind, readonly [PositionTag, PositionTag]> = {
  sandwich: ['OB', 'IB'],
  doubleheader: ['lead', 'trail'],
};

export const KIND_LABEL: Record<ConsistKind, string> = {
  sandwich: 'Sandwich',
  doubleheader: 'Doubleheader',
};

/** How a position tag reads in prose: "OB end", "lead loco". */
export function positionLabel(tag: PositionTag): string {
  return tag === 'OB' || tag === 'IB' ? `${tag} end` : `${tag} loco`;
}

/** A designation older than this is nudged for re-verification (never deleted). */
export const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

export interface Designation {
  cab: string;
  kind: ConsistKind;
  /** 0-2 freeform road numbers: the physical locomotives, rostered or not. */
  locos: string[];
  /** Optional position tags, keyed by road number (covers locos and units). */
  positions: Record<string, PositionTag>;
  note?: string;
  markedAt: number;
  /** Which assigned unit's icon leads the marker when two are assigned. */
  primaryUnit?: string;
}

/** cab label -> designation */
export type Designations = Record<string, Designation>;
/** unit number -> cab label (unchanged from the single-pairing era) */
export type HeritagePairs = Record<string, string>;
/** unit number -> when it was assigned, for stable "first-assigned" ordering */
export type AssignedAt = Record<string, number>;

// --- Capacity ---------------------------------------------------------------

export const CAPACITY_REGULAR = 1;
export const CAPACITY_DESIGNATED = 2;

/**
 * How many notable units may sit on this cab. A maximum, not a requirement: a
 * sandwich with one or zero assigned units is perfectly valid (cab 1704 is a
 * sandwich of 1002 + 1139, but only 1002 is on the roster today).
 */
export function capacityFor(designation: Designation | undefined): number {
  return designation ? CAPACITY_DESIGNATED : CAPACITY_REGULAR;
}

/** Units currently assigned to a cab. */
export function unitsOnCab(heritage: HeritagePairs, cab: string): string[] {
  return Object.entries(heritage)
    .filter(([, c]) => c === cab)
    .map(([unit]) => unit);
}

/**
 * Units on a cab in assignment order, oldest first. Pairings made before
 * assignment times were recorded sort first (treated as timestamp 0) and tie-
 * break by road number, so the order is always deterministic.
 */
export function orderedUnitsOnCab(
  heritage: HeritagePairs,
  assignedAt: AssignedAt,
  cab: string,
): string[] {
  return unitsOnCab(heritage, cab).sort((a, b) => {
    const at = (assignedAt[a] ?? 0) - (assignedAt[b] ?? 0);
    return at !== 0 ? at : a.localeCompare(b);
  });
}

/**
 * The unit whose icon represents this cab on the map: the user's explicit
 * choice when it's still assigned here, otherwise the first-assigned.
 */
export function primaryUnitForCab(
  heritage: HeritagePairs,
  assignedAt: AssignedAt,
  designations: Designations,
  cab: string,
): string | undefined {
  const units = orderedUnitsOnCab(heritage, assignedAt, cab);
  const chosen = designations[cab]?.primaryUnit;
  if (chosen && units.includes(chosen)) return chosen;
  return units[0];
}

// --- Assignment outcomes ----------------------------------------------------

export type AssignOutcome =
  /** Room on the cab (or the unit is already there) — go ahead. */
  | { status: 'ok' }
  /** Undesignated cab already holds its one unit; offer to mark the consist. */
  | { status: 'needsDesignation'; cab: string; unit: string; occupant: string }
  /** Designated cab is already at capacity; the user must unassign first. */
  | { status: 'full'; cab: string; max: number; occupants: string[] };

/**
 * Whether `unit` may be assigned to `cab`, and if not, why. Reassigning a unit
 * to the cab it already occupies is always fine, and a unit moving off another
 * cab frees that one — only the target's occupancy matters.
 */
export function assignOutcome(
  heritage: HeritagePairs,
  designations: Designations,
  unit: string,
  cab: string,
): AssignOutcome {
  const occupants = unitsOnCab(heritage, cab).filter((u) => u !== unit);
  const max = capacityFor(designations[cab]);
  if (occupants.length < max) return { status: 'ok' };
  if (!designations[cab]) {
    return { status: 'needsDesignation', cab, unit, occupant: occupants[0] };
  }
  return { status: 'full', cab, max, occupants };
}

/**
 * Whether a designation can be removed (or replaced by one of lower capacity)
 * without silently dropping an assignment. Never drop one — prompt instead.
 */
export function canReduceCapacity(
  heritage: HeritagePairs,
  cab: string,
  nextCapacity: number,
): boolean {
  return unitsOnCab(heritage, cab).length <= nextCapacity;
}

// --- Display ----------------------------------------------------------------

export function isStale(markedAt: number, nowMs: number = Date.now()): boolean {
  return nowMs - markedAt > STALE_AFTER_MS;
}

/**
 * The detail-view badge line, e.g.
 *   "SANDWICH · locos 1002 + 1139 · marked 3d ago"
 *   "DOUBLEHEADER · marked 20d ago · verify?"   (stale, no locos recorded)
 */
export function describeDesignation(d: Designation, nowMs: number = Date.now()): string {
  const parts = [KIND_LABEL[d.kind].toUpperCase()];
  if (d.locos.length) parts.push(`locos ${d.locos.join(' + ')}`);
  parts.push(`marked ${coarseAgoLabel(d.markedAt, nowMs)}`);
  if (isStale(d.markedAt, nowMs)) parts.push('verify?');
  return parts.join(' · ');
}

/** A freeform loco number that matches the roster renders as a linked chip. */
export function isRostered(loco: string, rosterById: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(rosterById, loco);
}

/** Build a fresh designation, defaulting the fields the UI fills in later. */
export function newDesignation(cab: string, kind: ConsistKind, markedAt: number): Designation {
  return { cab, kind, locos: [], positions: {}, markedAt };
}

/**
 * Drop position tags that the (possibly changed) kind no longer allows, so a
 * sandwich switched to a doubleheader can't keep an "OB" tag around.
 */
export function prunePositions(
  positions: Record<string, PositionTag>,
  kind: ConsistKind,
): Record<string, PositionTag> {
  const allowed = POSITIONS[kind] as readonly PositionTag[];
  const out: Record<string, PositionTag> = {};
  for (const [num, tag] of Object.entries(positions)) {
    if (allowed.includes(tag)) out[num] = tag;
  }
  return out;
}
