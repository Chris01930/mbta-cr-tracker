/// <reference types="jest" />
import { buildTrails, type TrailsTuning } from '../lib/trails';
import { ALL_VISIBLE, trainVisible, type VisibilityFilter } from '../lib/trains';
import type { Frame, Train } from '../types';

const CFG: TrailsTuning = { gapBreakMin: 15, maxImpliedMph: 90, maxHopMi: 7, breakOnRouteChange: true };

function train(over: Partial<Train> = {}): Train {
  return {
    cab: '1500',
    train: null,
    dest: null,
    route: 'CR-Lowell',
    status: null,
    lat: 42.6,
    lon: -71.3,
    brg: null,
    upd: 't',
    isNonRevenue: false,
    isGhost: false,
    ...over,
  };
}

describe('trainVisible: revenue / non-revenue / ghost filter composition', () => {
  const revenue = train();
  const nonRev = train({ cab: '1501', isNonRevenue: true });
  const ghost = train({ cab: null, vid: '1934', isGhost: true });
  const ghostNonRev = train({ cab: null, vid: '1935', isGhost: true, isNonRevenue: true });

  test('everything visible by default', () => {
    for (const t of [revenue, nonRev, ghost, ghostNonRev]) {
      expect(trainVisible(t, ALL_VISIBLE)).toBe(true);
    }
  });

  test('hiding revenue hides only revenue trains', () => {
    const f: VisibilityFilter = { ghosts: true, revenue: false, nonRevenue: true };
    expect(trainVisible(revenue, f)).toBe(false);
    expect(trainVisible(nonRev, f)).toBe(true);
    expect(trainVisible(ghost, f)).toBe(false); // ghost is revenue here
    expect(trainVisible(ghostNonRev, f)).toBe(true);
  });

  test('hiding non-revenue hides only non-revenue trains', () => {
    const f: VisibilityFilter = { ghosts: true, revenue: true, nonRevenue: false };
    expect(trainVisible(revenue, f)).toBe(true);
    expect(trainVisible(nonRev, f)).toBe(false);
    expect(trainVisible(ghost, f)).toBe(true);
    expect(trainVisible(ghostNonRev, f)).toBe(false);
  });

  test('ghost flag composes with revenue status (both must pass)', () => {
    // Ghosts off: no ghost shows regardless of revenue status.
    const noGhosts: VisibilityFilter = { ghosts: false, revenue: true, nonRevenue: true };
    expect(trainVisible(ghost, noGhosts)).toBe(false);
    expect(trainVisible(ghostNonRev, noGhosts)).toBe(false);
    expect(trainVisible(revenue, noGhosts)).toBe(true);

    // A non-revenue ghost needs both its ghost and non-revenue classes on.
    expect(trainVisible(ghostNonRev, { ghosts: true, revenue: true, nonRevenue: false })).toBe(false);
    expect(trainVisible(ghostNonRev, { ghosts: false, revenue: true, nonRevenue: true })).toBe(false);
    expect(trainVisible(ghostNonRev, { ghosts: true, revenue: true, nonRevenue: true })).toBe(true);
  });
});

describe('buildTrails honors the visibility filter', () => {
  // Two entities across two frames: a revenue cab and a non-revenue cab.
  const frames: Frame[] = [
    {
      key: '1',
      time: '2026-07-18T12:00:00-04:00',
      trains: [
        train({ cab: 'A', lat: 42.3, lon: -71.0, upd: '2026-07-18T12:00:00-04:00' }),
        train({ cab: 'B', isNonRevenue: true, lat: 42.4, lon: -71.0, upd: '2026-07-18T12:00:00-04:00' }),
      ],
    },
    {
      key: '2',
      time: '2026-07-18T12:01:00-04:00',
      trains: [
        train({ cab: 'A', lat: 42.301, lon: -71.0, upd: '2026-07-18T12:01:00-04:00' }),
        train({ cab: 'B', isNonRevenue: true, lat: 42.401, lon: -71.0, upd: '2026-07-18T12:01:00-04:00' }),
      ],
    },
  ];

  test('default filter keeps both trails', () => {
    expect(buildTrails(frames, CFG).features).toHaveLength(2);
  });

  test('hiding non-revenue drops that train’s trail', () => {
    const f: VisibilityFilter = { ghosts: true, revenue: true, nonRevenue: false };
    const fc = buildTrails(frames, CFG, f);
    expect(fc.features).toHaveLength(1); // only the revenue cab remains
  });

  test('hiding revenue drops that train’s trail', () => {
    const f: VisibilityFilter = { ghosts: true, revenue: false, nonRevenue: true };
    expect(buildTrails(frames, CFG, f).features).toHaveLength(1);
  });
});
