/// <reference types="jest" />
import vendored from '../config/config.default.json';
import { DEFAULT_CONFIG } from '../config/defaults';
import { getConfig, useConfigStore } from '../config/configStore';
import { normalizeConfig, validateRawConfig, type RawConfig } from '../config/schema';
import {
  groupUnitsByCategory,
  heritageIconUrl,
  heritageInfo,
  unitCategoryLine,
} from '../constants/heritage';
import { isIconFailed, markIconFailed, resetIconFailures } from '../lib/iconFallback';

/**
 * Config schema v3: categories, owner, optional icon. Covers spec test 1
 * (v3 parses; icon-less unit renders without a broken image; roster groups by
 * category; owner shown for lease entries).
 */

function raw(overrides: Partial<RawConfig> = {}): RawConfig {
  return validateRawConfig({ ...vendored, ...overrides });
}

beforeEach(() => {
  useConfigStore.setState({ config: DEFAULT_CONFIG });
  resetIconFailures();
});

describe('schema v3 parsing', () => {
  test('the vendored live config is v3 and normalizes its new fields', () => {
    expect(vendored.schema_version).toBe(3);

    const lease = heritageInfo('1002');
    expect(lease).toMatchObject({ category: 'lease', categoryLabel: 'Lease power', owner: 'RSTX' });
    expect(unitCategoryLine(lease!)).toBe('Lease power · RSTX');

    // Non-leased units carry a category but no owner, so no trailing mark.
    const heritage = heritageInfo('1030')!;
    expect(heritage.categoryLabel).toBe('Heritage livery');
    expect(heritage.owner).toBeUndefined();
    expect(unitCategoryLine(heritage)).toBe('Heritage livery');

    expect(heritageInfo('1776')?.categoryLabel).toBe('Commemorative scheme');
  });

  test('a newer schema_version still loads — additive bumps must not strand clients', () => {
    // Regression: hard-failing on schema_version > SUPPORTED silently pinned
    // every client to the vendored fallback when the server moved to v3.
    const future = normalizeConfig(
      raw({ schema_version: 99, unknown_future_block: { nope: true } } as Partial<RawConfig>),
      'live',
      DEFAULT_CONFIG,
    );
    expect(future.schemaVersion).toBe(99);
    expect(future.routeIds).toEqual(DEFAULT_CONFIG.routeIds);
    expect(future.heritageUnits).toHaveLength(vendored.heritage_units.length);
  });

  test('a v2-shaped entry (no category/owner) still loads', () => {
    const cfg = normalizeConfig(
      raw({
        heritage_units: [{ unit: '1030', model: 'F40PH-3C', scheme: 'Boston & Maine', icon: 'x.png' }],
      }),
      'live',
      DEFAULT_CONFIG,
    );
    expect(cfg.heritageById['1030']).toMatchObject({ category: '', categoryLabel: 'Other' });
  });

  test('an unknown category id falls back to the raw id as its label', () => {
    const cfg = normalizeConfig(
      raw({ heritage_units: [{ unit: '5000', model: 'M', scheme: 'S', category: 'experimental' }] }),
      'live',
      DEFAULT_CONFIG,
    );
    expect(cfg.heritageById['5000'].categoryLabel).toBe('experimental');
  });
});

describe('icon-less units never render a broken image', () => {
  test('an entry with no icon field yields no icon URL', () => {
    useConfigStore.setState({
      config: normalizeConfig(
        raw({ heritage_units: [{ unit: '1002', model: 'F40PH-3C', scheme: 'RSS', category: 'lease' }] }),
        'live',
        DEFAULT_CONFIG,
      ),
    });
    expect(heritageInfo('1002')?.icon).toBeUndefined();
    // The marker keys off this: undefined -> normal route puck, not an <Image>.
    expect(heritageIconUrl('1002')).toBeUndefined();
  });

  test('an empty/whitespace icon is treated as absent', () => {
    const cfg = normalizeConfig(
      raw({ heritage_units: [{ unit: '1002', model: 'M', scheme: 'S', icon: '   ' }] }),
      'live',
      DEFAULT_CONFIG,
    );
    expect(cfg.heritageById['1002'].icon).toBeUndefined();
  });

  test('a configured icon whose URL fails is remembered and stops being used', () => {
    // The live case: 1002 HAS an icon in config, but /icons/1002.png 403s
    // because the artwork was never uploaded.
    const url = heritageIconUrl('1002');
    expect(url).toBe('https://trains.chrisnewell.net/icons/1002.png');
    expect(isIconFailed(url)).toBe(false);

    markIconFailed(url!); // <Image onError>

    expect(isIconFailed(url)).toBe(true);
    // Other units are unaffected — one 403 must not blank the whole roster.
    expect(isIconFailed(heritageIconUrl('1030'))).toBe(false);
  });

  test('isIconFailed is safe on units that have no icon at all', () => {
    expect(isIconFailed(undefined)).toBe(false);
    expect(isIconFailed(null)).toBe(false);
  });
});

describe('roster grouping', () => {
  const cats = { heritage: 'Heritage livery', commemorative: 'Commemorative', lease: 'Lease power' };
  const u = (unit: string, category: string) =>
    ({ unit, model: 'M', scheme: 'S', category, categoryLabel: '', icon: undefined }) as never;

  test('groups follow the order declared in unit_categories, not roster order', () => {
    const groups = groupUnitsByCategory(
      [u('1002', 'lease'), u('1776', 'commemorative'), u('1030', 'heritage')],
      cats,
    );
    expect(groups.map((g) => g.category)).toEqual(['heritage', 'commemorative', 'lease']);
    expect(groups.map((g) => g.label)).toEqual(['Heritage livery', 'Commemorative', 'Lease power']);
    expect(groups[0].units.map((x) => x.unit)).toEqual(['1030']);
  });

  test('empty categories are dropped', () => {
    const groups = groupUnitsByCategory([u('1030', 'heritage')], cats);
    expect(groups).toHaveLength(1);
  });

  test('unknown and uncategorized units sort last but are never dropped', () => {
    const groups = groupUnitsByCategory([u('9', 'zzz'), u('8', ''), u('1030', 'heritage')], cats);
    expect(groups.map((g) => g.category)).toEqual(['heritage', '', 'zzz']);
    expect(groups.find((g) => g.category === '')?.label).toBe('Other');
    // Every unit survives grouping.
    expect(groups.flatMap((g) => g.units)).toHaveLength(3);
  });

  test('the real roster groups without losing a unit', () => {
    const cfg = getConfig();
    const groups = groupUnitsByCategory(cfg.heritageUnits, cfg.unitCategories);
    expect(groups.flatMap((g) => g.units)).toHaveLength(cfg.heritageUnits.length);
    expect(groups.map((g) => g.label)).toEqual([
      'Heritage livery',
      'Commemorative scheme',
      'Lease power',
    ]);
  });
});

describe('the vendored fallback never ships credentials', () => {
  test('config.default.json carries no mbta_keys block', () => {
    // The live config.json contains real streaming keys. Re-copying it verbatim
    // over the vendored fallback would bake them into the app binary; config is
    // the only permitted source. Strip `mbta_keys` when refreshing this file.
    expect(vendored).not.toHaveProperty('mbta_keys');
    expect(JSON.stringify(vendored)).not.toMatch(/api_?key|_stream/i);
  });
});
