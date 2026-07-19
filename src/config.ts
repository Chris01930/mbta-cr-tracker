/**
 * Central configuration. Every tunable the guide calls out lives here so the
 * polling-only MVP can be turned into a streaming client later via remote
 * config without touching feature code.
 */

// The Commuter Rail routes (verified against the live API 2026-07-19). This
// filter inherently excludes Shuttle-* bus routes — never widen it to
// route_type=2 (that pulls in replacement buses).
//
// 2025 South Coast Rail restructuring: CR-Middleborough and CR-Stoughton were
// retired, folded into CR-NewBedford and CR-Providence. CR-Foxboro is dedicated
// event service. CapeFlyer (no CR- prefix) is route_type 2 but hidden from the
// default /routes listing — it must be filtered for explicitly; seasonal
// (summer weekends).
export const CR_ROUTES = [
  'CR-Newburyport',
  'CR-Fitchburg',
  'CR-Lowell',
  'CR-Haverhill',
  'CR-Worcester',
  'CR-Franklin',
  'CR-Needham',
  'CR-Providence',
  'CR-NewBedford',
  'CR-Kingston',
  'CR-Greenbush',
  'CR-Fairmount',
  'CR-Foxboro',
  'CapeFlyer',
] as const;

export const CR_ROUTE_FILTER = CR_ROUTES.join(',');

export const CONFIG = {
  /** CloudFront base for the historical archive (frames/YYYY-MM-DD.json). */
  framesBaseUrl: 'https://trains.chrisnewell.net/frames',

  /** MBTA v3 API base (the live plane). */
  mbtaBaseUrl: 'https://api-v3.mbta.com',

  /**
   * MBTA API key for SSE streaming. Empty = polling-only MVP (keyless REST).
   * Hot-enable streaming later by supplying a key here or via remote config.
   */
  mbtaApiKey: '' as string,

  /** Keyless REST poll cadence. The intended cadence per the guide is 60s. */
  pollIntervalMs: 60_000,

  /** Heartbeat thresholds (ms) mirroring the web app's watchdog. */
  heartbeat: {
    amberAfterMs: 60_000, // no fresh data > 60s -> polling/degraded
    redAfterMs: 120_000, // no data > 120s -> stale
  },

  /** In-memory frame history cap for scrub/trails (web uses 600). */
  frameHistoryCap: 600,

  /** Earliest date the CloudFront archive has frames for (Eastern service day). */
  archiveStartDate: '2026-07-14',

  /** Playback: ms between animation ticks, and how many frames a tick advances
   *  at each speed multiplier. */
  playbackTickMs: 200,
  playbackSpeeds: [1, 2, 4, 8] as const,

  /** MapLibre style. Carto Positron is free and keyless; matches web's CARTO. */
  mapStyleUrl: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',

  /** Initial camera: greater Boston / MBTA CR network. */
  initialCenter: [-71.0589, 42.3601] as [number, number],
  initialZoom: 8.2,

  /** Timezone for all display formatting. Handle DST via the tz database. */
  timeZone: 'America/New_York',

  /** MBTA CR brand purple. */
  brandColor: '#80276C',
} as const;

export const IS_STREAMING_ENABLED = () => CONFIG.mbtaApiKey.length > 0;
