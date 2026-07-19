/// <reference types="jest" />
import { normalizeDayFrames } from '../api/frames';
import { normalizeVehicles, type JsonApiDoc, type JsonApiResource } from '../api/mbta';
import { heritageIconOpacity, puckAppearance } from '../lib/markerStyle';

/**
 * `rev` / `revenue` -> isNonRevenue on both decode paths, and the marker style
 * differs for non-revenue trains. Field is display-only; absent => revenue.
 */
describe('non-revenue: frames path (train.rev)', () => {
  test('rev, no-rev, and unknown-field trains all parse with correct isNonRevenue', () => {
    const day = normalizeDayFrames({
      date: '2026-07-16',
      updated: '2026-07-16T22:00:00-04:00',
      frames: [
        {
          key: '120000',
          time: '2026-07-16T12:00:00-04:00',
          trains: [
            { cab: '1500', route: 'CR-Lowell', lat: 42.6, lon: -71.3, upd: 'x', rev: 'NON_REVENUE' },
            { cab: '1501', route: 'CR-Lowell', lat: 42.6, lon: -71.3, upd: 'x' }, // absent => revenue
            { cab: '1502', route: 'CR-Lowell', lat: 42.6, lon: -71.3, upd: 'x', somethingNew: true }, // unknown field
          ],
        },
      ],
    });

    const trains = day.frames[0].trains;
    expect(trains).toHaveLength(3);
    expect(trains.find((t) => t.cab === '1500')?.isNonRevenue).toBe(true);
    expect(trains.find((t) => t.cab === '1501')?.isNonRevenue).toBe(false);
    expect(trains.find((t) => t.cab === '1502')?.isNonRevenue).toBe(false);
  });

  test('frames written before the field existed => everything revenue', () => {
    const day = normalizeDayFrames({
      frames: [{ key: '1', time: 't', trains: [{ cab: '1', route: 'CR-Lowell', lat: 1, lon: 1, upd: 't' }] }],
    });
    expect(day.frames[0].trains[0].isNonRevenue).toBe(false);
  });
});

describe('non-revenue: live path (attributes.revenue)', () => {
  test('NON_REVENUE, REVENUE, and unknown-attribute vehicles all parse correctly', () => {
    const doc: JsonApiDoc = {
      data: [
        vehicle('1500', 'NON_REVENUE'),
        vehicle('1501', 'REVENUE'),
        vehicle('1502', undefined, { futureAttr: 'x' }), // revenue absent + unknown attr
      ],
    };
    const trains = normalizeVehicles(doc);
    expect(trains).toHaveLength(3);
    expect(trains.find((t) => t.cab === '1500')?.isNonRevenue).toBe(true);
    expect(trains.find((t) => t.cab === '1501')?.isNonRevenue).toBe(false);
    expect(trains.find((t) => t.cab === '1502')?.isNonRevenue).toBe(false);
  });
});

describe('non-revenue: marker style differs', () => {
  test('standard marker is a solid dot vs a hollow ring', () => {
    const revenue = puckAppearance('#4b7bd6', false, false);
    const nonRev = puckAppearance('#4b7bd6', true, false);
    // revenue: solid dot filled with the route color
    expect(revenue.backgroundColor).toBe('#4b7bd6');
    // non-revenue: hollow ring — dark center, route-colored outline + chevron
    expect(nonRev.backgroundColor).not.toBe(revenue.backgroundColor);
    expect(nonRev.borderColor).toBe('#4b7bd6');
    expect(nonRev.chevronColor).toBe('#4b7bd6');
  });

  test('heritage icon is dimmed when non-revenue', () => {
    expect(heritageIconOpacity(false)).toBe(1);
    expect(heritageIconOpacity(true)).toBeLessThan(1);
  });
});

function vehicle(
  label: string,
  revenue: string | undefined,
  extraAttrs: Record<string, unknown> = {},
): JsonApiResource {
  return {
    id: label,
    type: 'vehicle',
    attributes: {
      label,
      latitude: 42.6,
      longitude: -71.3,
      bearing: 90,
      speed: 10,
      current_status: 'IN_TRANSIT_TO',
      updated_at: 't',
      ...(revenue ? { revenue } : {}),
      ...extraAttrs,
    },
    relationships: { route: { data: { id: 'CR-Lowell', type: 'route' } } },
  };
}
