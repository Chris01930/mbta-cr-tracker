/// <reference types="jest" />
import { normalizeDayFrames } from '../api/frames';
import { normalizeVehicles, type JsonApiDoc } from '../api/mbta';
import { buildTrails, type TrailsTuning } from '../lib/trails';
import { dedupeTrains, trainKey, trainLabel, trainTitle } from '../lib/trains';

const CFG: TrailsTuning = { gapBreakMin: 15, maxImpliedMph: 90, maxHopMi: 7, breakOnRouteChange: true };

describe('ghosts: frames path (vid identity)', () => {
  test('two ghosts (distinct vids) + one normal train => three distinct entities', () => {
    const day = normalizeDayFrames({
      frames: [
        {
          key: '1',
          time: 't',
          trains: [
            { cab: '1500', train: '5', route: 'CR-Lowell', lat: 42.6, lon: -71.3, upd: 't' },
            { route: 'CR-Lowell', lat: 42.61, lon: -71.31, upd: 't', vid: '1934' }, // ghost (no cab)
            { route: 'CR-Lowell', lat: 42.62, lon: -71.32, upd: 't', vid: '1935' }, // ghost (no cab)
          ],
        },
      ],
    });

    const trains = day.frames[0].trains;
    expect(trains).toHaveLength(3);

    const normal = trains[0];
    const g1 = trains[1];
    const g2 = trains[2];

    expect(normal.isGhost).toBe(false);
    expect(g1.isGhost).toBe(true);
    expect(g2.isGhost).toBe(true);

    // Distinct tracking keys — two ghosts never merge.
    const keys = trains.map(trainKey);
    expect(new Set(keys).size).toBe(3);
    expect(trainKey(g1)).toBe('vid:1934');
    expect(trainKey(g2)).toBe('vid:1935');

    // Display names.
    expect(trainTitle(normal)).toBe('Cab 1500 · Trn 5');
    expect(trainTitle(g1)).toBe('Ghost 1934');
    expect(trainLabel(g2)).toBe('1935');

    // Dedupe keeps all three (distinct keys); two ghost trails stay separate.
    expect(dedupeTrains(trains)).toHaveLength(3);
    const day2 = normalizeDayFrames({
      frames: [
        { key: '1', time: '2026-07-16T12:00:00-04:00', trains: [ghostRaw('1934', 42.6, -71.3), ghostRaw('1935', 42.7, -71.4)] },
        { key: '2', time: '2026-07-16T12:01:00-04:00', trains: [ghostRaw('1934', 42.601, -71.3), ghostRaw('1935', 42.701, -71.4)] },
      ],
    });
    const trails = buildTrails(day2.frames, CFG);
    expect(trails.features).toHaveLength(2); // one per ghost, not merged
  });
});

describe('ghosts: legacy frames without vid', () => {
  test('vid-less ghost parses and renders without crashing', () => {
    const day = normalizeDayFrames({
      frames: [{ key: '1', time: 't', trains: [{ route: 'CR-Lowell', lat: 42.6, lon: -71.3, upd: 't' }] }],
    });
    const g = day.frames[0].trains[0];
    expect(g.isGhost).toBe(true);
    expect(g.vid).toBeNull();
    // Falls back to a position surrogate key; title is a bare "Ghost".
    expect(trainKey(g)).toBe('pos:42.6,-71.3');
    expect(trainTitle(g)).toBe('Ghost');
    expect(() => dedupeTrains([g])).not.toThrow();
    // No stable identity across frames -> excluded from trails (no crash).
    expect(buildTrails(day.frames, CFG).features).toHaveLength(0);
  });
});

describe('ghosts: live path (resource id identity)', () => {
  test('vehicle with null label is keyed by its resource id', () => {
    const doc: JsonApiDoc = {
      data: [
        {
          id: 'y1934',
          type: 'vehicle',
          attributes: {
            label: null,
            latitude: 42.6,
            longitude: -71.3,
            bearing: 90,
            speed: 5,
            current_status: 'IN_TRANSIT_TO',
            updated_at: 't',
          },
          relationships: { route: { data: { id: 'CR-Lowell', type: 'route' } } },
        },
      ],
    };
    const [g] = normalizeVehicles(doc);
    expect(g.isGhost).toBe(true);
    expect(g.vid).toBe('y1934');
    expect(trainKey(g)).toBe('vid:y1934');
    expect(trainTitle(g)).toBe('Ghost y1934');
  });
});

function ghostRaw(vid: string, lat: number, lon: number) {
  return { route: 'CR-Lowell', lat, lon, upd: 't', vid };
}
