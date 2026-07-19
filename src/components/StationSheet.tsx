import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { loadSchedules, resolveStation, type ScheduleRow } from '../api/mbta';
import { formatClock } from '../lib/time';

/**
 * Station schedule sheet. On station tap we resolve the nearest CR stop's
 * parent station by proximity, then load today's timetable (cached implicitly
 * by only fetching on open). Stations with no nearby CR stop show a message.
 */
export interface StationTarget {
  name: string;
  lng: number;
  lat: number;
}

type DirFilter = 'all' | 'inbound' | 'outbound';
const DIR_FILTERS: { key: DirFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'inbound', label: 'Inbound' },
  { key: 'outbound', label: 'Outbound' },
];

export function StationSheet({ target, onClose }: { target: StationTarget | null; onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ScheduleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<DirFilter>('all');

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setLoading(true);
    setRows(null);
    setError(null);
    setFilter('all');
    (async () => {
      try {
        const station = await resolveStation(target.lat, target.lng);
        if (cancelled) return;
        if (!station) {
          setError('No MBTA service at this station.');
          setLoading(false);
          return;
        }
        const schedules = await loadSchedules(station.id);
        if (cancelled) return;
        // Show only upcoming departures/arrivals.
        const now = Date.now();
        setRows(schedules.filter((r) => new Date(r.time).getTime() >= now - 60_000).slice(0, 40));
        setLoading(false);
      } catch {
        if (!cancelled) {
          setError('Could not load schedule.');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target]);

  return (
    <Modal visible={!!target} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>
              {target?.name ?? 'Station'}
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.close}>Done</Text>
            </TouchableOpacity>
          </View>

          {loading && <ActivityIndicator color="#F5C518" style={{ marginTop: 20 }} />}
          {error && <Text style={styles.note}>{error}</Text>}
          {rows && (
            <>
              <View style={styles.segment}>
                {DIR_FILTERS.map((f) => {
                  const active = filter === f.key;
                  return (
                    <TouchableOpacity
                      key={f.key}
                      style={[styles.segmentBtn, active && styles.segmentBtnActive]}
                      onPress={() => setFilter(f.key)}
                    >
                      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{f.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <FlatList
                data={rows.filter((r) => matchesFilter(r, filter))}
                keyExtractor={(_, i) => String(i)}
                ListEmptyComponent={<Text style={styles.note}>No more trains today.</Text>}
                renderItem={({ item }) => (
                  <View style={styles.row}>
                    <View style={styles.rowLeft}>
                      <View style={[styles.dirTag, item.directionId === 1 ? styles.dirIn : styles.dirOut]}>
                        <Text style={styles.dirTagText}>{item.directionId === 1 ? 'IN' : 'OUT'}</Text>
                      </View>
                      <View style={{ flexShrink: 1 }}>
                        <Text style={styles.dest} numberOfLines={1}>
                          {item.headsign ?? '—'}
                        </Text>
                        <Text style={styles.trn}>{item.tripName ? `Train ${item.tripName}` : ''}</Text>
                      </View>
                    </View>
                    <Text style={styles.time}>{formatClock(item.time)}</Text>
                  </View>
                )}
              />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

// Inbound = toward Boston (direction_id 1), Outbound = away (direction_id 0).
function matchesFilter(r: ScheduleRow, filter: DirFilter): boolean {
  if (filter === 'inbound') return r.directionId === 1;
  if (filter === 'outbound') return r.directionId === 0;
  return true;
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
    maxHeight: '75%',
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title: { color: '#fff', fontSize: 18, fontWeight: '800', flexShrink: 1, marginRight: 10 },
  close: { color: '#F5C518', fontSize: 15, fontWeight: '700' },
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
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  dirTag: {
    width: 34,
    paddingVertical: 2,
    borderRadius: 4,
    alignItems: 'center',
    marginRight: 10,
  },
  dirIn: { backgroundColor: 'rgba(46,204,113,0.22)' },
  dirOut: { backgroundColor: 'rgba(52,152,219,0.22)' },
  dirTagText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  dest: { color: '#fff', fontSize: 14, fontWeight: '600' },
  trn: { color: '#8A909B', fontSize: 12, marginTop: 2 },
  time: { color: '#F5C518', fontSize: 15, fontWeight: '700', marginLeft: 10 },
  note: { color: '#8A909B', fontSize: 13, marginTop: 20, textAlign: 'center' },
});
