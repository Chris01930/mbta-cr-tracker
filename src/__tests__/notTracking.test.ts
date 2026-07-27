/// <reference types="jest" />
import {
  DARK_GRACE_MS,
  darkLabel,
  decodeTrainNumber,
  detectNotTracking,
  liveTripIdSet,
} from '../lib/notTracking';
import type { ScheduledTrip } from '../api/mbta';

/**
 * "Not tracking" (dark trains): schedule-driven detection of trips running but
 * absent from the live vehicle feed (CONSIST_AND_UNITS_SPEC-style part 2 list).
 */

const MIN = 60_000;
const NOW = Date.UTC(2026, 6, 26, 15, 0, 0); // fixed "now" for deterministic windows

function trip(over: Partial<ScheduledTrip> = {}): ScheduledTrip {
  // Spread `over` LAST so an explicit routeId: null survives (?? would coerce it
  // back to the default and hide the routeId-fallback path under test).
  return {
    tripId: 't1',
    trainNumber: '100',
    routeId: 'CR-Newburyport',
    headsign: 'Newburyport',
    directionId: 0,
    // Default window: started 20 min ago, ends in 40 min → currently running.
    firstDepartureMs: NOW - 20 * MIN,
    lastArrivalMs: NOW + 40 * MIN,
    stops: [],
    ...over,
  };
}

// --- Train-number decode ----------------------------------------------------

describe('decodeTrainNumber', () => {
  test('parity: even inbound, odd outbound', () => {
    expect(decodeTrainNumber('100')?.direction).toBe('inbound');
    expect(decodeTrainNumber('101')?.direction).toBe('outbound');
  });

  test('hundreds block maps to the line/branch', () => {
    const cases: [string, string, string | null][] = [
      ['33', 'Rockport branch', 'CR-Newburyport'],
      ['150', 'Newburyport branch', 'CR-Newburyport'],
      ['200', 'Haverhill', 'CR-Haverhill'],
      ['300', 'Lowell', 'CR-Lowell'],
      ['400', 'Fitchburg', 'CR-Fitchburg'],
      ['500', 'Worcester', 'CR-Worcester'],
      ['600', 'Needham', 'CR-Needham'],
      ['700', 'Franklin', 'CR-Franklin'],
      ['800', 'Providence', 'CR-Providence'],
      ['900', 'Stoughton', 'CR-Providence'],
    ];
    for (const [num, branch, routeId] of cases) {
      expect(decodeTrainNumber(num)).toMatchObject({ branch, routeId });
    }
  });

  test('four-digit blocks: Kingston/Greenbush/Fairmount/New Bedford/CapeFLYER', () => {
    expect(decodeTrainNumber('1005')).toMatchObject({ branch: 'Kingston', routeId: 'CR-Kingston' });
    expect(decodeTrainNumber('1075')).toMatchObject({ branch: 'Greenbush', routeId: 'CR-Greenbush' });
    expect(decodeTrainNumber('1650')).toMatchObject({ branch: 'Fairmount', routeId: 'CR-Fairmount' });
    expect(decodeTrainNumber('1950')).toMatchObject({ branch: 'New Bedford branch', routeId: 'CR-NewBedford' });
    expect(decodeTrainNumber('2010')).toMatchObject({ branch: 'New Bedford branch', routeId: 'CR-NewBedford' });
    expect(decodeTrainNumber('9910')).toMatchObject({ branch: 'CapeFLYER', routeId: 'CapeFlyer' });
  });

  test('weekend = weekday + 5000: decodes to the same branch, flagged weekend', () => {
    const weekday = decodeTrainNumber('533'); // Worcester, outbound
    const weekend = decodeTrainNumber('5533'); // 533 + 5000
    expect(weekday).toMatchObject({ branch: 'Worcester', weekend: false, direction: 'outbound' });
    expect(weekend).toMatchObject({ branch: 'Worcester', weekend: true, direction: 'outbound' });
  });

  test('non-numeric or empty names decode to null', () => {
    expect(decodeTrainNumber(null)).toBeNull();
    expect(decodeTrainNumber('')).toBeNull();
    expect(decodeTrainNumber('ABC')).toBeNull();
  });
});

// --- Detection --------------------------------------------------------------

describe('detectNotTracking', () => {
  test('all trips tracked -> nothing listed (drives: no badge)', () => {
    const trips = [trip({ tripId: 'a' }), trip({ tripId: 'b' })];
    const live = new Set(['a', 'b']);
    expect(detectNotTracking(trips, live, NOW)).toHaveLength(0);
  });

  test('an active unmatched trip is listed, with dark duration and branch decode', () => {
    const trips = [trip({ tripId: 'x', trainNumber: '33', firstDepartureMs: NOW - 22 * MIN })];
    const [dark] = detectNotTracking(trips, new Set(), NOW);
    expect(dark.tripId).toBe('x');
    expect(dark.darkMs).toBe(22 * MIN);
    expect(darkLabel(dark.darkMs)).toBe('dark for 22 min');
    expect(dark.info).toMatchObject({ branch: 'Rockport branch', direction: 'outbound' });
  });

  test('a zombie vehicle occupying the trip suppresses it', () => {
    // A stale/zombie vehicle still reports this trip id → counts as tracked.
    const trips = [trip({ tripId: 'z' })];
    expect(detectNotTracking(trips, new Set(['z']), NOW)).toHaveLength(0);
  });

  test('trips outside their running window are never listed', () => {
    const notYet = trip({ tripId: 'future', firstDepartureMs: NOW + 30 * MIN, lastArrivalMs: NOW + 90 * MIN });
    const done = trip({ tripId: 'past', firstDepartureMs: NOW - 120 * MIN, lastArrivalMs: NOW - 30 * MIN });
    expect(detectNotTracking([notYet, done], new Set(), NOW)).toHaveLength(0);
  });

  test('the 5-minute pre-departure grace opens the window early', () => {
    const soon = trip({
      tripId: 'soon',
      firstDepartureMs: NOW + 4 * MIN, // within the grace
      lastArrivalMs: NOW + 60 * MIN,
    });
    const [dark] = detectNotTracking([soon], new Set(), NOW, DARK_GRACE_MS);
    expect(dark?.tripId).toBe('soon');
    expect(darkLabel(dark.darkMs)).toBe('due'); // before scheduled departure
  });

  test('sorted longest-dark first', () => {
    const trips = [
      trip({ tripId: 'young', firstDepartureMs: NOW - 5 * MIN }),
      trip({ tripId: 'old', firstDepartureMs: NOW - 90 * MIN }),
      trip({ tripId: 'mid', firstDepartureMs: NOW - 40 * MIN }),
    ];
    expect(detectNotTracking(trips, new Set(), NOW).map((d) => d.tripId)).toEqual(['old', 'mid', 'young']);
  });

  test('weekend +5000 numbers decode in a listed row', () => {
    const trips = [trip({ tripId: 'wk', trainNumber: '5533', firstDepartureMs: NOW - 10 * MIN })];
    const [dark] = detectNotTracking(trips, new Set(), NOW);
    expect(dark.info).toMatchObject({ branch: 'Worcester', weekend: true });
  });

  test('next 2-3 upcoming stops are attached, past stops dropped', () => {
    const trips = [
      trip({
        tripId: 's',
        firstDepartureMs: NOW - 30 * MIN,
        stops: [
          { name: 'Already Passed', timeMs: NOW - 15 * MIN },
          { name: 'Next', timeMs: NOW + 3 * MIN },
          { name: 'After', timeMs: NOW + 12 * MIN },
          { name: 'Later', timeMs: NOW + 20 * MIN },
          { name: 'Terminal', timeMs: NOW + 30 * MIN },
        ],
      }),
    ];
    const [dark] = detectNotTracking(trips, new Set(), NOW);
    expect(dark.nextStops.map((s) => s.name)).toEqual(['Next', 'After', 'Later']);
  });

  test('routeId falls back to the number decode when the schedule lacks one', () => {
    const trips = [trip({ tripId: 'n', routeId: null, trainNumber: '305' })];
    const [dark] = detectNotTracking(trips, new Set(), NOW);
    expect(dark.routeId).toBe('CR-Lowell');
  });
});

describe('liveTripIdSet', () => {
  test('collects non-null trip ids from live trains', () => {
    const set = liveTripIdSet([{ tripId: 'a' }, { tripId: null }, { tripId: 'b' }, {}]);
    expect([...set].sort()).toEqual(['a', 'b']);
  });
});

describe('darkLabel', () => {
  test('minutes, hours, and multi-day formats', () => {
    expect(darkLabel(0)).toBe('due');
    expect(darkLabel(22 * MIN)).toBe('dark for 22 min');
    expect(darkLabel(65 * MIN)).toBe('dark for 1h 5m');
    expect(darkLabel(8 * 24 * 60 * MIN + 3 * 60 * MIN)).toBe('dark for 8d 3h');
  });
});
