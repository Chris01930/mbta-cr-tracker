import rawStations from '../data/crStations.json';

/**
 * Nearest-station lookup over the bundled CR station set (MassGIS). Synchronous
 * and local — used to describe a train/unit position as a human place ("Near
 * Winchester Center") without a network round-trip.
 */

interface StationPt {
  name: string;
  lat: number;
  lon: number;
}

const EARTH_MI = 3958.8;

function haversineMi(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_MI * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Title-case a SHOUTY MassGIS station name ("NORTH STATION" -> "North Station"). */
function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

const STATIONS: StationPt[] = (rawStations as GeoJSON.FeatureCollection).features
  .filter((f) => f.geometry?.type === 'Point')
  .map((f) => {
    const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates;
    return { name: titleCase(String((f.properties as { name?: string } | null)?.name ?? 'Station')), lat, lon };
  });

export interface NearestStation {
  name: string;
  distMi: number;
}

/** The closest CR station to a coordinate (or null for invalid input). */
export function nearestStation(lat: number, lon: number): NearestStation | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || STATIONS.length === 0) return null;
  let best: NearestStation | null = null;
  for (const s of STATIONS) {
    const distMi = haversineMi(lat, lon, s.lat, s.lon);
    if (!best || distMi < best.distMi) best = { name: s.name, distMi };
  }
  return best;
}

/** "At Foo" when essentially at the platform, otherwise "Near Foo". */
export function placeLabel(lat: number, lon: number): string | null {
  const st = nearestStation(lat, lon);
  if (!st) return null;
  return `${st.distMi < 0.35 ? 'At' : 'Near'} ${st.name}`;
}
