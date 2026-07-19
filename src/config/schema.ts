/**
 * Runtime config: the remote config.json shape (raw) and the app's normalized
 * form (derived fields precomputed). Fetched from CloudFront at launch, cached,
 * with baked-in defaults as fallback. See MOBILE_APP_INTEGRATION.md
 * "Remote config".
 */

// --- Raw shape as served at https://trains.chrisnewell.net/config.json --------

export interface RawRoute {
  id: string;
  name: string;
  color: string;
  seasonal?: boolean;
  event_service?: boolean;
  hidden_in_route_listing?: boolean;
}

export interface RawConfig {
  schema_version: number;
  updated?: string;
  endpoints: { frames_base: string; mbta_api: string };
  routes: RawRoute[];
  live: {
    poll_interval_sec: number;
    stream_watchdog_sec: number;
    stale_after_sec: number;
    frame_commit_interval_sec: number;
    max_session_frames: number;
  };
  trails: {
    gap_break_min: number;
    max_implied_mph: number;
    max_hop_mi: number;
    break_on_route_change: boolean;
  };
  heritage_units: string[];
  attribution: { data: string; map: string };
}

// --- Normalized form the app consumes ----------------------------------------

export interface RouteInfo {
  id: string;
  name: string;
  color: string;
  /** Short display label (name with a trailing " Line" stripped). */
  short: string;
  seasonal: boolean;
  eventService: boolean;
  hidden: boolean;
}

export type ConfigSource = 'default' | 'cached' | 'live';

export interface RuntimeConfig {
  schemaVersion: number;
  updated: string | null;
  source: ConfigSource;

  routes: RouteInfo[];
  routeIds: string[];
  /** Comma-joined route ids for MBTA filter[route]. */
  routeFilter: string;
  routeById: Record<string, RouteInfo>;

  framesBase: string; // e.g. https://trains.chrisnewell.net/frames/
  mbtaApi: string; // e.g. https://api-v3.mbta.com

  live: {
    pollIntervalMs: number;
    streamWatchdogMs: number;
    staleAfterMs: number;
    frameCommitIntervalMs: number;
    maxSessionFrames: number;
  };
  trails: {
    gapBreakMin: number;
    maxImpliedMph: number;
    maxHopMi: number;
    breakOnRouteChange: boolean;
  };
  heritageUnits: string[];
  attribution: { data: string; map: string };
}

// --- Validation + normalization ----------------------------------------------

/** Highest schema version this build understands. */
export const SUPPORTED_SCHEMA_VERSION = 1;

function short(name: string): string {
  return name.replace(/\s+Line$/i, '').trim();
}

/**
 * Validate a parsed JSON value as a RawConfig. Returns it typed, or throws with
 * a reason. Kept strict on the fields the app depends on (routes, endpoints)
 * and lenient on the rest (falls back to defaults per-field in normalize()).
 */
export function validateRawConfig(value: unknown): RawConfig {
  if (!value || typeof value !== 'object') throw new Error('config not an object');
  const c = value as Partial<RawConfig>;
  if (typeof c.schema_version !== 'number') throw new Error('missing schema_version');
  if (c.schema_version > SUPPORTED_SCHEMA_VERSION) {
    throw new Error(`unsupported schema_version ${c.schema_version}`);
  }
  if (!Array.isArray(c.routes) || c.routes.length === 0) throw new Error('routes missing/empty');
  for (const r of c.routes) {
    if (!r || typeof r.id !== 'string' || typeof r.name !== 'string' || typeof r.color !== 'string') {
      throw new Error('route entry missing id/name/color');
    }
  }
  if (!c.endpoints || typeof c.endpoints.frames_base !== 'string' || typeof c.endpoints.mbta_api !== 'string') {
    throw new Error('endpoints missing');
  }
  return c as RawConfig;
}

/**
 * Convert a validated RawConfig into the normalized RuntimeConfig, filling any
 * soft-missing sub-objects from `fallback` (usually DEFAULT_CONFIG).
 */
export function normalizeConfig(raw: RawConfig, source: ConfigSource, fallback: RuntimeConfig): RuntimeConfig {
  const routes: RouteInfo[] = raw.routes.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    short: short(r.name),
    seasonal: !!r.seasonal,
    eventService: !!r.event_service,
    hidden: !!r.hidden_in_route_listing,
  }));
  const routeById: Record<string, RouteInfo> = {};
  for (const r of routes) routeById[r.id] = r;

  const live = raw.live ?? {};
  const trails = raw.trails ?? {};
  const sec = (v: number | undefined, defMs: number) => (typeof v === 'number' ? v * 1000 : defMs);

  return {
    schemaVersion: raw.schema_version,
    updated: raw.updated ?? null,
    source,
    routes,
    routeIds: routes.map((r) => r.id),
    routeFilter: routes.map((r) => r.id).join(','),
    routeById,
    framesBase: raw.endpoints.frames_base,
    mbtaApi: raw.endpoints.mbta_api,
    live: {
      pollIntervalMs: sec(live.poll_interval_sec, fallback.live.pollIntervalMs),
      streamWatchdogMs: sec(live.stream_watchdog_sec, fallback.live.streamWatchdogMs),
      staleAfterMs: sec(live.stale_after_sec, fallback.live.staleAfterMs),
      frameCommitIntervalMs: sec(live.frame_commit_interval_sec, fallback.live.frameCommitIntervalMs),
      maxSessionFrames:
        typeof live.max_session_frames === 'number' ? live.max_session_frames : fallback.live.maxSessionFrames,
    },
    trails: {
      gapBreakMin: typeof trails.gap_break_min === 'number' ? trails.gap_break_min : fallback.trails.gapBreakMin,
      maxImpliedMph:
        typeof trails.max_implied_mph === 'number' ? trails.max_implied_mph : fallback.trails.maxImpliedMph,
      maxHopMi: typeof trails.max_hop_mi === 'number' ? trails.max_hop_mi : fallback.trails.maxHopMi,
      breakOnRouteChange:
        typeof trails.break_on_route_change === 'boolean'
          ? trails.break_on_route_change
          : fallback.trails.breakOnRouteChange,
    },
    heritageUnits:
      Array.isArray(raw.heritage_units) && raw.heritage_units.length > 0
        ? raw.heritage_units.map(String)
        : fallback.heritageUnits,
    attribution: {
      data: raw.attribution?.data ?? fallback.attribution.data,
      map: raw.attribution?.map ?? fallback.attribution.map,
    },
  };
}
