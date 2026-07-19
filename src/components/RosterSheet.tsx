import React, { useMemo, useState } from 'react';
import { FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useStore } from '../state/store';
import { routeColor, routeShort } from '../constants/routes';
import { trainTitle } from '../lib/trains';
import { buildRoster, filterRoster, rosterCounts, type RosterFilter } from '../lib/roster';

/**
 * Roster sheet: every distinct train in the current day's data — the live
 * session so far, or the whole archived day in history mode — not just the
 * current instant. Filter chips isolate non-revenue and ghost trains. Tapping a
 * row selects it on the map (and seeks to its latest fix in playback).
 */
export function RosterSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const mode = useStore((s) => s.mode);
  const liveFrames = useStore((s) => s.frames);
  const liveTrains = useStore((s) => s.trains);
  const playbackDay = useStore((s) => s.playbackDay);
  const selectKey = useStore((s) => s.selectKey);
  const setPlaybackIndex = useStore((s) => s.setPlaybackIndex);
  const [filter, setFilter] = useState<RosterFilter>('all');

  // Source: whole archived day in history, else the live session's frames + now.
  const roster = useMemo(() => {
    if (mode === 'playback') return buildRoster(playbackDay?.frames ?? []);
    return buildRoster(liveFrames, liveTrains);
  }, [mode, playbackDay, liveFrames, liveTrains]);

  const counts = useMemo(() => rosterCounts(roster), [roster]);
  const rows = useMemo(() => filterRoster(roster, filter), [roster, filter]);

  const filters: { key: RosterFilter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: counts.all },
    { key: 'nonRevenue', label: 'Non-revenue', count: counts.nonRevenue },
    { key: 'ghost', label: 'Ghosts', count: counts.ghost },
  ];

  const onRow = (key: string, lastFrameIndex: number) => {
    if (mode === 'playback' && lastFrameIndex >= 0) setPlaybackIndex(lastFrameIndex);
    selectKey(key);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flexShrink: 1 }}>
              <Text style={styles.title}>Trains</Text>
              <Text style={styles.subtitle}>
                {mode === 'playback' ? 'Archived day' : 'Live session'} · {counts.all} total
              </Text>
            </View>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.close}>Done</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.segment}>
            {filters.map((f) => {
              const active = filter === f.key;
              return (
                <TouchableOpacity
                  key={f.key}
                  style={[styles.segmentBtn, active && styles.segmentBtnActive]}
                  onPress={() => setFilter(f.key)}
                >
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]} numberOfLines={1}>
                    {f.label} {f.count}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <FlatList
            data={rows}
            keyExtractor={(r) => r.key}
            ListEmptyComponent={
              <Text style={styles.note}>
                {filter === 'ghost'
                  ? 'No ghost trains in this data.'
                  : filter === 'nonRevenue'
                    ? 'No non-revenue trains in this data.'
                    : 'No trains yet.'}
              </Text>
            }
            renderItem={({ item }) => {
              const t = item.train;
              return (
                <TouchableOpacity style={styles.row} onPress={() => onRow(item.key, item.lastFrameIndex)}>
                  <View style={[styles.routeDot, { backgroundColor: routeColor(t.route) }]} />
                  <View style={styles.rowMid}>
                    <Text style={styles.name} numberOfLines={1}>
                      {trainTitle(t)}
                    </Text>
                    <Text style={styles.sub} numberOfLines={1}>
                      {routeShort(t.route)}
                      {t.dest ? ` · ${t.dest}` : ''}
                    </Text>
                  </View>
                  <View style={styles.tags}>
                    {t.isGhost && (
                      <View style={[styles.tag, styles.ghostTag]}>
                        <Text style={[styles.tagText, styles.ghostText]}>GHOST</Text>
                      </View>
                    )}
                    {t.isNonRevenue && (
                      <View style={[styles.tag, styles.nonRevTag]}>
                        <Text style={[styles.tagText, styles.nonRevText]}>NON-REV</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            }}
          />
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
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  title: { color: '#fff', fontSize: 18, fontWeight: '800' },
  subtitle: { color: '#8A909B', fontSize: 12, marginTop: 2 },
  close: { color: '#F5C518', fontSize: 15, fontWeight: '700', marginLeft: 10 },
  segment: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 9,
    padding: 3,
    marginBottom: 10,
  },
  segmentBtn: { flex: 1, paddingVertical: 7, paddingHorizontal: 4, borderRadius: 7, alignItems: 'center' },
  segmentBtnActive: { backgroundColor: '#80276C' },
  segmentText: { color: '#B9BEC7', fontSize: 12, fontWeight: '700' },
  segmentTextActive: { color: '#fff' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  routeDot: { width: 12, height: 12, borderRadius: 6, marginRight: 12 },
  rowMid: { flexShrink: 1, flexGrow: 1 },
  name: { color: '#fff', fontSize: 14, fontWeight: '600' },
  sub: { color: '#8A909B', fontSize: 12, marginTop: 2 },
  tags: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 8 },
  tag: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5, borderWidth: 1 },
  ghostTag: { borderColor: '#5EC8D8', borderStyle: 'dashed', backgroundColor: 'rgba(94,200,216,0.12)' },
  ghostText: { color: '#8FE0EC' },
  nonRevTag: { borderColor: '#F5A623', backgroundColor: 'rgba(245,166,35,0.12)' },
  nonRevText: { color: '#F5C77E' },
  tagText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  note: { color: '#8A909B', fontSize: 13, marginTop: 24, textAlign: 'center' },
});
