import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useDisplayedTrains, useStore } from '../state/store';
import { dedupeTrains } from '../lib/trains';
import { agoLabel } from '../lib/time';
import { heartbeatColor, heartbeatLabel } from '../lib/format';

/**
 * Top status bar. In live mode it's the freshness heartbeat (green = streaming,
 * amber = polling, red = stale) with a live "last data Xs ago" ticker. In
 * playback mode it shows a Playback pill. Both modes expose Heritage + History.
 */
export function HeartbeatBar({
  onOpenHeritage,
  onOpenDates,
}: {
  onOpenHeritage: () => void;
  onOpenDates: () => void;
}) {
  const mode = useStore((s) => s.mode);
  const heartbeat = useStore((s) => s.heartbeat);
  const lastDataMs = useStore((s) => s.lastDataMs);
  const exitToLive = useStore((s) => s.exitToLive);
  const trains = useDisplayedTrains();
  const count = useMemo(() => dedupeTrains(trains).length, [trains]);
  const [, tick] = useState(0);

  // Re-render every second so the "Xs ago" ticker stays live.
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const isPlayback = mode === 'playback';

  return (
    <View style={styles.bar} pointerEvents="box-none">
      <View style={styles.left}>
        {isPlayback ? (
          // Prominent, always-visible way to jump straight back to live.
          <TouchableOpacity style={styles.liveBtn} onPress={exitToLive}>
            <Text style={styles.liveText}>● Live</Text>
          </TouchableOpacity>
        ) : (
          <>
            <View style={[styles.dot, { backgroundColor: heartbeatColor(heartbeat) }]} />
            <Text style={styles.status}>{heartbeatLabel(heartbeat)}</Text>
          </>
        )}
        <Text style={styles.meta}>
          {count} train{count === 1 ? '' : 's'}
          {!isPlayback && lastDataMs != null ? ` · ${agoLabel(lastDataMs)}` : ''}
        </Text>
      </View>
      <View style={styles.actions}>
        <TouchableOpacity style={styles.iconBtn} onPress={onOpenDates}>
          <Text style={styles.iconText}>History</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.heritageBtn} onPress={onOpenHeritage}>
          <Text style={styles.heritageText}>Heritage</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(20,20,24,0.92)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  left: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  status: { color: '#fff', fontWeight: '700', fontSize: 13, marginRight: 8 },
  liveBtn: {
    backgroundColor: '#2ECC71',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
    marginRight: 8,
  },
  liveText: { color: '#0E0F12', fontWeight: '800', fontSize: 13 },
  meta: { color: '#B9BEC7', fontSize: 12, flexShrink: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 10 },
  iconBtn: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  iconText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  heritageBtn: {
    backgroundColor: '#80276C',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  heritageText: { color: '#fff', fontWeight: '700', fontSize: 12 },
});
