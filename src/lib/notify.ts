import type * as NotificationsModule from 'expo-notifications';

/**
 * Local-notification plumbing. We only ever present *local* notifications (no
 * push server): a heritage locomotive appearing in the live feed is detected
 * on-device and surfaced immediately. Foreground presentation is enabled since
 * the user is usually watching the live map when a loco rolls out.
 *
 * expo-notifications is loaded lazily (never at module scope): its submodules
 * call `requireNativeModule` at import time, which throws "runtime not ready"
 * if evaluated during early startup — and hard-crashes a dev client that lacks
 * the native module. Deferring the require to first use (post-mount) avoids
 * both, and every entry point is wrapped so notifications can never crash the app.
 */

let mod: typeof NotificationsModule | null = null;

function notifications(): typeof NotificationsModule | null {
  if (mod) return mod;
  try {
    mod = require('expo-notifications') as typeof NotificationsModule;
    return mod;
  } catch {
    return null; // native module absent (e.g. an older build) — degrade quietly
  }
}

let handlerConfigured = false;

/** Install the foreground handler once (banner + sound even while app is open). */
export function configureNotifications(): void {
  if (handlerConfigured) return;
  const N = notifications();
  if (!N) return;
  handlerConfigured = true;
  try {
    N.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  } catch {
    handlerConfigured = false;
  }
}

/**
 * Ensure notification permission. Requests once if undetermined; returns
 * whether we're allowed to present. Safe to call repeatedly (no re-prompt once
 * the user has answered).
 */
export async function ensureNotifyPermission(): Promise<boolean> {
  const N = notifications();
  if (!N) return false;
  try {
    const current = await N.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const req = await N.requestPermissionsAsync();
    return req.granted;
  } catch {
    return false;
  }
}

/** Present a local notification immediately (best-effort; never throws). */
export async function presentNotification(title: string, body: string): Promise<void> {
  const N = notifications();
  if (!N) return;
  try {
    await N.scheduleNotificationAsync({
      content: { title, body },
      trigger: null, // deliver now
    });
  } catch {
    // Notifications are a non-critical enhancement — swallow failures.
  }
}
