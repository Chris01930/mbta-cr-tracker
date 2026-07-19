/// <reference types="jest" />
import { buildRoster, filterRoster, rosterCounts } from '../lib/roster';
import { trainKey } from '../lib/trains';
import type { Frame, Train } from '../types';

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

function frame(key: string, trains: Train[]): Frame {
  return { key, time: `2026-07-18T12:0${key}:00-04:00`, trains };
}

describe('buildRoster: distinct entities across the day', () => {
  test('one cab across many frames collapses to a single entry with the latest fix', () => {
    const frames = [
      frame('0', [train({ cab: 'A', lat: 42.30, lon: -71.0 })]),
      frame('1', [train({ cab: 'A', lat: 42.31, lon: -71.0 })]),
      frame('2', [train({ cab: 'A', lat: 42.32, lon: -71.0 })]),
    ];
    const roster = buildRoster(frames);
    expect(roster).toHaveLength(1);
    expect(roster[0].train.lat).toBe(42.32); // latest fix wins
    expect(roster[0].frames).toBe(3);
    expect(roster[0].lastFrameIndex).toBe(2);
  });

  test('distinct cabs, non-revenue, and two ghosts are all separate entries', () => {
    const frames = [
      frame('0', [
        train({ cab: 'A' }),
        train({ cab: 'B', isNonRevenue: true }),
        train({ cab: null, vid: '900', isGhost: true }),
        train({ cab: null, vid: '901', isGhost: true }),
      ]),
    ];
    const roster = buildRoster(frames);
    expect(roster).toHaveLength(4);
    expect(new Set(roster.map((r) => r.key)).size).toBe(4);
    expect(roster.find((r) => r.key === trainKey(train({ cab: null, vid: '900', isGhost: true })))).toBeTruthy();
  });

  test('live trains fold in last so their position wins over an earlier frame fix', () => {
    const frames = [frame('0', [train({ cab: 'A', lat: 42.0, lon: -71.0 })])];
    const live = [train({ cab: 'A', lat: 42.9, lon: -71.0 })];
    const roster = buildRoster(frames, live);
    expect(roster).toHaveLength(1);
    expect(roster[0].train.lat).toBe(42.9);
    expect(roster[0].lastFrameIndex).toBe(-1); // most recent fix came from live
  });

  test('non-plottable rows are skipped', () => {
    const frames = [frame('0', [train({ cab: 'A', lat: NaN as unknown as number })])];
    expect(buildRoster(frames)).toHaveLength(0);
  });
});

describe('filterRoster / rosterCounts', () => {
  const frames = [
    frame('0', [
      train({ cab: 'A' }),
      train({ cab: 'B', isNonRevenue: true }),
      train({ cab: null, vid: '900', isGhost: true }),
      train({ cab: null, vid: '901', isGhost: true, isNonRevenue: true }),
    ]),
  ];
  const roster = buildRoster(frames);

  test('counts each class (ghost + non-revenue overlap counted in both)', () => {
    expect(rosterCounts(roster)).toEqual({ all: 4, nonRevenue: 2, ghost: 2 });
  });

  test('ghost filter returns only ghosts', () => {
    const rows = filterRoster(roster, 'ghost');
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.train.isGhost)).toBe(true);
  });

  test('non-revenue filter returns only non-revenue (including a non-revenue ghost)', () => {
    const rows = filterRoster(roster, 'nonRevenue');
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.train.isNonRevenue)).toBe(true);
  });

  test('all filter surfaces ghost/non-revenue entries before ordinary ones', () => {
    const rows = filterRoster(roster, 'all');
    expect(rows).toHaveLength(4);
    // The plain revenue cab 'A' sorts last; the special ones lead.
    expect(rows[rows.length - 1].train.cab).toBe('A');
    expect(rows[0].train.isGhost || rows[0].train.isNonRevenue).toBe(true);
  });
});
