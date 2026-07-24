/// <reference types="jest" />
import vendored from '../config/config.default.json';
import { DEFAULT_CONFIG } from '../config/defaults';
import { useConfigStore } from '../config/configStore';
import { normalizeConfig, validateRawConfig } from '../config/schema';
import { IS_STREAMING_ENABLED, streamKey } from '../config';
import { streamUrl } from '../api/mbtaStream';
import { applyStreamMessage, cacheTrip, createStreamState, streamTrains } from '../api/vehicleStream';
import { createSseParser } from '../lib/sse';

/**
 * Streaming enablement: the key comes from config alone, every URL derives from
 * config endpoints, and the SSE event semantics behave per the integration doc.
 */

// Node globals declared locally rather than importing 'fs': the project has no
// @types/node, and adding it would pull Node's globals into a React Native
// codebase (its setInterval/Timeout typings in particular) for one test's sake.
declare const __dirname: string;
declare function require(id: string): { readFileSync(path: string, encoding: string): string };

const readSource = (file: string): string =>
  require('fs').readFileSync(`${__dirname}/../../${file}`, 'utf8');

const KEY = 'test-key-0000';

function loadConfig(overrides: Record<string, unknown> = {}) {
  useConfigStore.setState({
    config: normalizeConfig(validateRawConfig({ ...vendored, ...overrides }), 'live', DEFAULT_CONFIG),
  });
}

function vehicle(id: string, label: string, tripId?: string) {
  return {
    id,
    type: 'vehicle',
    attributes: {
      label,
      latitude: 42.5,
      longitude: -71.1,
      bearing: 90,
      speed: null,
      current_status: 'IN_TRANSIT_TO',
      updated_at: '2026-07-23T10:00:00-04:00',
    },
    relationships: {
      route: { data: { id: 'CR-Lowell', type: 'route' } },
      ...(tripId ? { trip: { data: { id: tripId, type: 'trip' } } } : {}),
    },
  };
}

const trip = (id: string, name: string) => ({
  id,
  type: 'trip',
  attributes: { name, headsign: 'North Station' },
});

beforeEach(() => {
  useConfigStore.setState({ config: DEFAULT_CONFIG });
});

describe('the key comes from config and nowhere else', () => {
  test('the vendored fallback ships no key, so a cold launch polls', () => {
    expect(DEFAULT_CONFIG.mobileStreamKey).toBe('');
    expect(IS_STREAMING_ENABLED()).toBe(false);
  });

  test('a config carrying mbta_keys.mobile_stream enables streaming', () => {
    loadConfig({ mbta_keys: { mobile_stream: KEY, web_stream: 'the-web-apps-key' } });
    expect(streamKey()).toBe(KEY);
    expect(IS_STREAMING_ENABLED()).toBe(true);
  });

  test('the web app’s key is never used, even when mobile’s is absent', () => {
    loadConfig({ mbta_keys: { web_stream: 'the-web-apps-key' } });
    expect(streamKey()).toBe('');
    expect(IS_STREAMING_ENABLED()).toBe(false);
  });

  test('an empty or whitespace key means polling', () => {
    loadConfig({ mbta_keys: { mobile_stream: '   ' } });
    expect(IS_STREAMING_ENABLED()).toBe(false);
  });

  test('removing the key remotely switches streaming back off', () => {
    loadConfig({ mbta_keys: { mobile_stream: KEY } });
    expect(IS_STREAMING_ENABLED()).toBe(true);
    loadConfig({}); // next config.json has no mbta_keys at all
    expect(IS_STREAMING_ENABLED()).toBe(false);
  });
});

describe('stream URL derives entirely from config', () => {
  test('host, route filter and key all come from the loaded config', () => {
    loadConfig({ mbta_keys: { mobile_stream: KEY } });
    const url = new URL(streamUrl());

    expect(url.origin).toBe('https://api-v3.mbta.com');
    expect(url.pathname).toBe('/vehicles');
    expect(url.searchParams.get('filter[route]')).toBe(useConfigStore.getState().config.routeFilter);
    expect(url.searchParams.get('include')).toBe('trip');
    expect(url.searchParams.get('api_key')).toBe(KEY);
  });

  test('filter[route] is built from routes[], not a hardcoded list', () => {
    loadConfig({
      routes: [
        { id: 'CR-Foo', name: 'Foo Line', color: '#111111' },
        { id: 'CR-Bar', name: 'Bar Line', color: '#222222' },
      ],
      mbta_keys: { mobile_stream: KEY },
    });
    expect(new URL(streamUrl()).searchParams.get('filter[route]')).toBe('CR-Foo,CR-Bar');
  });

  test('a proxy base in config repoints the stream with no code change', () => {
    loadConfig({
      endpoints: { ...vendored.endpoints, mbta_api: 'https://proxy.example.net/mbta' },
      mbta_keys: { mobile_stream: KEY },
    });
    const url = new URL(streamUrl());
    expect(url.origin).toBe('https://proxy.example.net');
    expect(url.pathname).toBe('/mbta/vehicles');
  });
});

describe('no MBTA host or route list is written down in code', () => {
  // A server-side proxy base may replace endpoints.mbta_api later; the app must
  // migrate by config alone. Scan the sources rather than trusting review.
  const files = [
    'src/api/mbta.ts',
    'src/api/mbtaStream.ts',
    'src/api/vehicleStream.ts',
    'src/api/frames.ts',
    'src/hooks/useLiveSession.ts',
    'src/config.ts',
  ];

  test.each(files)('%s hardcodes no MBTA host', (file) => {
    const src = readSource(file);
    // Strip comments: the doc-comments legitimately name the endpoints.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/api-v3\.mbta\.com/);
    expect(code).not.toMatch(/trains\.chrisnewell\.net/);
  });

  test.each(files)('%s hardcodes no route ids', (file) => {
    const src = readSource(file);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/['"`]CR-[A-Za-z]+/);
    expect(code).not.toMatch(/CapeFlyer/);
  });
});

describe('SSE framing', () => {
  test('parses a complete event', () => {
    const p = createSseParser();
    expect(p.feed('event: reset\ndata: [1,2]\n\n')).toEqual([{ event: 'reset', data: '[1,2]' }]);
  });

  test('reassembles an event split across chunk boundaries', () => {
    const p = createSseParser();
    expect(p.feed('event: upd')).toEqual([]);
    expect(p.feed('ate\ndata: {"a"')).toEqual([]);
    expect(p.feed(':1}\n\n')).toEqual([{ event: 'update', data: '{"a":1}' }]);
  });

  test('emits several events arriving in one chunk', () => {
    const p = createSseParser();
    const msgs = p.feed('event: add\ndata: 1\n\nevent: remove\ndata: 2\n\n');
    expect(msgs.map((m) => m.event)).toEqual(['add', 'remove']);
  });

  test('joins multi-line data and tolerates CRLF', () => {
    const p = createSseParser();
    expect(p.feed('event: reset\r\ndata: line1\r\ndata: line2\r\n\r\n')).toEqual([
      { event: 'reset', data: 'line1\nline2' },
    ]);
  });

  test('ignores comment heartbeats without emitting', () => {
    const p = createSseParser();
    expect(p.feed(': keep-alive\n\n')).toEqual([]);
  });

  test('holds an unterminated tail in the buffer', () => {
    const p = createSseParser();
    p.feed('event: add\ndata: {"partial"');
    expect(p.pending()).toBeGreaterThan(0);
  });
});

describe('stream event semantics', () => {
  const msg = (event: string, payload: unknown) => ({ event, data: JSON.stringify(payload) });

  test('reset replaces the vehicle set and caches trips mixed into it', () => {
    const s = createStreamState();
    applyStreamMessage(s, msg('reset', [vehicle('v1', '1700', 't1'), trip('t1', '384')]));

    const trains = streamTrains(s);
    expect(trains).toHaveLength(1);
    expect(trains[0]).toMatchObject({ cab: '1700', train: '384', dest: 'North Station' });

    // A second reset replaces vehicles outright...
    applyStreamMessage(s, msg('reset', [vehicle('v2', '1800', 't1')]));
    expect(streamTrains(s).map((t) => t.cab)).toEqual(['1800']);
    // ...but keeps the trip cache, so the name survives the reconnect.
    expect(streamTrains(s)[0].train).toBe('384');
  });

  test('add, update and remove each apply to one vehicle', () => {
    const s = createStreamState();
    applyStreamMessage(s, msg('reset', [vehicle('v1', '1700')]));

    applyStreamMessage(s, msg('add', vehicle('v2', '1800')));
    expect(streamTrains(s).map((t) => t.cab).sort()).toEqual(['1700', '1800']);

    const moved = vehicle('v2', '1800');
    moved.attributes.latitude = 43.9;
    applyStreamMessage(s, msg('update', moved));
    expect(streamTrains(s).find((t) => t.cab === '1800')?.lat).toBe(43.9);

    applyStreamMessage(s, msg('remove', { id: 'v2', type: 'vehicle' }));
    expect(streamTrains(s).map((t) => t.cab)).toEqual(['1700']);
  });

  test('reports trip ids it has never seen so the caller can fetch them', () => {
    const s = createStreamState();
    const { missingTripIds } = applyStreamMessage(s, msg('reset', [vehicle('v1', '1700', 't-unknown')]));
    expect(missingTripIds).toEqual(['t-unknown']);
    // Until it resolves the vehicle still renders, just without a train number.
    expect(streamTrains(s)[0]).toMatchObject({ cab: '1700', train: null });

    cacheTrip(s, 't-unknown', { name: '505', headsign: 'Lowell' });
    expect(streamTrains(s)[0]).toMatchObject({ train: '505', dest: 'Lowell' });
    // Already cached now, so it isn't requested again.
    expect(applyStreamMessage(s, msg('update', vehicle('v1', '1700', 't-unknown'))).missingTripIds).toEqual([]);
  });

  test('a removal for an unknown id is a no-op, not a crash', () => {
    const s = createStreamState();
    expect(applyStreamMessage(s, msg('remove', { id: 'nope', type: 'vehicle' })).changed).toBe(false);
  });

  test('malformed and unknown events are survivable', () => {
    const s = createStreamState();
    applyStreamMessage(s, msg('reset', [vehicle('v1', '1700')]));
    expect(applyStreamMessage(s, { event: 'update', data: 'not json{' }).changed).toBe(false);
    expect(applyStreamMessage(s, msg('someFutureEvent', { id: 'x' })).changed).toBe(false);
    expect(streamTrains(s)).toHaveLength(1); // state intact
  });

  test('vehicles without a position are dropped, matching the polling path', () => {
    const s = createStreamState();
    const noPos = vehicle('v1', '1700');
    (noPos.attributes as Record<string, unknown>).latitude = null;
    applyStreamMessage(s, msg('reset', [noPos]));
    expect(streamTrains(s)).toHaveLength(0);
  });
});
