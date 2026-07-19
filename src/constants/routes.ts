import { getConfig } from '../config/configStore';
import { FALLBACK_ROUTE_COLOR } from '../config/defaults';

/**
 * Per-route color and display-name helpers. These read the runtime config
 * (remote config.json with baked-in fallback), so route restructurings and
 * palette tweaks propagate without an app update. Unknown ids render with the
 * brand-purple fallback and their raw id as the label.
 */

export function routeColor(routeId: string | null | undefined): string {
  if (!routeId) return FALLBACK_ROUTE_COLOR;
  return getConfig().routeById[routeId]?.color ?? FALLBACK_ROUTE_COLOR;
}

export function routeShort(routeId: string | null | undefined): string {
  if (!routeId) return 'Unknown';
  return getConfig().routeById[routeId]?.short ?? routeId.replace(/^CR-/, '');
}

/** Full display name for a route id (config `name`, e.g. "Lowell Line"). */
export function routeName(routeId: string | null | undefined): string {
  if (!routeId) return 'Unknown';
  return getConfig().routeById[routeId]?.name ?? routeId.replace(/^CR-/, '');
}

/**
 * Map a MassGIS COMM_LINE name (bundled line overlay) to a route id, then to
 * that route's config color. The overlay is geographic; a physical line is
 * colored by the route that serves it today.
 */
function lineToRouteId(commLine: string): string | null {
  const l = commLine.toLowerCase();
  if (l.includes('newburyport') || l.includes('rockport')) return 'CR-Newburyport';
  if (l.includes('fitchburg') || l.includes('wildcat')) return 'CR-Fitchburg';
  if (l.includes('lowell')) return 'CR-Lowell';
  if (l.includes('haverhill')) return 'CR-Haverhill';
  if (l.includes('worcester') || l.includes('framingham')) return 'CR-Worcester';
  if (l.includes('cape')) return 'CapeFlyer';
  if (l.includes('foxboro')) return 'CR-Foxboro';
  if (l.includes('franklin')) return 'CR-Franklin';
  if (l.includes('needham')) return 'CR-Needham';
  if (l.includes('providence') || l.includes('stoughton')) return 'CR-Providence';
  // South Coast Rail: Fall River / New Bedford / Middleborough corridor.
  if (l.includes('fall river') || l.includes('new bedford') || l.includes('middleborough')) return 'CR-NewBedford';
  if (l.includes('kingston') || l.includes('plymouth')) return 'CR-Kingston';
  if (l.includes('greenbush')) return 'CR-Greenbush';
  if (l.includes('fairmount')) return 'CR-Fairmount';
  return null;
}

export function lineColor(commLine: string | null | undefined): string {
  if (!commLine) return FALLBACK_ROUTE_COLOR;
  const id = lineToRouteId(commLine);
  return (id && getConfig().routeById[id]?.color) || FALLBACK_ROUTE_COLOR;
}
