import type { RouteInfo, RuntimeConfig } from './schema';

/**
 * Baked-in fallback config, used before the first fetch and whenever
 * config.json is unreachable. Mirrors the authoritative values as of
 * 2026-07-19 so the app behaves identically offline. The live config.json is
 * the source of truth and overrides this at runtime.
 */

function route(
  id: string,
  name: string,
  color: string,
  flags: Partial<Pick<RouteInfo, 'seasonal' | 'eventService' | 'hidden'>> = {},
): RouteInfo {
  return {
    id,
    name,
    color,
    short: name.replace(/\s+Line$/i, '').trim(),
    seasonal: !!flags.seasonal,
    eventService: !!flags.eventService,
    hidden: !!flags.hidden,
  };
}

const DEFAULT_ROUTES: RouteInfo[] = [
  route('CR-Newburyport', 'Newburyport/Rockport Line', '#4b7bd6'),
  route('CR-Fitchburg', 'Fitchburg Line', '#8757c9'),
  route('CR-Lowell', 'Lowell Line', '#2fa4a8'),
  route('CR-Haverhill', 'Haverhill Line', '#c9a227'),
  route('CR-Worcester', 'Framingham/Worcester Line', '#e0a028'),
  route('CR-Franklin', 'Franklin/Foxboro Line', '#3aa676'),
  route('CR-Needham', 'Needham Line', '#b0578f'),
  route('CR-Providence', 'Providence/Stoughton Line', '#d95555'),
  route('CR-NewBedford', 'Fall River/New Bedford Line', '#5b8c3e'),
  route('CR-Kingston', 'Kingston Line', '#7d6bd9'),
  route('CR-Greenbush', 'Greenbush Line', '#3fa0c9'),
  route('CR-Fairmount', 'Fairmount Line', '#c96a3f'),
  route('CR-Foxboro', 'Foxboro Event Service', '#8a8f3c', { eventService: true }),
  route('CapeFlyer', 'CapeFLYER', '#2d7f9e', { seasonal: true, hidden: true }),
];

export const DEFAULT_CONFIG: RuntimeConfig = {
  schemaVersion: 1,
  updated: null,
  source: 'default',

  routes: DEFAULT_ROUTES,
  routeIds: DEFAULT_ROUTES.map((r) => r.id),
  routeFilter: DEFAULT_ROUTES.map((r) => r.id).join(','),
  routeById: Object.fromEntries(DEFAULT_ROUTES.map((r) => [r.id, r])),

  framesBase: 'https://trains.chrisnewell.net/frames/',
  mbtaApi: 'https://api-v3.mbta.com',

  live: {
    pollIntervalMs: 60_000,
    streamWatchdogMs: 60_000,
    staleAfterMs: 120_000,
    frameCommitIntervalMs: 60_000,
    maxSessionFrames: 600,
  },
  trails: {
    gapBreakMin: 15,
    maxImpliedMph: 90,
    maxHopMi: 7,
    breakOnRouteChange: true,
  },
  heritageUnits: ['1030', '1036', '1071', '1129', '1130', '1776'],
  attribution: {
    data: 'Route, schedule, and vehicle data provided by the MBTA / MassDOT. This project is not affiliated with or endorsed by the MBTA.',
    map: 'Basemap © OpenStreetMap contributors',
  },
};

/** Brand purple (MBTA Commuter Rail) — used as the fallback for unknown ids. */
export const FALLBACK_ROUTE_COLOR = '#80276C';
