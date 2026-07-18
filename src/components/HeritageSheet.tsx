import React, { useMemo, useState } from 'react';
import { FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { HERITAGE_UNITS } from '../constants/heritage';
import { routeShort } from '../constants/routes';
import { useDisplayedTrains, useStore } from '../state/store';
import { dedupeTrains } from '../lib/trains';

/**
 * Heritage pairing editor. Each of the six units can be assigned to the cab of
 * a currently-active consist (assign/reassign/unassign). We NEVER auto-match a
 * label to a unit number — the user chooses from live cabs explicitly. Pairing
 * persists on-device and repaints affected markers immediately (store-driven).
 */
export function HeritageSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const heritage = useStore((s) => s.heritage);
  const trains = useDisplayedTrains();
  const pairHeritage = useStore((s) => s.pairHeritage);
  const unpairHeritage = useStore((s) => s.unpairHeritage);

  // When set, we're picking a cab to assign to this unit number.
  const [assigning, setAssigning] = useState<string | null>(null);

  const activeCabs = useMemo(
    () =>
      dedupeTrains(trains)
        .filter((t) => !!t.cab)
        .map((t) => ({ cab: t.cab as string, train: t.train, route: t.route }))
        .sort((a, b) => a.cab.localeCompare(b.cab)),
    [trains],
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{assigning ? `Assign unit ${assigning}` : 'Heritage units'}</Text>
            <TouchableOpacity onPress={assigning ? () => setAssigning(null) : onClose}>
              <Text style={styles.close}>{assigning ? 'Back' : 'Done'}</Text>
            </TouchableOpacity>
          </View>

          {!assigning ? (
            <FlatList
              data={HERITAGE_UNITS}
              keyExtractor={(u) => u.number}
              renderItem={({ item }) => {
                const cab = heritage[item.number];
                return (
                  <View style={styles.row}>
                    <View style={styles.rowLeft}>
                      <Text style={styles.unitNum}>{item.number}</Text>
                      <View>
                        <Text style={styles.unitName}>{item.name}</Text>
                        <Text style={styles.pairing}>
                          {cab ? `Paired to Cab ${cab}` : 'Not paired'}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.actions}>
                      <TouchableOpacity style={styles.assignBtn} onPress={() => setAssigning(item.number)}>
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
            <FlatList
              data={activeCabs}
              keyExtractor={(c) => c.cab}
              ListEmptyComponent={<Text style={styles.note}>No active trains to pair right now.</Text>}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.cabRow}
                  onPress={() => {
                    pairHeritage(assigning, item.cab);
                    setAssigning(null);
                  }}
                >
                  <Text style={styles.cabNum}>Cab {item.cab}</Text>
                  <Text style={styles.cabMeta}>
                    {item.train ? `Trn ${item.train} · ` : ''}
                    {routeShort(item.route)}
                  </Text>
                </TouchableOpacity>
              )}
            />
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
  unitNum: {
    color: '#F5C518',
    fontWeight: '800',
    fontSize: 16,
    width: 48,
  },
  unitName: { color: '#fff', fontSize: 14, fontWeight: '600' },
  pairing: { color: '#8A909B', fontSize: 12, marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  assignBtn: { backgroundColor: '#80276C', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  assignText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  clearBtn: { paddingHorizontal: 8, paddingVertical: 7 },
  clearText: { color: '#E74C3C', fontWeight: '700', fontSize: 12 },
  cabRow: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  cabNum: { color: '#fff', fontSize: 15, fontWeight: '700' },
  cabMeta: { color: '#8A909B', fontSize: 12, marginTop: 2 },
  note: { color: '#6B717C', fontSize: 12, marginTop: 16, lineHeight: 17 },
});
