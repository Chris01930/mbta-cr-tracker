import React from 'react';
import { FlatList, Modal, StyleSheet, Text, View } from 'react-native';
import { routeShort } from '../constants/routes';
import { darkLabel, type DarkTrip } from '../lib/notTracking';
import { formatClock } from '../lib/time';
import { useStore } from '../state/store';

/**
 * "Not tracking" list: scheduled trips running but absent from the live feed.
 * A list, never map markers — the map only renders reported positions, so a
 * dark train's absence lives here. Rows are sorted longest-dark first (by the
 * store) and enriched from the train number (line/branch + direction).
 *
 * Some rows may in fact be canceled rather than dark — v1 has no alerts feed to
 * tell them apart, hence the footer caveat.
 */
export function NotTrackingSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const rows = useStore((s) => s.notTracking);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flexShrink: 1 }}>
              <Text style={styles.title}>Not tracking</Text>
              <Text style={styles.subtitle}>
                {rows.length} scheduled {rows.length === 1 ? 'train' : 'trains'} not in the live feed
              </Text>
            </View>
            <Text style={styles.close} onPress={onClose}>
              Done
            </Text>
          </View>

          <FlatList
            data={rows}
            keyExtractor={(r) => r.tripId}
            ListEmptyComponent={
              <Text style={styles.note}>Every scheduled train is currently tracking.</Text>
            }
            renderItem={({ item }) => <DarkRow trip={item} />}
            ListFooterComponent={
              rows.length > 0 ? (
                <Text style={styles.footer}>Trains listed may be running untracked or canceled.</Text>
              ) : null
            }
          />
        </View>
      </View>
    </Modal>
  );
}

function DarkRow({ trip }: { trip: DarkTrip }) {
  const line = routeShort(trip.routeId) || trip.info?.branch || 'Unknown';
  const dir = trip.info?.direction; // even = inbound, odd = outbound

  return (
    <View style={styles.row}>
      <View style={styles.rowHead}>
        {dir && (
          <View style={[styles.dirTag, dir === 'inbound' ? styles.dirIn : styles.dirOut]}>
            <Text style={styles.dirTagText}>{dir === 'inbound' ? 'IN' : 'OUT'}</Text>
          </View>
        )}
        <Text style={styles.headText} numberOfLines={2}>
          <Text style={styles.trn}>{trip.trainNumber ? `Trn ${trip.trainNumber}` : 'Trn ?'}</Text>
          <Text style={styles.dot}> · </Text>
          {line}
          {trip.headsign ? <Text style={styles.dest}>{` · → ${trip.headsign}`}</Text> : null}
        </Text>
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.dark}>{darkLabel(trip.darkMs)}</Text>
        {trip.info?.weekend && <Text style={styles.weekend}>weekend sched</Text>}
      </View>

      {trip.nextStops.length > 0 && (
        <View style={styles.stops}>
          {trip.nextStops.map((s, i) => (
            <View key={`${s.name}-${i}`} style={styles.stopRow}>
              <Text style={styles.stopName} numberOfLines={1}>
                {s.name}
              </Text>
              <Text style={styles.stopTime}>{formatClock(s.timeMs)}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
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
  close: { color: '#F5C518', fontSize: 15, fontWeight: '700', marginLeft: 10, paddingVertical: 2 },

  row: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  rowHead: { flexDirection: 'row', alignItems: 'flex-start' },
  dirTag: { width: 34, paddingVertical: 2, borderRadius: 4, alignItems: 'center', marginRight: 10, marginTop: 1 },
  dirIn: { backgroundColor: 'rgba(46,204,113,0.22)' },
  dirOut: { backgroundColor: 'rgba(52,152,219,0.22)' },
  dirTagText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  headText: { color: '#fff', fontSize: 14, fontWeight: '600', flexShrink: 1 },
  trn: { color: '#fff', fontWeight: '800' },
  dot: { color: '#6B717C' },
  dest: { color: '#B9BEC7', fontWeight: '400' },

  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 5, marginLeft: 44, gap: 8 },
  dark: { color: '#F5A623', fontSize: 12, fontWeight: '800' },
  weekend: {
    color: '#8A909B',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

  stops: { marginTop: 8, marginLeft: 44, gap: 3 },
  stopRow: { flexDirection: 'row', justifyContent: 'space-between' },
  stopName: { color: '#B9BEC7', fontSize: 12, flexShrink: 1, marginRight: 8 },
  stopTime: { color: '#8A909B', fontSize: 12, fontWeight: '600' },

  note: { color: '#8A909B', fontSize: 13, marginTop: 24, textAlign: 'center' },
  footer: { color: '#6B717C', fontSize: 11, marginTop: 16, lineHeight: 16, fontStyle: 'italic' },
});
