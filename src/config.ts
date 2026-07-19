/**
 * Static app configuration — values that don't change at runtime. Anything the
 * server can retune (route list, colors, endpoints, live/trails tuning,
 * heritage units) now lives in the runtime config (see src/config/) sourced
 * from config.json with baked-in defaults.
 */

export const CONFIG = {
  /**
   * MBTA API key for SSE streaming. Empty = polling-only MVP (keyless REST).
   * Hot-enable streaming later by supplying a key here or via remote config.
   */
  mbtaApiKey: '' as string,

  /** Earliest date the CloudFront archive has frames for (Eastern service day). */
  archiveStartDate: '2026-07-14',

  /** Playback: ms between animation ticks, and the available speed multipliers. */
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
