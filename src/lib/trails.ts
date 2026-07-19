import { routeColor } from '../constants/routes';
import type { Frame } from '../types';

/**
 * Movement trails: polylines of where each cab has been, built from frame
 * history. Fixes are grouped by cab identity and broken into a new segment
 * whenever ANY of the doc's rules trip (route change, > gap, > implied speed,
 * > single-hop distance). Each segment is colored by its own route.
 */

export interface TrailsTuning {
  gapBreakMin: number;
  maxImpliedMph: number;
  maxHopMi: number;
  breakOnRouteChange: boolean;
}

interface Fix {
  lon: number;
  lat: number;
  route: string | null;
  t: number; // epoch ms
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

type TrailFC = GeoJSON.FeatureCollection<GeoJSON.LineString, { color: string }>;

/**
 * Build a GeoJSON FeatureCollection of trail segments from frame history.
 * Grouped by tracking identity — cab label, or the ghost's `vid`. Live ghosts
 * (distinct vids) get distinct trails; pre-2026-07-19 ghosts lack a vid and are
 * skipped (no stable cross-frame identity). `includeGhosts=false` drops ghosts.
 */
export function buildTrails(frames: Frame[], cfg: TrailsTuning, includeGhosts = true): TrailFC {
  // 1. Collect each entity's fixes in time order (skip non-plottable).
  const byId = new Map<string, Fix[]>();
  for (const frame of frames) {
    const frameT = Date.parse(frame.time);
    for (const tr of frame.trains) {
      if (typeof tr.lat !== 'number' || typeof tr.lon !== 'number') continue;
      const isGhost = tr.cab == null;
      if (isGhost && !includeGhosts) continue;
      const id = tr.cab ?? tr.vid ?? null; // vid-less ghost -> no stable trail
      if (!id) continue;
      const t = tr.upd ? Date.parse(tr.upd) : frameT;
      const arr = byId.get(id) ?? [];
      arr.push({ lon: tr.lon, lat: tr.lat, route: tr.route, t: isNaN(t) ? frameT : t });
      byId.set(id, arr);
    }
  }

  const gapMs = cfg.gapBreakMin * 60_000;
  const features: TrailFC['features'] = [];

  for (const fixes of byId.values()) {
    fixes.sort((a, b) => a.t - b.t);

    let seg: Fix[] = [];
    const flush = () => {
      if (seg.length >= 2) {
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: seg.map((f) => [f.lon, f.lat]) },
          properties: { color: routeColor(seg[0].route) },
        });
      }
      seg = [];
    };

    for (const cur of fixes) {
      if (seg.length === 0) {
        seg.push(cur);
        continue;
      }
      const prev = seg[seg.length - 1];
      const dt = cur.t - prev.t;
      if (dt <= 0 && cur.lon === prev.lon && cur.lat === prev.lat) continue; // duplicate
      const dist = haversineMi(prev.lat, prev.lon, cur.lat, cur.lon);
      const dtMin = dt / 60_000;
      const impliedMph = dtMin > 0 ? dist / (dtMin / 60) : Infinity;
      const shouldBreak =
        (cfg.breakOnRouteChange && cur.route !== prev.route) ||
        dt > gapMs ||
        impliedMph > cfg.maxImpliedMph ||
        dist > cfg.maxHopMi;
      if (shouldBreak) flush();
      seg.push(cur);
    }
    flush();
  }

  return { type: 'FeatureCollection', features };
}
