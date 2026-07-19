/// <reference types="jest" />
import { plottableTrains } from '../api/frames';
import { normalizeVehicles, type JsonApiDoc } from '../api/mbta';
import type { Frame } from '../types';

/**
 * Safety net: the frames-file and live-vehicle decoders must never fail when
 * the backend adds fields we don't know about. Both decode via JSON.parse +
 * explicit field reads (no strict schema), so unknown keys are ignored — these
 * tests lock that in so it can't regress.
 */
describe('decode tolerance — unknown fields never break parsing', () => {
  test('frames-file train with unknown fields parses; known fields intact', () => {
    const frame = {
      key: '120000',
      time: '2026-07-16T12:00:00-04:00',
      trains: [
        {
          cab: '1712',
          train: '159',
          dest: 'Newburyport',
          route: 'CR-Newburyport',
          status: 'IN_TRANSIT_TO',
          lat: 42.6,
          lon: -70.8,
          brg: 135,
          upd: '2026-07-16T12:00:00-04:00',
          // fields the current build doesn't model:
          rev: 'NON_REVENUE',
          someFutureField: { nested: true },
        },
      ],
    } as unknown as Frame;

    expect(() => plottableTrains(frame)).not.toThrow();
    const out = plottableTrains(frame);
    expect(out).toHaveLength(1);
    expect(out[0].cab).toBe('1712');
    expect(out[0].route).toBe('CR-Newburyport');
    expect(out[0].lat).toBe(42.6);
  });

  test('live vehicle with an unknown attribute parses; known fields intact', () => {
    const doc: JsonApiDoc = {
      data: [
        {
          id: '1712',
          type: 'vehicle',
          attributes: {
            label: '1712',
            latitude: 42.6,
            longitude: -70.8,
            bearing: 90,
            speed: 12,
            current_status: 'IN_TRANSIT_TO',
            updated_at: '2026-07-16T12:00:00-04:00',
            // fields the current build doesn't model:
            revenue: 'NON_REVENUE',
            brandNewAttribute: 42,
          },
          relationships: { route: { data: { id: 'CR-Newburyport', type: 'route' } } },
        },
      ],
    };

    expect(() => normalizeVehicles(doc)).not.toThrow();
    const out = normalizeVehicles(doc);
    expect(out).toHaveLength(1);
    expect(out[0].cab).toBe('1712');
    expect(out[0].lat).toBe(42.6);
    expect(out[0].route).toBe('CR-Newburyport');
  });
});
