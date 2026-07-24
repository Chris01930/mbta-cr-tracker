/// <reference types="jest" />
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getConfig } from '../config/configStore';
import { useStore, displayUnitsForCab, unitsByCab } from '../state/store';
import {
  assignOutcome,
  canReduceCapacity,
  capacityFor,
  describeDesignation,
  isRostered,
  isStale,
  newDesignation,
  orderedUnitsOnCab,
  positionLabel,
  primaryUnitForCab,
  prunePositions,
  unitsOnCab,
  STALE_AFTER_MS,
  type Designation,
} from '../lib/consists';

/**
 * Consist designations and the assignment-capacity rules they govern
 * (CONSIST_AND_UNITS_SPEC.md parts B-E).
 */

const DAY = 24 * 60 * 60 * 1000;

/** A designation as the store would build it. */
function designation(cab: string, over: Partial<Designation> = {}): Designation {
  return { ...newDesignation(cab, 'sandwich', Date.now()), ...over };
}

function reset(state: Partial<ReturnType<typeof useStore.getState>> = {}) {
  useStore.setState({ heritage: {}, designations: {}, assignedAt: {}, ...state });
}

beforeEach(async () => {
  reset();
  await AsyncStorage.clear();
});

// --- Part C: capacity -------------------------------------------------------

describe('capacity is governed by the cab’s designation', () => {
  test('a regular cab holds one unit; a designated cab holds two', () => {
    expect(capacityFor(undefined)).toBe(1);
    expect(capacityFor(designation('1704', { kind: 'sandwich' }))).toBe(2);
    expect(capacityFor(designation('1704', { kind: 'doubleheader' }))).toBe(2);
  });

  test('capacity is a maximum, not a requirement', () => {
    // The real case: cab 1704 is a sandwich of 1002 + 1139, but only 1002 is
    // rostered today — a designation with one (or zero) units is valid.
    reset({
      heritage: { '1002': '1704' },
      designations: { '1704': designation('1704', { locos: ['1002', '1139'] }) },
    });
    expect(unitsOnCab(useStore.getState().heritage, '1704')).toEqual(['1002']);
    expect(assignOutcome(useStore.getState().heritage, useStore.getState().designations, '1030', '1704'))
      .toMatchObject({ status: 'ok' });
  });
});

describe('spec 2 — a second assignment on a regular cab prompts', () => {
  test('the store reports needsDesignation instead of assigning', () => {
    reset({ heritage: { '1030': '1704' } });
    const outcome = useStore.getState().pairHeritage('1129', '1704');

    expect(outcome).toMatchObject({ status: 'needsDesignation', cab: '1704', occupant: '1030' });
    // Nothing changed — the caller has to answer the prompt first.
    expect(useStore.getState().heritage).toEqual({ '1030': '1704' });
  });

  test('cancelling leaves exactly one assignment', () => {
    reset({ heritage: { '1030': '1704' } });
    useStore.getState().pairHeritage('1129', '1704'); // user cancels: no follow-up
    expect(unitsOnCab(useStore.getState().heritage, '1704')).toEqual(['1030']);
    expect(useStore.getState().designations['1704']).toBeUndefined();
  });

  test('choosing a designation completes the assignment', () => {
    reset({ heritage: { '1030': '1704' } });
    expect(useStore.getState().setDesignation('1704', 'sandwich').status).toBe('ok');
    expect(useStore.getState().pairHeritage('1129', '1704').status).toBe('ok');

    expect(unitsOnCab(useStore.getState().heritage, '1704').sort()).toEqual(['1030', '1129']);
  });

  test('reassigning a unit to the cab it already occupies is never blocked', () => {
    reset({ heritage: { '1030': '1704' } });
    expect(useStore.getState().pairHeritage('1030', '1704').status).toBe('ok');
  });

  test('moving a unit off a cab frees that cab’s slot', () => {
    reset({ heritage: { '1030': '1704' } });
    expect(useStore.getState().pairHeritage('1030', '1800').status).toBe('ok');
    expect(unitsOnCab(useStore.getState().heritage, '1704')).toEqual([]);
    expect(useStore.getState().pairHeritage('1129', '1704').status).toBe('ok');
  });
});

describe('spec 3 — a designated cab takes two assignments', () => {
  beforeEach(() => {
    reset({ designations: { '1704': designation('1704') } });
    useStore.getState().pairHeritage('1002', '1704');
    useStore.getState().pairHeritage('1030', '1704');
  });

  test('both are accepted and both render', () => {
    expect(unitsOnCab(useStore.getState().heritage, '1704').sort()).toEqual(['1002', '1030']);
    expect(displayUnitsForCab(useStore.getState(), '1704')).toHaveLength(2);
  });

  test('a third is refused outright — no prompt, nothing to upgrade to', () => {
    const outcome = useStore.getState().pairHeritage('1776', '1704');
    expect(outcome).toMatchObject({ status: 'full', max: 2 });
    expect(unitsOnCab(useStore.getState().heritage, '1704')).toHaveLength(2);
  });

  test('the marker shows the primary’s icon and a +1, never two icons', () => {
    // TrainMarkers passes units[0] as the icon and units.length - 1 as "+N".
    const units = displayUnitsForCab(useStore.getState(), '1704');
    expect(units[0]).toBe('1002'); // first-assigned by default
    expect(units.length - 1).toBe(1);
  });

  test('the primary swaps, and the swap survives further assignment churn', () => {
    useStore.getState().setPrimaryUnit('1704', '1030');
    expect(displayUnitsForCab(useStore.getState(), '1704')[0]).toBe('1030');

    // Unassigning the chosen primary falls back to whoever remains.
    useStore.getState().unpairHeritage('1030');
    expect(displayUnitsForCab(useStore.getState(), '1704')).toEqual(['1002']);
    expect(useStore.getState().designations['1704'].primaryUnit).toBeUndefined();
  });

  test('a unit that isn’t on the cab can’t be made primary', () => {
    useStore.getState().setPrimaryUnit('1704', '1776');
    expect(useStore.getState().designations['1704'].primaryUnit).toBeUndefined();
  });
});

describe('spec 4 — downgrading with two assigned is blocked', () => {
  beforeEach(() => {
    reset({ designations: { '1704': designation('1704') } });
    useStore.getState().pairHeritage('1002', '1704');
    useStore.getState().pairHeritage('1030', '1704');
  });

  test('removal is refused while two units are assigned', () => {
    const result = useStore.getState().removeDesignation('1704');
    expect(result).toMatchObject({ status: 'blocked', capacity: 1 });
    expect(result.status === 'blocked' && result.assigned.sort()).toEqual(['1002', '1030']);
    // Never silently drop an assignment.
    expect(useStore.getState().designations['1704']).toBeDefined();
    expect(unitsOnCab(useStore.getState().heritage, '1704')).toHaveLength(2);
  });

  test('it succeeds once one unit is unassigned', () => {
    useStore.getState().unpairHeritage('1030');
    expect(useStore.getState().removeDesignation('1704').status).toBe('ok');
    expect(useStore.getState().designations['1704']).toBeUndefined();
    // The surviving assignment is untouched.
    expect(useStore.getState().heritage).toEqual({ '1002': '1704' });
  });

  test('re-kinding is allowed — both kinds hold two', () => {
    expect(useStore.getState().setDesignation('1704', 'doubleheader').status).toBe('ok');
    expect(useStore.getState().designations['1704'].kind).toBe('doubleheader');
    expect(unitsOnCab(useStore.getState().heritage, '1704')).toHaveLength(2);
  });

  test('canReduceCapacity is the underlying guard', () => {
    const { heritage } = useStore.getState();
    expect(canReduceCapacity(heritage, '1704', 1)).toBe(false);
    expect(canReduceCapacity(heritage, '1704', 2)).toBe(true);
  });
});

// --- Part B/D: designation content and display ------------------------------

describe('spec 5 — freeform locos, linked when rostered', () => {
  test('locos are free text and need not be rostered', () => {
    reset({ designations: { '1704': designation('1704') } });
    useStore.getState().updateDesignation('1704', { locos: ['1002', '1139'] });
    expect(useStore.getState().designations['1704'].locos).toEqual(['1002', '1139']);
  });

  test('roster membership is what decides linked vs plain rendering', () => {
    // LocoChip renders an icon chip for a rostered number, plain text otherwise.
    // Cab 1704's real consist: 1002 is rostered, 1139 is not.
    const roster = getConfig().heritageById;
    expect(isRostered('1002', roster)).toBe(true);
    expect(isRostered('1139', roster)).toBe(false);
  });
});

describe('position tags follow the designation kind', () => {
  test('sandwich uses OB/IB, doubleheader lead/trail', () => {
    expect(positionLabel('OB')).toBe('OB end');
    expect(positionLabel('lead')).toBe('lead loco');
  });

  test('tags the new kind doesn’t allow are dropped on re-kind', () => {
    expect(prunePositions({ '1002': 'OB', '1139': 'IB' }, 'sandwich')).toEqual({
      '1002': 'OB',
      '1139': 'IB',
    });
    expect(prunePositions({ '1002': 'OB', '1139': 'IB' }, 'doubleheader')).toEqual({});
  });

  test('re-kinding through the store prunes stale tags', () => {
    reset({
      designations: { '1704': designation('1704', { positions: { '1002': 'OB', '1139': 'IB' } }) },
    });
    useStore.getState().setDesignation('1704', 'doubleheader');
    expect(useStore.getState().designations['1704'].positions).toEqual({});
  });

  test('untagged is allowed — positions are optional', () => {
    reset({ designations: { '1704': designation('1704') } });
    expect(useStore.getState().designations['1704'].positions).toEqual({});
  });
});

describe('spec 6 — staleness after 14 days', () => {
  const now = Date.UTC(2026, 6, 23);

  test('fresh designations are not stale', () => {
    expect(isStale(now - 13 * DAY, now)).toBe(false);
    expect(isStale(now - STALE_AFTER_MS, now)).toBe(false); // boundary: exactly 14d
  });

  test('past 14 days it goes stale', () => {
    expect(isStale(now - 15 * DAY, now)).toBe(true);
  });

  test('the badge reads the spec’s format and appends verify? when stale', () => {
    const fresh = designation('1704', {
      kind: 'sandwich',
      locos: ['1002', '1139'],
      markedAt: now - 3 * DAY,
    });
    expect(describeDesignation(fresh, now)).toBe('SANDWICH · locos 1002 + 1139 · marked 3d ago');

    const stale = { ...fresh, markedAt: now - 20 * DAY };
    expect(describeDesignation(stale, now)).toBe(
      'SANDWICH · locos 1002 + 1139 · marked 20d ago · verify?',
    );
  });

  test('a designation with no locos recorded still describes cleanly', () => {
    const d = designation('1704', { kind: 'doubleheader', markedAt: now - 2 * DAY });
    expect(describeDesignation(d, now)).toBe('DOUBLEHEADER · marked 2d ago');
  });

  test('staleness never deletes anything', () => {
    reset({ designations: { '1704': designation('1704', { markedAt: 0 }) } });
    expect(useStore.getState().designations['1704']).toBeDefined();
  });
});

// --- Part C.5 / spec 7: migration -------------------------------------------

describe('spec 7 — existing single assignments migrate untouched', () => {
  test('pairings load unchanged when no consist sidecar exists', async () => {
    // Exactly what a pre-designation install has on disk.
    await AsyncStorage.setItem('crHeritage', JSON.stringify({ '1030': '1704', '1776': '1800' }));

    await useStore.getState().hydrateHeritage();
    await useStore.getState().hydrateConsists(); // key absent

    expect(useStore.getState().heritage).toEqual({ '1030': '1704', '1776': '1800' });
    expect(useStore.getState().designations).toEqual({});
    expect(useStore.getState().assignedAt).toEqual({});
  });

  test('an undesignated cab still behaves as one-unit-per-cab', () => {
    reset({ heritage: { '1030': '1704' } });
    expect(capacityFor(useStore.getState().designations['1704'])).toBe(1);
    expect(useStore.getState().pairHeritage('1129', '1704').status).toBe('needsDesignation');
  });

  test('a migrated pairing with no recorded assignment time still orders and renders', () => {
    // assignedAt is empty for migrated pairs; ordering must stay deterministic.
    reset({
      heritage: { '1030': '1704', '1002': '1704' },
      designations: { '1704': designation('1704') },
    });
    expect(orderedUnitsOnCab(useStore.getState().heritage, {}, '1704')).toEqual(['1002', '1030']);
    expect(primaryUnitForCab(useStore.getState().heritage, {}, useStore.getState().designations, '1704'))
      .toBe('1002');
  });

  test('a corrupt consist sidecar is ignored rather than fatal', async () => {
    await AsyncStorage.setItem('crConsists.v1', '{not json');
    await useStore.getState().hydrateConsists();
    expect(useStore.getState().designations).toEqual({});
  });
});

describe('persistence', () => {
  test('assignments and designations write to their separate keys', async () => {
    reset();
    useStore.getState().setDesignation('1704', 'sandwich');
    useStore.getState().pairHeritage('1002', '1704');

    expect(JSON.parse((await AsyncStorage.getItem('crHeritage')) ?? '{}')).toEqual({ '1002': '1704' });
    const sidecar = JSON.parse((await AsyncStorage.getItem('crConsists.v1')) ?? '{}');
    expect(sidecar.designations['1704']).toMatchObject({ cab: '1704', kind: 'sandwich' });
    expect(Object.keys(sidecar.assignedAt)).toEqual(['1002']);
  });

  test('a designation survives its units being unassigned', () => {
    reset({ designations: { '1704': designation('1704') } });
    useStore.getState().pairHeritage('1002', '1704');
    useStore.getState().unpairHeritage('1002');
    // The consist is still a sandwich whether or not a unit is assigned to it.
    expect(useStore.getState().designations['1704']).toBeDefined();
  });
});

describe('unitsByCab', () => {
  test('groups every unit on a cab, not just the last one written', () => {
    expect(unitsByCab({ '1030': '1704', '1002': '1704', '1776': '1800' })).toEqual({
      '1704': ['1002', '1030'],
      '1800': ['1776'],
    });
  });
});
