import React, { useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Modal,
  ScrollView,
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
import { unitsByCab, useDisplayedTrains, useStore } from '../state/store';
import {
  KIND_LABEL,
  POSITIONS,
  describeDesignation,
  isStale,
  unitsOnCab,
  type ConsistKind,
  type Designation,
  type PositionTag,
} from '../lib/consists';
import { dedupeTrains } from '../lib/trains';
import { locateCab, type UnitLocation } from '../lib/heritageLocate';
import { nearestStation } from '../lib/stations';
import { formatClock } from '../lib/time';

/**
 * Notable units and consist designations — the two halves of "what locomotive
 * is on that train", side by side in one sheet.
 *
 * Units tab: assign / reassign / unassign a unit to a cab car, grouped by
 * category. The picker has two tabs — Active (cabs in the live feed) and All
 * cab cars (searchable), so a unit can be assigned from a spotting report even
 * when its cab isn't running. We NEVER auto-match a label to a unit.
 *
 * Consists tab: mark a cab as a sandwich or doubleheader, record the physical
 * locomotives (freeform — they may not be rostered) and their positions. A
 * designation is what raises a cab's capacity from one unit to two, so the
 * assign flow can create one inline when a second unit needs somewhere to go.
 */
type AssignTab = 'active' | 'all';
type SheetView = 'units' | 'consists';
/** What the cab picker is currently choosing a cab FOR. */
type Picking = { mode: 'assign'; unit: string } | { mode: 'designate' } | null;

export function HeritageSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const heritage = useStore((s) => s.heritage);
  const designations = useStore((s) => s.designations);
  const trains = useDisplayedTrains();
  const pairHeritage = useStore((s) => s.pairHeritage);
  const unpairHeritage = useStore((s) => s.unpairHeritage);
  const setDesignation = useStore((s) => s.setDesignation);
  const removeDesignation = useStore((s) => s.removeDesignation);
  const updateDesignation = useStore((s) => s.updateDesignation);

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

  const [view, setView] = useState<SheetView>('units');
  // When set, the cab picker is open — either to assign a unit or to designate.
  const [picking, setPicking] = useState<Picking>(null);
  // When set, we're editing that cab's designation (locos / positions / note).
  const [editing, setEditing] = useState<string | null>(null);
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
  const unitsForCab = useMemo(() => unitsByCab(heritage), [heritage]);
  const designationList = useMemo(
    () => Object.values(designations).sort((a, b) => a.cab.localeCompare(b.cab)),
    [designations],
  );

  const rosterFiltered = useMemo(() => {
    const q = search.trim();
    if (!q) return CAB_ROSTER;
    return CAB_ROSTER.filter((c) => c.cab.includes(q));
  }, [search]);

  const openPicker = (next: Picking) => {
    setPicking(next);
    setTab('active');
    setSearch('');
  };
  const closePicker = () => {
    setPicking(null);
    setSearch('');
  };

  /** Assign `unit` to `cab`, resolving an over-capacity cab by prompting. */
  const assign = (unit: string, cab: string) => {
    const outcome = pairHeritage(unit, cab);

    if (outcome.status === 'ok') {
      closePicker();
      return;
    }

    if (outcome.status === 'needsDesignation') {
      // A regular cab holds one unit. Rather than refusing, offer the reason a
      // second one could be there — and only then complete the assignment.
      Alert.alert(
        `Mark cab ${cab}?`,
        `Cab ${cab} already carries unit ${outcome.occupant}. A regular cab holds one notable unit — mark this consist to assign a second.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sandwich', onPress: () => designateThenAssign(unit, cab, 'sandwich') },
          { text: 'Doubleheader', onPress: () => designateThenAssign(unit, cab, 'doubleheader') },
        ],
      );
      return;
    }

    Alert.alert(
      `Cab ${cab} is full`,
      `It already carries ${outcome.occupants.join(' and ')}, the maximum of ${outcome.max} for a ${
        designations[cab] ? KIND_LABEL[designations[cab].kind].toLowerCase() : 'regular cab'
      }. Unassign one first.`,
    );
  };

  /** The cab picker serves both flows; dispatch on what it was opened for. */
  const onPickCab = (cab: string) => {
    if (!picking) return;
    if (picking.mode === 'assign') assign(picking.unit, cab);
    else designateCab(cab);
  };

  const designateThenAssign = (unit: string, cab: string, kind: ConsistKind) => {
    if (setDesignation(cab, kind).status !== 'ok') return;
    if (pairHeritage(unit, cab).status === 'ok') closePicker();
  };

  /** Mark a cab from the Consists tab, then drop straight into its editor. */
  const designateCab = (cab: string) => {
    Alert.alert(
      `Mark cab ${cab}`,
      'How does this consist run?',
      [
        { text: 'Cancel', style: 'cancel' },
        ...(['sandwich', 'doubleheader'] as ConsistKind[]).map((kind) => ({
          text: KIND_LABEL[kind],
          onPress: () => {
            const res = setDesignation(cab, kind);
            if (res.status === 'ok') {
              closePicker();
              setEditing(cab);
            }
          },
        })),
      ],
    );
  };

  const confirmRemoveDesignation = (cab: string) => {
    const result = removeDesignation(cab);
    if (result.status === 'ok') return;
    // Never silently drop an assignment — say what's in the way.
    Alert.alert(
      `Cab ${cab} still carries ${result.assigned.length} units`,
      `Removing the designation would leave room for only ${result.capacity}. Unassign ${result.assigned.join(
        ' or ',
      )} first.`,
    );
  };

  const headerTitle = picking
    ? picking.mode === 'assign'
      ? `Assign unit ${picking.unit}`
      : 'Mark a cab'
    : editing
      ? `Cab ${editing}`
      : view === 'units'
        ? 'Notable units'
        : 'Consists';

  const goBack = () => {
    if (picking) closePicker();
    else if (editing) setEditing(null);
    else onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{headerTitle}</Text>
            <TouchableOpacity onPress={goBack}>
              <Text style={styles.close}>{picking || editing ? 'Back' : 'Done'}</Text>
            </TouchableOpacity>
          </View>

          {/* Units / Consists — the designation manager lives beside the roster. */}
          {!picking && !editing && (
            <View style={styles.segment}>
              {(['units', 'consists'] as SheetView[]).map((v) => {
                const active = view === v;
                return (
                  <TouchableOpacity
                    key={v}
                    style={[styles.segmentBtn, active && styles.segmentBtnActive]}
                    onPress={() => setView(v)}
                  >
                    <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                      {v === 'units' ? 'Units' : `Consists${designationList.length ? ` ${designationList.length}` : ''}`}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {editing ? (
            <DesignationEditor
              designation={designations[editing]}
              assignedUnits={unitsOnCab(heritage, editing)}
              onChange={(patch) => updateDesignation(editing, patch)}
              onChangeKind={(kind) => setDesignation(editing, kind)}
              onDone={() => setEditing(null)}
            />
          ) : !picking && view === 'consists' ? (
            <FlatList
              data={designationList}
              keyExtractor={(d) => d.cab}
              ListEmptyComponent={
                <Text style={styles.note}>
                  No consists marked. Mark a cab as a sandwich (a locomotive on each end) or a
                  doubleheader (two coupled on the same end) — that's what lets you assign two
                  notable units to one train.
                </Text>
              }
              ListHeaderComponent={
                <TouchableOpacity style={styles.markBtn} onPress={() => openPicker({ mode: 'designate' })}>
                  <Text style={styles.markBtnText}>+ Mark a cab</Text>
                </TouchableOpacity>
              }
              renderItem={({ item }) => (
                <DesignationRow
                  designation={item}
                  assignedUnits={unitsOnCab(heritage, item.cab)}
                  onEdit={() => setEditing(item.cab)}
                  onRemove={() => confirmRemoveDesignation(item.cab)}
                />
              )}
            />
          ) : !picking ? (
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
                  designation={heritage[item.unit] ? designations[heritage[item.unit]] : undefined}
                  location={locationByUnit[item.unit] ?? null}
                  onAssign={() => openPicker({ mode: 'assign', unit: item.unit })}
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
              {picking.mode === 'designate' && (
                <Text style={styles.pickHint}>
                  Pick the cab car of the consist to mark. Sandwich = a locomotive on each end;
                  doubleheader = two on the same end.
                </Text>
              )}

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
                      <TouchableOpacity style={styles.cabRow} onPress={() => onPickCab(item.cab)}>
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
                      // Units already on this cab, minus the one being moved
                      // here (reassigning to the same cab isn't a conflict).
                      const others = (unitsForCab[item.cab] ?? []).filter(
                        (u) => !(picking?.mode === 'assign' && u === picking.unit),
                      );
                      const marked = designations[item.cab];
                      return (
                        <TouchableOpacity style={styles.cabRow} onPress={() => onPickCab(item.cab)}>
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
                              {marked && (
                                <View style={[styles.badge, styles.badgeConsist]}>
                                  <Text style={styles.badgeText}>{KIND_LABEL[marked.kind]}</Text>
                                </View>
                              )}
                              {others.length > 0 && (
                                <View style={[styles.badge, styles.badgePaired]}>
                                  <Text style={styles.badgeText}>
                                    {others.length === 1 ? `Unit ${others[0]}` : `${others.length} units`}
                                  </Text>
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

/** A freeform loco number, rendered as a linked chip when it's on the roster. */
function LocoChip({ loco }: { loco: string }) {
  const rostered = useConfigStore((s) => s.config.heritageById[loco]);
  const iconUrl = useUsableIconUrl(rostered?.icon);
  if (!rostered) return <Text style={styles.locoPlain}>{loco}</Text>;
  return (
    <View style={styles.locoChip}>
      {iconUrl && (
        <Image
          source={{ uri: iconUrl }}
          style={styles.locoChipIcon}
          resizeMode="contain"
          onError={() => markIconFailed(iconUrl)}
        />
      )}
      <Text style={styles.locoChipText}>{loco}</Text>
    </View>
  );
}

/** One marked consist in the Consists tab. */
function DesignationRow({
  designation,
  assignedUnits,
  onEdit,
  onRemove,
}: {
  designation: Designation;
  assignedUnits: string[];
  onEdit: () => void;
  onRemove: () => void;
}) {
  const stale = isStale(designation.markedAt);
  return (
    <View style={styles.row}>
      <View style={{ flexShrink: 1, flexGrow: 1 }}>
        <Text style={styles.unitName}>
          Cab {designation.cab} · {KIND_LABEL[designation.kind]}
        </Text>
        {designation.locos.length > 0 && (
          <View style={styles.locoRow}>
            {designation.locos.map((loco, i) => (
              <React.Fragment key={`${loco}-${i}`}>
                {i > 0 && <Text style={styles.locoPlus}>+</Text>}
                <LocoChip loco={loco} />
                {designation.positions[loco] && (
                  <Text style={styles.locoPos}>{designation.positions[loco]}</Text>
                )}
              </React.Fragment>
            ))}
          </View>
        )}
        <Text style={[styles.pairing, stale && styles.staleText]}>
          {describeDesignation(designation)}
        </Text>
        {!!designation.note && <Text style={styles.designationNote}>{designation.note}</Text>}
        <Text style={styles.pairing}>
          {assignedUnits.length
            ? `${assignedUnits.length} of 2 assigned · ${assignedUnits.join(', ')}`
            : 'No notable units assigned'}
        </Text>
      </View>
      <View style={styles.actions}>
        <TouchableOpacity style={styles.assignBtn} onPress={onEdit}>
          <Text style={styles.assignText}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.clearBtn} onPress={onRemove}>
          <Text style={styles.clearText}>Remove</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/**
 * Editor for one designation: kind, the physical locomotives (freeform — a
 * locomotive needn't be on the roster to be recorded), their positions, and a
 * note. Positions are optional; the two choices follow the kind.
 */
function DesignationEditor({
  designation,
  assignedUnits,
  onChange,
  onChangeKind,
  onDone,
}: {
  designation: Designation | undefined;
  assignedUnits: string[];
  onChange: (patch: Partial<Pick<Designation, 'locos' | 'positions' | 'note'>>) => void;
  onChangeKind: (kind: ConsistKind) => void;
  onDone: () => void;
}) {
  if (!designation) return null;
  const [a = '', b = ''] = designation.locos;
  const tags = POSITIONS[designation.kind];

  const setLoco = (index: 0 | 1, value: string) => {
    const next = [a, b];
    next[index] = value.trim();
    // Store only the filled slots, preserving order.
    onChange({ locos: next.filter(Boolean) });
  };

  const togglePosition = (num: string, tag: PositionTag) => {
    const positions = { ...designation.positions };
    if (positions[num] === tag) delete positions[num];
    else {
      // Each tag belongs to one locomotive: taking it releases the other.
      for (const [k, v] of Object.entries(positions)) if (v === tag) delete positions[k];
      positions[num] = tag;
    }
    onChange({ positions });
  };

  // Position tags apply to the recorded locos and to any assigned unit.
  const taggable = [...new Set([...designation.locos, ...assignedUnits])].filter(Boolean);

  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <Text style={styles.sectionHeader}>Configuration</Text>
      <View style={styles.segment}>
        {(['sandwich', 'doubleheader'] as ConsistKind[]).map((k) => {
          const active = designation.kind === k;
          return (
            <TouchableOpacity
              key={k}
              style={[styles.segmentBtn, active && styles.segmentBtnActive]}
              onPress={() => onChangeKind(k)}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                {KIND_LABEL[k]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={styles.hintText}>
        {designation.kind === 'sandwich'
          ? 'A locomotive on each end, with the cab car riding within.'
          : 'Two locomotives coupled on the same end.'}
      </Text>

      <Text style={styles.sectionHeader}>Locomotives</Text>
      <View style={styles.locoInputs}>
        <TextInput
          style={[styles.search, styles.locoInput]}
          placeholder="Loco #"
          placeholderTextColor="#6B717C"
          keyboardType="number-pad"
          defaultValue={a}
          onEndEditing={(e) => setLoco(0, e.nativeEvent.text)}
          returnKeyType="done"
        />
        <TextInput
          style={[styles.search, styles.locoInput]}
          placeholder="Loco #"
          placeholderTextColor="#6B717C"
          keyboardType="number-pad"
          defaultValue={b}
          onEndEditing={(e) => setLoco(1, e.nativeEvent.text)}
          returnKeyType="done"
        />
      </View>
      <Text style={styles.hintText}>
        Any road number — a locomotive doesn't have to be on the roster to be recorded. Numbers
        that are appear with their icon.
      </Text>

      {taggable.length > 0 && (
        <>
          <Text style={styles.sectionHeader}>Positions (optional)</Text>
          {taggable.map((num) => (
            <View key={num} style={styles.posRow}>
              <Text style={styles.posNum}>{num}</Text>
              <View style={styles.posTags}>
                {tags.map((tag) => {
                  const active = designation.positions[num] === tag;
                  return (
                    <TouchableOpacity
                      key={tag}
                      style={[styles.posTag, active && styles.posTagActive]}
                      onPress={() => togglePosition(num, tag)}
                    >
                      <Text style={[styles.posTagText, active && styles.posTagTextActive]}>{tag}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}
        </>
      )}

      <Text style={styles.sectionHeader}>Note (optional)</Text>
      <TextInput
        style={styles.search}
        placeholder="e.g. seen at South Station 7/23"
        placeholderTextColor="#6B717C"
        defaultValue={designation.note ?? ''}
        onEndEditing={(e) => onChange({ note: e.nativeEvent.text.trim() || undefined })}
        returnKeyType="done"
      />

      <TouchableOpacity style={styles.markBtn} onPress={onDone}>
        <Text style={styles.markBtnText}>Done</Text>
      </TouchableOpacity>
    </ScrollView>
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
  designation,
  location,
  onAssign,
  onUnassign,
}: {
  unit: HeritageUnitInfo;
  cab: string | undefined;
  designation: Designation | undefined;
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
          <Text style={styles.pairing}>
            {cab ? `Assigned to Cab ${cab}` : 'Not assigned'}
            {cab && designation ? ` · ${KIND_LABEL[designation.kind]}` : ''}
            {cab && designation?.positions[unit.unit] ? ` · ${designation.positions[unit.unit]}` : ''}
          </Text>
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
  badgeConsist: { backgroundColor: 'rgba(93,173,226,0.22)' },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  note: { color: '#6B717C', fontSize: 12, marginTop: 16, lineHeight: 17 },

  // Consists tab
  markBtn: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 9,
    paddingVertical: 11,
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 4,
  },
  markBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  locoRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  locoChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(245,197,24,0.16)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(245,197,24,0.5)',
  },
  locoChipIcon: { width: 16, height: 12 },
  locoChipText: { color: '#F5C518', fontSize: 12, fontWeight: '700' },
  locoPlain: { color: '#B9BEC7', fontSize: 12, fontWeight: '600' },
  locoPlus: { color: '#6B717C', fontSize: 12, marginHorizontal: 2 },
  locoPos: { color: '#8A909B', fontSize: 10, fontWeight: '700', marginLeft: 2 },
  staleText: { color: '#95A5A6', fontStyle: 'italic' },
  designationNote: { color: '#8A909B', fontSize: 11, fontStyle: 'italic', marginTop: 2 },

  // Designation editor
  hintText: { color: '#6B717C', fontSize: 11, lineHeight: 16, marginBottom: 4 },
  pickHint: { color: '#8A909B', fontSize: 12, lineHeight: 17, marginBottom: 10 },
  locoInputs: { flexDirection: 'row', gap: 8 },
  locoInput: { flex: 1 },
  posRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 7,
  },
  posNum: { color: '#fff', fontSize: 14, fontWeight: '700' },
  posTags: { flexDirection: 'row', gap: 6 },
  posTag: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 7,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  posTagActive: { backgroundColor: '#80276C' },
  posTagText: { color: '#B9BEC7', fontSize: 12, fontWeight: '700' },
  posTagTextActive: { color: '#fff' },
});
