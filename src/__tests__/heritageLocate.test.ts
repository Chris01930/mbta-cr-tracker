/// <reference types="jest" />
import { locateCab } from '../lib/heritageLocate';
import { nearestStation } from '../lib/stations';
import type { Frame, Train } from '../types';

function train(cab: string, lat: number, lon: number, upd: string): Train {
  return {
    cab, train: null, dest: null, route: 'CR-Lowell', status: null,
    lat, lon, brg: null, upd, isNonRevenue: false, isGhost: false,
  };
}
function frame(time: string, trains: Train[]): Frame {
  return { key: time, time, trains };
}

const T = (h: number, m: number) => `2026-07-21T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-04:00`;
const ms = (h: number, m: number) => Date.parse(T(h, m));

describe('locateCab', () => {
  const frames = [
    frame(T(8, 0), [train('1500', 42.60, -71.30, T(8, 0))]),
    frame(T(9, 0), [train('1500', 42.55, -71.20, T(9, 0)), train('1600', 42.4, -71.1, T(9, 0))]),
    frame(T(10, 0), [train('1600', 42.36, -71.06, T(10, 0))]), // 1500 gone by 10:00
  ];

  test('current: cab present in the displayed instant', () => {
    const current = [train('1500', 42.50, -71.15, T(10, 0))];
    const loc = locateCab('1500', frames, ms(10, 0), current);
    expect(loc).toMatchObject({ lat: 42.5, lon: -71.15, isCurrent: true });
    expect(loc?.timeMs).toBe(ms(10, 0)); // stamped with the current displayed time
  });

  test('last known: most recent fix at/before current time when not active', () => {
    const loc = locateCab('1500', frames, ms(10, 0), []); // not in current instant
    expect(loc).toMatchObject({ lat: 42.55, lon: -71.2, isCurrent: false });
    expect(loc?.timeMs).toBe(ms(9, 0)); // the 9:00 fix, not the 8:00 one
  });

  test('respects the current time cutoff (playback scrubbed back)', () => {
    // At 8:30 only the 8:00 fix has happened yet.
    const loc = locateCab('1500', frames, ms(8, 30), []);
    expect(loc?.timeMs).toBe(ms(8, 0));
    expect(loc).toMatchObject({ lat: 42.6, lon: -71.3 });
  });

  test('never seen today -> null', () => {
    expect(locateCab('9999', frames, ms(10, 0), [])).toBeNull();
  });

  test('non-plottable fixes are skipped', () => {
    const bad = [frame(T(9, 0), [train('1500', NaN as unknown as number, -71.2, T(9, 0))])];
    expect(locateCab('1500', bad, ms(10, 0), [])).toBeNull();
  });
});

describe('nearestStation', () => {
  test('resolves a coordinate to the closest CR station', () => {
    // North Station, Boston (~42.3655, -71.0611).
    const st = nearestStation(42.3655, -71.0611);
    expect(st).not.toBeNull();
    expect(st!.name.toLowerCase()).toContain('north station');
    expect(st!.distMi).toBeLessThan(0.5);
  });

  test('invalid input -> null', () => {
    expect(nearestStation(NaN, -71)).toBeNull();
  });
});
