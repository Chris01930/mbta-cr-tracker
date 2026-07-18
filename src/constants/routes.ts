/**
 * Stable per-route palette and display names. The web app assigns colors
 * dynamically in first-seen order; we define a stable palette instead so a
 * given line always renders the same color across sessions.
 */

export interface RouteMeta {
  id: string;
  short: string;
  color: string;
}

export const ROUTE_META: Record<string, RouteMeta> = {
  'CR-Newburyport': { id: 'CR-Newburyport', short: 'Newburyport/Rockport', color: '#D62728' },
  'CR-Fitchburg': { id: 'CR-Fitchburg', short: 'Fitchburg', color: '#2CA02C' },
  'CR-Lowell': { id: 'CR-Lowell', short: 'Lowell', color: '#FF7F0E' },
  'CR-Haverhill': { id: 'CR-Haverhill', short: 'Haverhill', color: '#8C564B' },
  'CR-Worcester': { id: 'CR-Worcester', short: 'Framingham/Worcester', color: '#1F77B4' },
  'CR-Franklin': { id: 'CR-Franklin', short: 'Franklin/Foxboro', color: '#9467BD' },
  'CR-Needham': { id: 'CR-Needham', short: 'Needham', color: '#E377C2' },
  'CR-Providence': { id: 'CR-Providence', short: 'Providence/Stoughton', color: '#17BECF' },
  'CR-Stoughton': { id: 'CR-Stoughton', short: 'Stoughton', color: '#17BECF' },
  'CR-Middleborough': { id: 'CR-Middleborough', short: 'Middleborough/Lakeville', color: '#BCBD22' },
  'CR-Kingston': { id: 'CR-Kingston', short: 'Kingston', color: '#7F7F7F' },
  'CR-Greenbush': { id: 'CR-Greenbush', short: 'Greenbush', color: '#393B79' },
  'CR-Fairmount': { id: 'CR-Fairmount', short: 'Fairmount', color: '#E7BA52' },
};

const FALLBACK_COLOR = '#80276C'; // brand purple for unknown/ghost routes

export function routeColor(routeId: string | null | undefined): string {
  if (!routeId) return FALLBACK_COLOR;
  return ROUTE_META[routeId]?.color ?? FALLBACK_COLOR;
}

export function routeShort(routeId: string | null | undefined): string {
  if (!routeId) return 'Unknown';
  return ROUTE_META[routeId]?.short ?? routeId.replace(/^CR-/, '');
}

/**
 * Map MassGIS COMM_LINE names (bundled line GeoJSON) to a color. These names
 * differ from MBTA route ids, so we key on substrings of the line label.
 */
export function lineColor(commLine: string | null | undefined): string {
  if (!commLine) return FALLBACK_COLOR;
  const l = commLine.toLowerCase();
  if (l.includes('newburyport') || l.includes('rockport')) return ROUTE_META['CR-Newburyport'].color;
  if (l.includes('fitchburg') || l.includes('wildcat')) return ROUTE_META['CR-Fitchburg'].color;
  if (l.includes('lowell')) return ROUTE_META['CR-Lowell'].color;
  if (l.includes('haverhill')) return ROUTE_META['CR-Haverhill'].color;
  if (l.includes('worcester') || l.includes('framingham')) return ROUTE_META['CR-Worcester'].color;
  if (l.includes('franklin') || l.includes('foxboro')) return ROUTE_META['CR-Franklin'].color;
  if (l.includes('needham')) return ROUTE_META['CR-Needham'].color;
  if (l.includes('providence') || l.includes('stoughton')) return ROUTE_META['CR-Providence'].color;
  if (l.includes('fall river') || l.includes('new bedford')) return ROUTE_META['CR-Middleborough'].color;
  if (l.includes('kingston') || l.includes('middleborough')) return ROUTE_META['CR-Kingston'].color;
  if (l.includes('greenbush')) return ROUTE_META['CR-Greenbush'].color;
  if (l.includes('fairmount')) return ROUTE_META['CR-Fairmount'].color;
  return FALLBACK_COLOR;
}
