/// <reference types="jest" />
import { buildTrails, type TrailsTuning } from '../lib/trails';
import { routeColor } from '../constants/routes';
import type { Frame, Train } from '../types';

const CFG: TrailsTuning = { gapBreakMin: 15, maxImpliedMph: 90, maxHopMi: 7, breakOnRouteChange: true };

const BASE = Date.parse('2026-07-16T12:00:00-04:00');
const min = (m: number) => new Date(BASE + m * 60_000).toISOString();

// ~0.0101 deg latitude ≈ 0.7 mi; 0.0725 ≈ 5 mi; 0.116 ≈ 8 mi.
function fix(cab: string | null, route: string | null, lat: number, lon: number, upd: string): Train {
  return { cab, train: null, dest: null, route, status: null, lat, lon, brg: null, upd, isNonRevenue: false, isGhost: cab == null };
}
/** One frame per fix (each poll snapshot has the cab at one position). */
function frames(fixes: Train[]): Frame[] {
  return fixes.map((t, i) => ({ key: String(i), time: t.upd as string, trains: [t] }));
}

describe('buildTrails segmentation', () => {
  test('steady same-route movement is one segment, colored by route', () => {
    const fc = buildTrails(
      frames([
        fix('A', 'CR-Lowell', 42.3, -71.0, min(0)),
        fix('A', 'CR-Lowell', 42.3101, -71.0, min(1)),
        fix('A', 'CR-Lowell', 42.3202, -71.0, min(2)),
      ]),
      CFG,
    );
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry.coordinates).toHaveLength(3);
    expect(fc.features[0].properties.color).toBe(routeColor('CR-Lowell'));
    // GeoJSON order is [lon, lat].
    expect(fc.features[0].geometry.coordinates[0]).toEqual([-71.0, 42.3]);
  });

  test('route change breaks into two segments', () => {
    const fc = buildTrails(
      frames([
        fix('A', 'CR-Lowell', 42.3, -71.0, min(0)),
        fix('A', 'CR-Lowell', 42.3101, -71.0, min(1)),
        fix('A', 'CR-Haverhill', 42.3202, -71.0, min(2)),
        fix('A', 'CR-Haverhill', 42.3303, -71.0, min(3)),
      ]),
      CFG,
    );
    expect(fc.features).toHaveLength(2);
    expect(fc.features.map((f) => f.properties.color)).toEqual([
      routeColor('CR-Lowell'),
      routeColor('CR-Haverhill'),
    ]);
  });

  test('a > 15 min gap breaks the trail', () => {
    const fc = buildTrails(
      frames([
        fix('A', 'CR-Lowell', 42.3, -71.0, min(0)),
        fix('A', 'CR-Lowell', 42.3101, -71.0, min(1)),
        fix('A', 'CR-Lowell', 42.3202, -71.0, min(21)), // 20 min gap
        fix('A', 'CR-Lowell', 42.3303, -71.0, min(22)),
      ]),
      CFG,
    );
    expect(fc.features).toHaveLength(2);
  });

  test('a > 7 mi single hop (at plausible speed) breaks the trail', () => {
    const fc = buildTrails(
      frames([
        fix('A', 'CR-Lowell', 42.3, -71.0, min(0)),
        fix('A', 'CR-Lowell', 42.3101, -71.0, min(1)),
        fix('A', 'CR-Lowell', 42.426, -71.0, min(11)), // ~8 mi over 10 min = 48 mph
        fix('A', 'CR-Lowell', 42.4361, -71.0, min(12)),
      ]),
      CFG,
    );
    expect(fc.features).toHaveLength(2);
  });

  test('implied speed > 90 mph breaks the trail', () => {
    const fc = buildTrails(
      frames([
        fix('A', 'CR-Lowell', 42.3, -71.0, min(0)),
        fix('A', 'CR-Lowell', 42.3101, -71.0, min(1)),
        fix('A', 'CR-Lowell', 42.3826, -71.0, min(3)), // ~5 mi over 2 min = 150 mph
        fix('A', 'CR-Lowell', 42.3927, -71.0, min(4)),
      ]),
      CFG,
    );
    expect(fc.features).toHaveLength(2);
  });

  test('ghost (null cab) fixes produce no trail', () => {
    const fc = buildTrails(
      frames([fix(null, 'CR-Lowell', 42.3, -71.0, min(0)), fix(null, 'CR-Lowell', 42.31, -71.0, min(1))]),
      CFG,
    );
    expect(fc.features).toHaveLength(0);
  });
});
