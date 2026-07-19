/// <reference types="jest" />
import AsyncStorage from '@react-native-async-storage/async-storage';
import vendored from '../config/config.default.json';
import { DEFAULT_CONFIG, FALLBACK_ROUTE_COLOR } from '../config/defaults';
import { getConfig, useConfigStore } from '../config/configStore';
import { routeColor, routeName, routeShort } from '../constants/routes';
import { heritageIconUrl, heritageInfo, heritageName, heritageUnits } from '../constants/heritage';

function mockFetchResolved(json: unknown, ok = true) {
  globalThis.fetch = jest.fn().mockResolvedValue({ ok, json: async () => json }) as unknown as typeof fetch;
}
function mockFetchRejected() {
  globalThis.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
}

beforeEach(async () => {
  // Reset the singleton store + cache before each test.
  useConfigStore.setState({ config: DEFAULT_CONFIG });
  await AsyncStorage.clear();
});

describe('runtime config: fetch failure -> fallback', () => {
  test('offline with no cache falls back to the vendored default config', async () => {
    mockFetchRejected();

    await useConfigStore.getState().hydrate(); // no cache present
    await useConfigStore.getState().refresh(); // network fails

    const cfg = getConfig();
    expect(cfg.source).toBe('default');
    // Fallback carries the full vendored route list + heritage roster.
    expect(cfg.routeFilter).toBe(DEFAULT_CONFIG.routeFilter);
    expect(cfg.routeIds).toContain('CR-NewBedford'); // new route present
    expect(cfg.routeIds).not.toContain('CR-Middleborough'); // retired route absent
    expect(cfg.heritageUnits).toHaveLength(vendored.heritage_units.length);
  });
});

describe('runtime config: unknown route id renders gracefully', () => {
  test('unknown id gets the fallback color and its raw id as the label', () => {
    expect(routeColor('CR-DoesNotExist')).toBe(FALLBACK_ROUTE_COLOR);
    expect(routeShort('CR-DoesNotExist')).toBe('DoesNotExist'); // strips CR- prefix
    expect(routeShort('CapeUnknown')).toBe('CapeUnknown'); // non-CR id passes through
    expect(routeName('CR-DoesNotExist')).toBe('DoesNotExist');
  });

  test('known routes use config color + name', () => {
    expect(routeColor('CR-Newburyport')).toBe('#4b7bd6');
    expect(routeShort('CR-Newburyport')).toBe('Newburyport/Rockport');
  });
});

describe('heritage roster: config is authoritative', () => {
  test('models come only from config (old hardcoded names are gone)', () => {
    // 1030 was previously mislabeled "HSP46 1030"; config says F40PH-3C.
    expect(heritageInfo('1030')?.model).toBe('F40PH-3C');
    expect(heritageName('1030')).toBe('Boston & Maine 1030');
  });

  test('a new unit from config appears end-to-end with zero code changes', async () => {
    const newUnit = {
      unit: '9999',
      model: 'TestLoco X',
      scheme: 'Test Livery',
      icon: 'https://trains.chrisnewell.net/icons/9999.png',
    };
    const liveConfig = { ...vendored, heritage_units: [...vendored.heritage_units, newUnit] };
    mockFetchResolved(liveConfig);

    await useConfigStore.getState().refresh();

    expect(getConfig().source).toBe('live');
    // The roster the UI renders from now includes the new unit...
    expect(heritageUnits().some((u) => u.unit === '9999')).toBe(true);
    // ...with its model/scheme/icon sourced from config.
    expect(heritageInfo('9999')?.model).toBe('TestLoco X');
    expect(heritageName('9999')).toBe('Test Livery 9999');
    expect(heritageIconUrl('9999')).toBe(newUnit.icon);
    // An unknown (unpaired) number still resolves gracefully.
    expect(heritageIconUrl('4242')).toBeUndefined();
    expect(heritageName('4242')).toBe('Unit 4242');
  });
});
