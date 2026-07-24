/// <reference types="jest" />
import { heritageMessage, heritageSightings, newHeritageArrivals, sightingKey } from '../lib/heritageWatch';
import type { HeritagePairs } from '../state/store';
import type { Train } from '../types';

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

// unit -> cab
const HERITAGE: HeritagePairs = { '1030': '1500', '1071': '1600' };

describe('heritageSightings', () => {
  test('returns only trains whose cab is paired to a heritage unit', () => {
    const trains = [
      train({ cab: '1500', route: 'CR-Lowell', dest: 'North Station' }), // paired -> unit 1030
      train({ cab: '1600', route: 'CR-Newburyport', dest: 'Newburyport' }), // paired -> unit 1071
      train({ cab: '1999', route: 'CR-Lowell', dest: 'Lowell' }), // not paired
      train({ cab: null, isGhost: true, vid: 'y1' }), // ghost, no cab
    ];
    const s = heritageSightings(trains, HERITAGE);
    expect(s).toHaveLength(2);
    expect(s.find((x) => x.cab === '1500')).toMatchObject({ unit: '1030', route: 'CR-Lowell', dest: 'North Station' });
    expect(s.find((x) => x.cab === '1600')).toMatchObject({ unit: '1071', dest: 'Newburyport' });
  });

  test('no pairings -> no sightings', () => {
    expect(heritageSightings([train({ cab: '1500' })], {})).toHaveLength(0);
  });

  test('a repeated cab is deduped, keeping the freshest fix', () => {
    const s = heritageSightings(
      [train({ cab: '1500', dest: 'stale' }), train({ cab: '1500', dest: 'North Station' })],
      HERITAGE,
    );
    expect(s).toHaveLength(1);
    expect(s[0].dest).toBe('North Station');
  });
});

describe('newHeritageArrivals (session dedupe)', () => {
  test('only sightings not already seen are new', () => {
    const sightings = heritageSightings(
      [train({ cab: '1500', dest: 'North Station' }), train({ cab: '1600', dest: 'Newburyport' })],
      HERITAGE,
    );
    // Announcement identity is cab AND unit, so a cab carrying a second unit
    // still alerts for the newcomer.
    const seen = new Set(sightings.filter((s) => s.cab === '1500').map(sightingKey));
    const arrivals = newHeritageArrivals(sightings, seen);
    expect(arrivals.map((a) => a.cab)).toEqual(['1600']);
  });

  test('all seen -> nothing new', () => {
    const sightings = heritageSightings([train({ cab: '1500' })], HERITAGE);
    expect(newHeritageArrivals(sightings, new Set(sightings.map(sightingKey)))).toHaveLength(0);
  });

  test('a second unit on an already-announced cab is still new', () => {
    // Cab 1500 carries 1030 (announced) and 1129 (just added by the user).
    const pairs = { ...HERITAGE, '1129': '1500' };
    const sightings = heritageSightings([train({ cab: '1500' })], pairs);
    expect(sightings).toHaveLength(2);
    const seen = new Set(['1500:1030']);
    expect(newHeritageArrivals(sightings, seen).map((a) => a.unit)).toEqual(['1129']);
  });
});

describe('heritageMessage', () => {
  test('title is the loco name; body is route + destination', () => {
    expect(heritageMessage('Boston & Maine 1030', 'Lowell Line', 'North Station')).toEqual({
      title: '🚂 Boston & Maine 1030',
      body: 'Lowell Line · to North Station',
    });
  });

  test('missing destination degrades to route only', () => {
    expect(heritageMessage('New Haven 1071', 'Newburyport Line', null).body).toBe('Newburyport Line');
  });
});
