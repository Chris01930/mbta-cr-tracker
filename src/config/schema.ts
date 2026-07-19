/**
 * Runtime config: the remote config.json shape (raw) and the app's normalized
 * form (derived fields precomputed). Fetched from CloudFront at launch, cached,
 * with a vendored copy of config.json as the offline fallback. See
 * MOBILE_APP_INTEGRATION.md "Remote config".
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

/** Heritage roster entry (schema v2: objects, not plain strings). */
export interface RawHeritageUnit {
  unit: string; // road number — the pairing key
  model: string; // authoritative locomotive model designation
  scheme: string; // livery name
  icon: string; // hosted PNG URL
}

export interface RawConfig {
  schema_version: number;
  updated?: string;
  endpoints: { frames_base: string; mbta_api: string; icons_base?: string };
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
  heritage_units: RawHeritageUnit[];
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

export interface HeritageUnitInfo {
  unit: string;
  model: string;
  scheme: string;
  icon: string;
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

  framesBase: string;
  mbtaApi: string;
  iconsBase: string;

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
  heritageUnits: HeritageUnitInfo[];
  heritageById: Record<string, HeritageUnitInfo>;
  attribution: { data: string; map: string };
}

// --- Validation + normalization ----------------------------------------------

/** Highest schema version this build understands. */
export const SUPPORTED_SCHEMA_VERSION = 2;

// Ultimate safety-net scalars, used only if a (malformed) config omits them and
// no fallback is supplied. Route/color/model/icon values NEVER come from here —
// those come only from the config (live or vendored default).
const ULTIMATE_LIVE = {
  pollIntervalMs: 60_000,
  streamWatchdogMs: 60_000,
  staleAfterMs: 120_000,
  frameCommitIntervalMs: 60_000,
  maxSessionFrames: 600,
};
const ULTIMATE_TRAILS = { gapBreakMin: 15, maxImpliedMph: 90, maxHopMi: 7, breakOnRouteChange: true };

function short(name: string): string {
  return name.replace(/\s+Line$/i, '').trim();
}

/**
 * Validate a parsed JSON value as a RawConfig. Returns it typed, or throws with
 * a reason. Strict on the fields the app depends on (routes, endpoints,
 * heritage_units), lenient on the rest (per-field fallback in normalize()).
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
  if (!Array.isArray(c.heritage_units)) throw new Error('heritage_units missing');
  for (const h of c.heritage_units) {
    if (
      !h ||
      typeof h.unit !== 'string' ||
      typeof h.model !== 'string' ||
      typeof h.scheme !== 'string' ||
      typeof h.icon !== 'string'
    ) {
      throw new Error('heritage_units entry missing unit/model/scheme/icon');
    }
  }
  return c as RawConfig;
}

/**
 * Convert a validated RawConfig into the normalized RuntimeConfig. `fallback`
 * (usually DEFAULT_CONFIG) fills soft-missing scalar sub-objects; omit it when
 * normalizing the vendored default itself (it's complete).
 */
export function normalizeConfig(raw: RawConfig, source: ConfigSource, fallback?: RuntimeConfig): RuntimeConfig {
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

  const heritageUnits: HeritageUnitInfo[] = raw.heritage_units.map((h) => ({
    unit: String(h.unit),
    model: h.model,
    scheme: h.scheme,
    icon: h.icon,
  }));
  const heritageById: Record<string, HeritageUnitInfo> = {};
  for (const h of heritageUnits) heritageById[h.unit] = h;

  const live = raw.live ?? {};
  const trails = raw.trails ?? {};
  const sec = (v: number | undefined, def: number) => (typeof v === 'number' ? v * 1000 : def);
  const num = (v: number | undefined, def: number) => (typeof v === 'number' ? v : def);
  const fl = fallback?.live ?? ULTIMATE_LIVE;
  const ft = fallback?.trails ?? ULTIMATE_TRAILS;

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
    iconsBase: raw.endpoints.icons_base ?? fallback?.iconsBase ?? '',
    live: {
      pollIntervalMs: sec(live.poll_interval_sec, fl.pollIntervalMs),
      streamWatchdogMs: sec(live.stream_watchdog_sec, fl.streamWatchdogMs),
      staleAfterMs: sec(live.stale_after_sec, fl.staleAfterMs),
      frameCommitIntervalMs: sec(live.frame_commit_interval_sec, fl.frameCommitIntervalMs),
      maxSessionFrames: num(live.max_session_frames, fl.maxSessionFrames),
    },
    trails: {
      gapBreakMin: num(trails.gap_break_min, ft.gapBreakMin),
      maxImpliedMph: num(trails.max_implied_mph, ft.maxImpliedMph),
      maxHopMi: num(trails.max_hop_mi, ft.maxHopMi),
      breakOnRouteChange:
        typeof trails.break_on_route_change === 'boolean' ? trails.break_on_route_change : ft.breakOnRouteChange,
    },
    heritageUnits,
    heritageById,
    attribution: {
      data: raw.attribution?.data ?? fallback?.attribution.data ?? '',
      map: raw.attribution?.map ?? fallback?.attribution.map ?? '',
    },
  };
}
