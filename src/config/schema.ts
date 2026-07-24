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

/**
 * Notable-unit roster entry (schema v2: objects, not plain strings; schema v3
 * added `category` / `owner` and made `icon` optional).
 *
 * `category` is deliberately a plain string, not a union: labels live in the
 * top-level `unit_categories` map, so the server can introduce a new category
 * without an app update. Unknown ids fall back to the raw id as their label.
 */
export interface RawHeritageUnit {
  unit: string; // road number — the pairing key
  model: string; // authoritative locomotive model designation
  scheme: string; // livery name
  icon?: string; // hosted PNG URL — absent when artwork isn't uploaded yet
  category?: string; // key into unit_categories
  owner?: string; // reporting mark, e.g. RSTX (lease power)
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
  /** category id -> display label (schema v3). */
  unit_categories?: Record<string, string>;
  /**
   * Per-app MBTA v3 streaming keys (one key per app, per MBTA policy). The app
   * reads ONLY `mobile_stream`; `web_stream` belongs to the web client. Empty or
   * absent = keyless polling. Rotation is a config redeploy, so keys are never
   * compiled into the binary.
   */
  mbta_keys?: { web_stream?: string; mobile_stream?: string };
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
  /** undefined when the entry has no artwork — render the normal marker. */
  icon?: string;
  /** Raw category id ('' when the entry predates schema v3). */
  category: string;
  /** Human label from `unit_categories`, falling back to the raw id. */
  categoryLabel: string;
  /** Reporting mark, when the unit is owned by someone other than the MBTA. */
  owner?: string;
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
  /**
   * MBTA streaming key for THIS app (`mbta_keys.mobile_stream`), or '' when the
   * config doesn't supply one. Non-empty enables the SSE path; empty keeps the
   * keyless polling behavior. Config is its only source — never bundled.
   */
  mobileStreamKey: string;

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
  /** category id -> label, in the server's declared order (drives grouping). */
  unitCategories: Record<string, string>;
  attribution: { data: string; map: string };
}

// --- Validation + normalization ----------------------------------------------

/**
 * Highest schema version this build understands.
 *
 * Newer versions are NOT rejected: validation checks only the fields the app
 * actually depends on and ignores everything else, so a v4 config that keeps
 * routes/endpoints/heritage_units intact still loads on this build. Hard-failing
 * on a version bump silently stranded every client on the vendored fallback when
 * the server moved to v3 — additive schema changes must never do that again.
 */
export const SUPPORTED_SCHEMA_VERSION = 3;

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
 * heritage_units), lenient on the rest (per-field fallback in normalize()) and
 * forward-compatible on schema_version — see SUPPORTED_SCHEMA_VERSION.
 */
export function validateRawConfig(value: unknown): RawConfig {
  if (!value || typeof value !== 'object') throw new Error('config not an object');
  const c = value as Partial<RawConfig>;
  if (typeof c.schema_version !== 'number') throw new Error('missing schema_version');
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
    // `icon` is optional as of v3 (artwork may not be uploaded yet) — requiring
    // it would reject the whole config, taking routes and endpoints down too.
    if (!h || typeof h.unit !== 'string' || typeof h.model !== 'string' || typeof h.scheme !== 'string') {
      throw new Error('heritage_units entry missing unit/model/scheme');
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

  const unitCategories: Record<string, string> = raw.unit_categories ?? fallback?.unitCategories ?? {};

  const heritageUnits: HeritageUnitInfo[] = raw.heritage_units.map((h) => {
    const category = typeof h.category === 'string' ? h.category : '';
    return {
      unit: String(h.unit),
      model: h.model,
      scheme: h.scheme,
      // Blank/whitespace icon is the same as no icon: render the normal marker.
      icon: typeof h.icon === 'string' && h.icon.trim() ? h.icon : undefined,
      category,
      categoryLabel: unitCategories[category] ?? (category || 'Other'),
      owner: typeof h.owner === 'string' && h.owner.trim() ? h.owner : undefined,
    };
  });
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
    // No fallback chain: a config that omits the key is explicitly saying
    // "poll", and must be able to switch streaming back off remotely.
    mobileStreamKey: typeof raw.mbta_keys?.mobile_stream === 'string' ? raw.mbta_keys.mobile_stream.trim() : '',
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
    unitCategories,
    attribution: {
      data: raw.attribution?.data ?? fallback?.attribution.data ?? '',
      map: raw.attribution?.map ?? fallback?.attribution.map ?? '',
    },
  };
}
