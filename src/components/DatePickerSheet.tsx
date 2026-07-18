import React, { useMemo } from 'react';
import { FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CONFIG } from '../config';
import { loadDayFrames, NoDataError } from '../api/frames';
import { availableDates, easternDateKey, friendlyDate } from '../lib/time';
import { useStore } from '../state/store';

/**
 * Date picker for historical playback. Lists every service day the archive
 * could have (archiveStartDate → today, newest first). Selecting a day loads
 * its frames file; a 403 (NoDataError) surfaces as "No data for this day".
 */
export function DatePickerSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const setPlaybackLoading = useStore((s) => s.setPlaybackLoading);
  const enterPlayback = useStore((s) => s.enterPlayback);
  const setPlaybackError = useStore((s) => s.setPlaybackError);
  const playbackDate = useStore((s) => s.playbackDate);
  const mode = useStore((s) => s.mode);

  const today = easternDateKey();
  const dates = useMemo(() => availableDates(CONFIG.archiveStartDate, today), [today]);

  const onPick = async (date: string) => {
    onClose();
    setPlaybackLoading(date);
    try {
      const day = await loadDayFrames(date);
      enterPlayback(date, day);
    } catch (err) {
      const msg = err instanceof NoDataError ? 'No archive data for this day.' : 'Could not load that day.';
      setPlaybackError(date, msg);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Play back a day</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.close}>Cancel</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={dates}
            keyExtractor={(d) => d}
            renderItem={({ item }) => {
              const isToday = item === today;
              const isSelected = mode === 'playback' && item === playbackDate;
              return (
                <TouchableOpacity style={styles.row} onPress={() => onPick(item)}>
                  <Text style={[styles.date, isSelected && styles.dateSelected]}>
                    {friendlyDate(item)}
                    {isToday ? '  · Today' : ''}
                  </Text>
                  <Text style={styles.iso}>{item}</Text>
                </TouchableOpacity>
              );
            }}
            ListFooterComponent={
              <Text style={styles.note}>
                Archive begins {friendlyDate(CONFIG.archiveStartDate)}. Days before 07-16 were
                polled every 5 minutes; later days every minute.
              </Text>
            }
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
    maxHeight: '70%',
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  title: { color: '#fff', fontSize: 18, fontWeight: '800' },
  close: { color: '#F5C518', fontSize: 15, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  date: { color: '#fff', fontSize: 15, fontWeight: '600' },
  dateSelected: { color: '#F5C518' },
  iso: { color: '#8A909B', fontSize: 12 },
  note: { color: '#6B717C', fontSize: 12, marginTop: 16, lineHeight: 17 },
});
