import vendored from './config.default.json';
import { normalizeConfig, validateRawConfig, type RuntimeConfig } from './schema';

/**
 * Baked-in fallback config, used before the first fetch and whenever config.json
 * is unreachable. It is the *vendored copy* of config.json (config.default.json)
 * normalized — NOT hand-written values — so the offline fallback stays in sync
 * with the real config and no route/color/model/icon is duplicated in code.
 * Refresh it by re-copying config.json over config.default.json — but strip the
 * `mbta_keys` block first: API keys must never ship inside the app binary. A
 * keyless fallback degrades to 60s polling, which is what we want offline.
 */
export const DEFAULT_CONFIG: RuntimeConfig = normalizeConfig(
  validateRawConfig(vendored as unknown),
  'default',
);

/** Brand purple (MBTA Commuter Rail) — used as the fallback for unknown ids. */
export const FALLBACK_ROUTE_COLOR = '#80276C';
