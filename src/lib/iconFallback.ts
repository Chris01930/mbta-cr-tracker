import { useSyncExternalStore } from 'react';

/**
 * Tracks unit icon URLs that failed to load, so a unit whose artwork is missing
 * renders as a normal marker instead of a broken image.
 *
 * Two distinct cases produce an icon-less unit, and both must be handled:
 *   1. The config entry has no `icon` at all (schema v3 allows this).
 *   2. The entry HAS an `icon` but the URL doesn't resolve — the live case
 *      today: unit 1002 points at /icons/1002.png, which returns 403 because
 *      the artwork isn't uploaded yet.
 *
 * Case 2 is only observable at render time, and markers mount and unmount
 * constantly as the feed churns, so the failure set is module-level: one 403 is
 * remembered for the rest of the session by every marker and roster row rather
 * than being re-fetched per remount. It is deliberately NOT persisted — artwork
 * appearing later should just start working on the next launch.
 */

const failed = new Set<string>();
const listeners = new Set<() => void>();

/** Snapshot identity, bumped on each new failure so subscribers re-render. */
let version = 0;

export function markIconFailed(url: string): void {
  if (failed.has(url)) return;
  failed.add(url);
  version += 1;
  for (const l of listeners) l();
}

export function isIconFailed(url: string | null | undefined): boolean {
  return !!url && failed.has(url);
}

/** Test-only: forget recorded failures. */
export function resetIconFailures(): void {
  failed.clear();
  version += 1;
  for (const l of listeners) l();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/**
 * The icon URL to actually render for a unit: the configured URL, or undefined
 * when there is none or it has already failed this session. Re-renders the
 * caller if that URL later fails somewhere else in the tree.
 */
export function useUsableIconUrl(icon: string | null | undefined): string | undefined {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
  if (!icon || failed.has(icon)) return undefined;
  return icon;
}
