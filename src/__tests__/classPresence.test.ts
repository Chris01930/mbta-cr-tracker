/// <reference types="jest" />
import { presentTrainClasses } from '../lib/roster';
import { selectClassPresence, useStore } from '../state/store';
import type { Frame, Train } from '../types';

/**
 * Presence-conditional layer toggles (Part 1): the Non-revenue / Ghosts rows
 * appear only when the dataset in view contains such a train. This exercises the
 * detection that drives that visibility — the rows themselves are a pure render
 * of these booleans.
 */

function train(over: Partial<Train> = {}): Train {
  return {
    cab: '1500',
    train: '100',
    dest: null,
    route: 'CR-Newburyport',
    status: null,
    lat: 42.5,
    lon: -71.0,
    brg: null,
    upd: null,
    isNonRevenue: false,
    isGhost: false,
    vid: null,
    ...over,
  };
}

const frame = (trains: Train[]): Frame => ({ key: '000000', time: '', trains });

describe('presentTrainClasses', () => {
  test('a dataset of ordinary revenue trains has neither class', () => {
    expect(presentTrainClasses([frame([train(), train({ cab: '1600' })])], [])).toEqual({
      nonRevenue: false,
      ghost: false,
    });
  });

  test('a non-revenue train in the frames is detected', () => {
    expect(presentTrainClasses([frame([train(), train({ isNonRevenue: true })])])).toEqual({
      nonRevenue: true,
      ghost: false,
    });
  });

  test('a ghost (null cab) is detected', () => {
    expect(presentTrainClasses([frame([train({ cab: null, isGhost: true, vid: 'v9' })])])).toEqual({
      nonRevenue: false,
      ghost: true,
    });
  });

  test('the current live set is scanned too, not only committed frames', () => {
    // Simulates a NON_REVENUE arriving in a live update before it's committed.
    expect(presentTrainClasses([], [train({ isNonRevenue: true })])).toMatchObject({ nonRevenue: true });
  });

  test('both classes together are found', () => {
    const f = frame([train({ isNonRevenue: true }), train({ cab: null, isGhost: true })]);
    expect(presentTrainClasses([f])).toEqual({ nonRevenue: true, ghost: true });
  });

  test('empty dataset is safe', () => {
    expect(presentTrainClasses([], [])).toEqual({ nonRevenue: false, ghost: false });
  });
});

describe('selectClassPresence reacts to the mode and data in view', () => {
  afterEach(() => {
    useStore.setState({ mode: 'live', trains: [], frames: [], playbackDay: null });
  });

  test('live: absent when the session has no such trains', () => {
    useStore.setState({ mode: 'live', frames: [], trains: [train()] });
    expect(selectClassPresence(useStore.getState())).toEqual({ nonRevenue: false, ghost: false });
  });

  test('live: a NON_REVENUE train arriving in an update reveals it without a restart', () => {
    useStore.setState({ mode: 'live', frames: [], trains: [train()] });
    expect(selectClassPresence(useStore.getState()).nonRevenue).toBe(false);

    // The next poll/stream update includes a deadhead.
    useStore.setState({ trains: [train(), train({ cab: '1900', isNonRevenue: true })] });
    expect(selectClassPresence(useStore.getState()).nonRevenue).toBe(true);
  });

  test('playback: presence comes from the loaded archive day', () => {
    const day = {
      date: '2026-07-20',
      updated: '',
      frames: [frame([train({ cab: null, isGhost: true, vid: 'g1' })])],
    };
    useStore.setState({ mode: 'playback', playbackDay: day });
    expect(selectClassPresence(useStore.getState())).toEqual({ nonRevenue: false, ghost: true });
  });

  test('playback: an archive day without the states hides both', () => {
    useStore.setState({
      mode: 'playback',
      playbackDay: { date: '2026-07-21', updated: '', frames: [frame([train()])] },
    });
    expect(selectClassPresence(useStore.getState())).toEqual({ nonRevenue: false, ghost: false });
  });
});
