import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  Modal,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { CAB_ROSTER, CAB_BY_NUMBER } from '../constants/cabRoster';
import { routeShort } from '../constants/routes';
import { groupUnitsByCategory, unitCategoryLine } from '../constants/heritage';
import { markIconFailed, useUsableIconUrl } from '../lib/iconFallback';
import type { HeritageUnitInfo } from '../config/schema';
import { useConfigStore } from '../config/configStore';
import { cabToUnit, useDisplayedTrains, useStore } from '../state/store';
import { dedupeTrains } from '../lib/trains';
import { locateCab, type UnitLocation } from '../lib/heritageLocate';
import { nearestStation } from '../lib/stations';
import { formatClock } from '../lib/time';

/**
 * Notable-unit pairing editor. Each unit is assigned to a cab car (assign/
 * reassign/unassign), and the roster is grouped by the unit's category
 * (heritage livery, commemorative, lease power, …) using the labels from
 * config. The assign picker has two tabs:
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

  // Where each paired unit is (or last was) today, at the currently-displayed
  // time. In playback that's the archived day up to the scrub position; live,
  // it's the session's frames plus the current poll.
  const mode = useStore((s) => s.mode);
  const liveFrames = useStore((s) => s.frames);
  const todayFrames = useStore((s) => s.todayFrames);
  const playbackDay = useStore((s) => s.playbackDay);
  const playbackIndex = useStore((s) => s.playbackIndex);

  const { historyFrames, currentTimeMs } = useMemo(() => {
    if (mode === 'playback' && playbackDay) {
      const frame = playbackDay.frames[playbackIndex];
      return { historyFrames: playbackDay.frames, currentTimeMs: frame ? Date.parse(frame.time) : Date.now() };
    }
    // Live: today's archive (midnight -> launch) + this session's frames
    // (launch -> now), chronological, so "last known" spans the whole day.
    const frames = todayFrames.length ? [...todayFrames, ...liveFrames] : liveFrames;
    return { historyFrames: frames, currentTimeMs: Date.now() };
  }, [mode, playbackDay, playbackIndex, liveFrames, todayFrames]);

  const locationByUnit = useMemo(() => {
    const out: Record<string, UnitLocation | null> = {};
    for (const [unit, cab] of Object.entries(heritage)) {
      out[unit] = locateCab(cab, historyFrames, currentTimeMs, trains);
    }
    return out;
  }, [heritage, historyFrames, currentTimeMs, trains]);

  // When set, we're picking a cab to assign to this unit number.
  const [assigning, setAssigning] = useState<string | null>(null);
  const [tab, setTab] = useState<AssignTab>('active');
  const [search, setSearch] = useState('');

  // The full roster (road number, model, scheme, category, icon URL) is
  // config-driven, as are the category labels and their display order.
  const units = useConfigStore((s) => s.config.heritageUnits);
  const categories = useConfigStore((s) => s.config.unitCategories);
  const sections = useMemo(
    () => groupUnitsByCategory(units, categories).map((g) => ({ title: g.label, data: g.units })),
    [units, categories],
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
            <Text style={styles.title}>{assigning ? `Assign unit ${assigning}` : 'Notable units'}</Text>
            <TouchableOpacity onPress={assigning ? closeAssign : onClose}>
              <Text style={styles.close}>{assigning ? 'Back' : 'Done'}</Text>
            </TouchableOpacity>
          </View>

          {!assigning ? (
            <SectionList
              sections={sections}
              keyExtractor={(u) => u.unit}
              stickySectionHeadersEnabled={false}
              renderSectionHeader={({ section }) => (
                <Text style={styles.sectionHeader}>{section.title}</Text>
              )}
              renderItem={({ item }) => (
                <UnitRow
                  unit={item}
                  cab={heritage[item.unit]}
                  location={locationByUnit[item.unit] ?? null}
                  onAssign={() => startAssign(item.unit)}
                  onUnassign={() => unpairHeritage(item.unit)}
                />
              )}
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

/**
 * One roster row. Units whose artwork is missing (no `icon` in config, or an
 * `icon` URL that fails to load) show a placeholder glyph rather than a broken
 * image — everything else about the row is identical, since pairing mechanics
 * don't depend on artwork.
 */
function UnitRow({
  unit,
  cab,
  location,
  onAssign,
  onUnassign,
}: {
  unit: HeritageUnitInfo;
  cab: string | undefined;
  location: UnitLocation | null;
  onAssign: () => void;
  onUnassign: () => void;
}) {
  const iconUrl = useUsableIconUrl(unit.icon);
  return (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        {iconUrl ? (
          <Image
            source={{ uri: iconUrl }}
            style={styles.unitIcon}
            resizeMode="contain"
            onError={() => markIconFailed(iconUrl)}
          />
        ) : (
          <View style={[styles.unitIcon, styles.unitIconPlaceholder]}>
            <Text style={styles.unitIconGlyph}>🚂</Text>
          </View>
        )}
        <View style={styles.unitText}>
          <Text style={styles.unitName}>
            {unit.scheme} {unit.unit}
          </Text>
          <Text style={styles.unitModel}>{unit.model}</Text>
          <Text style={styles.unitCategory}>{unitCategoryLine(unit)}</Text>
          <Text style={styles.pairing}>{cab ? `Paired to Cab ${cab}` : 'Not paired'}</Text>
          {cab && <LocationLine loc={location} />}
        </View>
      </View>
      <View style={styles.actions}>
        <TouchableOpacity style={styles.assignBtn} onPress={onAssign}>
          <Text style={styles.assignText}>{cab ? 'Reassign' : 'Assign'}</Text>
        </TouchableOpacity>
        {cab && (
          <TouchableOpacity style={styles.clearBtn} onPress={onUnassign}>
            <Text style={styles.clearText}>Unassign</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

/** The unit's current-or-last-known place + time line, under the pairing. */
function LocationLine({ loc }: { loc: UnitLocation | null }) {
  if (!loc) return <Text style={styles.locUnknown}>No location today</Text>;
  const st = nearestStation(loc.lat, loc.lon);
  const place = st ? st.name : `${loc.lat.toFixed(3)}, ${loc.lon.toFixed(3)}`;
  const prep = st && st.distMi < 0.35 ? 'at' : 'near';
  const time = formatClock(loc.timeMs);
  if (loc.isCurrent) {
    return (
      <Text style={styles.locCurrent}>
        ◉ {prep === 'at' ? 'At' : 'Near'} {place} · {time}
      </Text>
    );
  }
  return (
    <Text style={styles.locPast}>
      Last seen {prep} {place} · {time}
    </Text>
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
  sectionHeader: {
    color: '#8A909B',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 14,
    marginBottom: 2,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  unitIcon: { width: 48, height: 34, marginRight: 10 },
  unitIconPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  unitIconGlyph: { fontSize: 17, opacity: 0.5 },
  unitText: { flexShrink: 1 },
  unitNum: { color: '#F5C518', fontWeight: '800', fontSize: 16, width: 48 },
  unitName: { color: '#fff', fontSize: 14, fontWeight: '600' },
  unitModel: { color: '#F5C518', fontSize: 12, fontWeight: '600', marginTop: 1 },
  unitCategory: { color: '#B9BEC7', fontSize: 12, marginTop: 1 },
  pairing: { color: '#8A909B', fontSize: 12, marginTop: 2 },
  locCurrent: { color: '#2ECC71', fontSize: 12, fontWeight: '600', marginTop: 2 },
  locPast: { color: '#B9BEC7', fontSize: 12, marginTop: 2 },
  locUnknown: { color: '#6B717C', fontSize: 12, fontStyle: 'italic', marginTop: 2 },
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
