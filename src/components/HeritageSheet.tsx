import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { heritageName } from '../constants/heritage';
import { CAB_ROSTER, CAB_BY_NUMBER } from '../constants/cabRoster';
import { routeShort } from '../constants/routes';
import { useConfigStore } from '../config/configStore';
import { cabToUnit, useDisplayedTrains, useStore } from '../state/store';
import { dedupeTrains } from '../lib/trains';

/**
 * Heritage pairing editor. Each unit is assigned to a cab car (assign/reassign/
 * unassign). The assign picker has two tabs:
 *   - Active: cabs currently in the live feed (with train # + route)
 *   - All cab cars: the full roster, searchable — so a unit can be paired from a
 *     spotting report even when the cab isn't running.
 * We NEVER auto-match a label to a unit; the user chooses explicitly. Pairing
 * persists on-device and repaints markers immediately.
 */
type AssignTab = 'active' | 'all';

export function HeritageSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const heritage = useStore((s) => s.heritage);
  const trains = useDisplayedTrains();
  const pairHeritage = useStore((s) => s.pairHeritage);
  const unpairHeritage = useStore((s) => s.unpairHeritage);

  // When set, we're picking a cab to assign to this unit number.
  const [assigning, setAssigning] = useState<string | null>(null);
  const [tab, setTab] = useState<AssignTab>('active');
  const [search, setSearch] = useState('');

  // The unit list is config-driven (numbers from config.json); names baked in.
  const unitNumbers = useConfigStore((s) => s.config.heritageUnits);
  const units = useMemo(
    () => unitNumbers.map((number) => ({ number, name: heritageName(number) })),
    [unitNumbers],
  );

  const activeCabs = useMemo(
    () =>
      dedupeTrains(trains)
        .filter((t) => !!t.cab)
        .map((t) => ({ cab: t.cab as string, train: t.train, route: t.route })),
    [trains],
  );
  const activeByCab = useMemo(() => new Map(activeCabs.map((c) => [c.cab, c])), [activeCabs]);
  const activeSorted = useMemo(
    () => [...activeCabs].sort((a, b) => a.cab.localeCompare(b.cab)),
    [activeCabs],
  );
  const unitByCab = useMemo(() => cabToUnit(heritage), [heritage]);

  const rosterFiltered = useMemo(() => {
    const q = search.trim();
    if (!q) return CAB_ROSTER;
    return CAB_ROSTER.filter((c) => c.cab.includes(q));
  }, [search]);

  const startAssign = (unit: string) => {
    setAssigning(unit);
    setTab('active');
    setSearch('');
  };
  const closeAssign = () => {
    setAssigning(null);
    setSearch('');
  };
  const assign = (cab: string) => {
    if (assigning) pairHeritage(assigning, cab);
    closeAssign();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{assigning ? `Assign unit ${assigning}` : 'Heritage units'}</Text>
            <TouchableOpacity onPress={assigning ? closeAssign : onClose}>
              <Text style={styles.close}>{assigning ? 'Back' : 'Done'}</Text>
            </TouchableOpacity>
          </View>

          {!assigning ? (
            <FlatList
              data={units}
              keyExtractor={(u) => u.number}
              renderItem={({ item }) => {
                const cab = heritage[item.number];
                return (
                  <View style={styles.row}>
                    <View style={styles.rowLeft}>
                      <Text style={styles.unitNum}>{item.number}</Text>
                      <View>
                        <Text style={styles.unitName}>{item.name}</Text>
                        <Text style={styles.pairing}>{cab ? `Paired to Cab ${cab}` : 'Not paired'}</Text>
                      </View>
                    </View>
                    <View style={styles.actions}>
                      <TouchableOpacity style={styles.assignBtn} onPress={() => startAssign(item.number)}>
                        <Text style={styles.assignText}>{cab ? 'Reassign' : 'Assign'}</Text>
                      </TouchableOpacity>
                      {cab && (
                        <TouchableOpacity style={styles.clearBtn} onPress={() => unpairHeritage(item.number)}>
                          <Text style={styles.clearText}>Unassign</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                );
              }}
              ListFooterComponent={
                <Text style={styles.note}>
                  Locomotive numbers are never reported by the MBTA feed — pairing is manual,
                  based on your spotting reports, and persists on this device.
                </Text>
              }
            />
          ) : (
            <>
              {/* Active / All tabs */}
              <View style={styles.segment}>
                {(['active', 'all'] as AssignTab[]).map((t) => {
                  const active = tab === t;
                  return (
                    <TouchableOpacity
                      key={t}
                      style={[styles.segmentBtn, active && styles.segmentBtnActive]}
                      onPress={() => setTab(t)}
                    >
                      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                        {t === 'active' ? 'Active' : 'All cab cars'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {tab === 'active' ? (
                <FlatList
                  data={activeSorted}
                  keyExtractor={(c) => c.cab}
                  keyboardShouldPersistTaps="handled"
                  ListEmptyComponent={<Text style={styles.note}>No active trains to pair right now.</Text>}
                  renderItem={({ item }) => {
                    const roster = CAB_BY_NUMBER[item.cab];
                    return (
                      <TouchableOpacity style={styles.cabRow} onPress={() => assign(item.cab)}>
                        <Text style={styles.cabNum}>Cab {item.cab}</Text>
                        <Text style={styles.cabMeta}>
                          {item.train ? `Trn ${item.train} · ` : ''}
                          {routeShort(item.route)}
                          {roster ? ` · ${roster.model}` : ''}
                        </Text>
                      </TouchableOpacity>
                    );
                  }}
                />
              ) : (
                <>
                  <TextInput
                    style={styles.search}
                    placeholder="Search cab #"
                    placeholderTextColor="#6B717C"
                    keyboardType="number-pad"
                    value={search}
                    onChangeText={setSearch}
                    returnKeyType="done"
                  />
                  <FlatList
                    data={rosterFiltered}
                    keyExtractor={(c) => c.cab}
                    keyboardShouldPersistTaps="handled"
                    initialNumToRender={20}
                    ListEmptyComponent={<Text style={styles.note}>No cab matches “{search}”.</Text>}
                    renderItem={({ item }) => {
                      const isActive = activeByCab.has(item.cab);
                      const pairedUnit = unitByCab[item.cab];
                      return (
                        <TouchableOpacity style={styles.cabRow} onPress={() => assign(item.cab)}>
                          <View style={styles.cabRowInner}>
                            <View style={{ flexShrink: 1 }}>
                              <Text style={styles.cabNum}>Cab {item.cab}</Text>
                              <Text style={styles.cabMeta}>
                                {item.model} · {item.mfg}
                              </Text>
                            </View>
                            <View style={styles.badges}>
                              {isActive && (
                                <View style={[styles.badge, styles.badgeActive]}>
                                  <Text style={styles.badgeText}>Active</Text>
                                </View>
                              )}
                              {pairedUnit && pairedUnit !== assigning && (
                                <View style={[styles.badge, styles.badgePaired]}>
                                  <Text style={styles.badgeText}>Unit {pairedUnit}</Text>
                                </View>
                              )}
                            </View>
                          </View>
                        </TouchableOpacity>
                      );
                    }}
                  />
                </>
              )}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#16181D',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 28,
    maxHeight: '80%',
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { color: '#fff', fontSize: 18, fontWeight: '800' },
  close: { color: '#F5C518', fontSize: 15, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  unitNum: { color: '#F5C518', fontWeight: '800', fontSize: 16, width: 48 },
  unitName: { color: '#fff', fontSize: 14, fontWeight: '600' },
  pairing: { color: '#8A909B', fontSize: 12, marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  assignBtn: { backgroundColor: '#80276C', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  assignText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  clearBtn: { paddingHorizontal: 8, paddingVertical: 7 },
  clearText: { color: '#E74C3C', fontWeight: '700', fontSize: 12 },

  segment: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 9,
    padding: 3,
    marginBottom: 10,
  },
  segmentBtn: { flex: 1, paddingVertical: 7, borderRadius: 7, alignItems: 'center' },
  segmentBtnActive: { backgroundColor: '#80276C' },
  segmentText: { color: '#B9BEC7', fontSize: 13, fontWeight: '700' },
  segmentTextActive: { color: '#fff' },

  search: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 15,
    marginBottom: 6,
  },

  cabRow: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  cabRowInner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cabNum: { color: '#fff', fontSize: 15, fontWeight: '700' },
  cabMeta: { color: '#8A909B', fontSize: 12, marginTop: 2 },
  badges: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 8 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 5 },
  badgeActive: { backgroundColor: 'rgba(46,204,113,0.22)' },
  badgePaired: { backgroundColor: 'rgba(245,197,24,0.2)' },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  note: { color: '#6B717C', fontSize: 12, marginTop: 16, lineHeight: 17 },
});
