import { CONFIG } from '../config';

/**
 * All display times are US Eastern. We rely on Intl + the platform tz database
 * (never fixed offsets) so DST is handled correctly. Hermes on RN ships full
 * ICU, so America/New_York is available.
 */

const TZ = CONFIG.timeZone;

/** Today's Eastern service day as YYYY-MM-DD (used for frames path). */
export function easternDateKey(d: Date = new Date()): string {
  // en-CA yields YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Timestamp format: M/D/YYYY h:mma Eastern. */
export function formatTimestamp(iso: string | number | Date | null | undefined): string {
  if (iso == null) return '—';
  const d = typeof iso === 'string' || typeof iso === 'number' ? new Date(iso) : iso;
  if (isNaN(d.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(d);
  return renderParts(parts);
}

/** Schedule / clock format: h:mma Eastern. */
export function formatClock(iso: string | number | Date | null | undefined): string {
  if (iso == null) return '—';
  const d = typeof iso === 'string' || typeof iso === 'number' ? new Date(iso) : iso;
  if (isNaN(d.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(d);
  return renderParts(parts);
}

// Intl renders AM/PM uppercase with a space ("10:24 PM"); the web app uses the
// compact "10:24pm". Join the parts, then collapse " PM" -> "pm".
function renderParts(parts: Intl.DateTimeFormatPart[]): string {
  const out = parts.map((p) => (p.type === 'dayPeriod' ? p.value.toLowerCase() : p.value)).join('');
  // Drop the "date, time" comma Intl inserts, and collapse " pm" -> "pm".
  return out.replace(', ', ' ').replace(/\s+(am|pm)\b/, '$1');
}

/**
 * Inclusive list of YYYY-MM-DD service days from `start` to today (Eastern),
 * newest first. Used to populate the playback date picker.
 */
export function availableDates(start: string, today: string = easternDateKey()): string[] {
  const out: string[] = [];
  // Iterate at noon UTC to stay clear of any DST/midnight boundary issues; we
  // only care about the calendar date string.
  const cur = new Date(`${start}T12:00:00Z`);
  const end = new Date(`${today}T12:00:00Z`);
  while (cur.getTime() <= end.getTime()) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out.reverse();
}

/** Friendly label for a YYYY-MM-DD date, e.g. "Sat, Jul 18". */
export function friendlyDate(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(d);
}

/**
 * Coarse "just now" / "3h ago" / "12d ago" for things marked days ago, where
 * agoLabel's second/minute precision would be noise.
 */
export function coarseAgoLabel(fromMs: number, nowMs: number = Date.now()): string {
  const mins = Math.max(0, Math.round((nowMs - fromMs) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** Human "Xs ago" / "Xm ago" for the heartbeat ticker. */
export function agoLabel(fromMs: number, nowMs: number = Date.now()): string {
  const secs = Math.max(0, Math.round((nowMs - fromMs) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
}
