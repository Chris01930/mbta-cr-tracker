/**
 * Domain types. A `Train` is the app's normalized in-memory representation of
 * a vehicle, unified across the two data planes (archive frames + live MBTA).
 */

export type VehicleStatus = 'IN_TRANSIT_TO' | 'STOPPED_AT' | 'INCOMING_AT';

/** Normalized train, keyed by cab label across trip numbers. */
export interface Train {
  /** Vehicle label = cab car number (may be null: "ghost" vehicles). */
  cab: string | null;
  /** Trip name = timetable train number (may be null). */
  train: string | null;
  /** Trip headsign / destination (may be null). */
  dest: string | null;
  /** Route id, e.g. "CR-Newburyport". */
  route: string | null;
  status: VehicleStatus | null;
  lat: number;
  lon: number;
  /** Bearing degrees, may be null. */
  brg: number | null;
  /** Per-vehicle updated_at (ISO 8601 with Eastern offset). */
  upd: string | null;
  /**
   * Non-revenue movement (deadhead / equipment repositioning). Derived from the
   * frames `rev` field or the live vehicle `revenue` attribute; default false.
   * Display-only — never affects fetching, pairing, or trails.
   */
  isNonRevenue: boolean;
  /**
   * Ghost = a vehicle with no cab label (logged onto no trip; yard/positioning
   * move). `true` when cab == null.
   */
  isGhost: boolean;
  /**
   * MBTA vehicle resource id. Carried for ghosts as their tracking key (frames
   * `vid`, or the live vehicle resource id). Absent for pre-2026-07-19 ghosts.
   */
  vid?: string | null;
  /** Live-only: trip id, needed for predictions. Absent in archive frames. */
  tripId?: string | null;
  /** Live-only: speed in meters/second (×2.23694 for mph); often null. */
  spd?: number | null;
}

/** A single poll snapshot: all trains at one instant. */
export interface Frame {
  /** HHMMSS Eastern, unique per day, sort key. */
  key: string;
  /** Newest vehicle update in the poll (ISO 8601). */
  time: string;
  trains: Train[];
}

/** Shape of a day frames file served from CloudFront. */
export interface DayFrames {
  date: string;
  updated: string;
  frames: Frame[];
}

export type HeartbeatState = 'streaming' | 'polling' | 'stale' | 'idle';
