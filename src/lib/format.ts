import { msToMph } from '../api/mbta';
import type { HeartbeatState, Train, VehicleStatus } from '../types';

/** Prettified vehicle status for the details card. */
export function prettyStatus(status: VehicleStatus | null): string {
  switch (status) {
    case 'IN_TRANSIT_TO':
      return 'In transit';
    case 'STOPPED_AT':
      return 'Stopped';
    case 'INCOMING_AT':
      return 'Arriving';
    default:
      return 'Unknown';
  }
}

/** "42 mph" or "—" when speed is unavailable (often null on the feed). */
export function mphLabel(spd: number | null | undefined): string {
  const mph = msToMph(spd);
  if (mph == null) return '—';
  return `${Math.round(mph)} mph`;
}

export function heartbeatColor(state: HeartbeatState): string {
  switch (state) {
    case 'streaming':
      return '#2ECC71';
    case 'polling':
      return '#F5C518';
    case 'stale':
      return '#E74C3C';
    default:
      return '#95A5A6';
  }
}

export function heartbeatLabel(state: HeartbeatState): string {
  switch (state) {
    case 'streaming':
      return 'Live';
    case 'polling':
      return 'Polling';
    case 'stale':
      return 'No data';
    default:
      return 'Connecting';
  }
}

/** Find the current train object for a cab label. */
export function findByCab(trains: Train[], cab: string | null): Train | undefined {
  if (!cab) return undefined;
  return trains.find((t) => t.cab === cab);
}
