import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useDisplayedTrains, useStore } from '../state/store';
import { dedupeTrains } from '../lib/trains';
import { agoLabel } from '../lib/time';
import { heartbeatColor, heartbeatLabel } from '../lib/format';

/**
 * Top status bar. In live mode it's the freshness heartbeat (green = streaming,
 * amber = polling, red = stale) with a live "last data Xs ago" ticker. In
 * playback (history) mode it turns into a clearly-distinct amber banner with a
 * prominent "Go Live" button, so the two modes are unmistakable.
 */
export function HeartbeatBar({
  onOpenHeritage,
  onOpenDates,
  onOpenAbout,
  onOpenRoster,
  onOpenDark,
}: {
  onOpenHeritage: () => void;
  onOpenDates: () => void;
  onOpenAbout: () => void;
  onOpenRoster: () => void;
  onOpenDark: () => void;
}) {
  const mode = useStore((s) => s.mode);
  const heartbeat = useStore((s) => s.heartbeat);
  const lastDataMs = useStore((s) => s.lastDataMs);
  const exitToLive = useStore((s) => s.exitToLive);
  const darkCount = useStore((s) => s.notTracking.length);
  const trains = useDisplayedTrains();
  const count = useMemo(() => dedupeTrains(trains).length, [trains]);
  const [, tick] = useState(0);

  // Re-render every second so the "Xs ago" ticker stays live.
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (mode === 'playback') {
    return (
      <View style={[styles.bar, styles.barPlayback]} pointerEvents="box-none">
        <View style={styles.left}>
          <View style={styles.historyDot} />
          <Text style={styles.historyLabel}>HISTORY</Text>
        </View>
        <View style={styles.actions}>
          <TouchableOpacity style={styles.goLiveBtn} onPress={exitToLive} accessibilityLabel="Go live">
            <Text style={styles.goLiveText}>● Go Live</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={onOpenRoster} accessibilityLabel="Train list">
            <Text style={styles.iconText}>☰</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={onOpenDates}>
            <Text style={styles.iconText}>Day</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.unitsBtn} onPress={onOpenHeritage} accessibilityLabel="Notable units">
            <Text style={styles.unitsText}>Units</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.bar} pointerEvents="box-none">
      <TouchableOpacity style={styles.left} onPress={onOpenRoster} accessibilityLabel="Train list">
        <View style={[styles.dot, { backgroundColor: heartbeatColor(heartbeat) }]} />
        {/* numberOfLines guards against a starved width wrapping the text one
            character per line (which made the whole bar grow very tall once the
            "not tracking" badge widened the actions row). It truncates instead. */}
        <Text style={styles.status} numberOfLines={1}>
          {heartbeatLabel(heartbeat)}
        </Text>
        {/* The train-count + freshness text is ancillary (also in the roster);
            when the "not tracking" badge is competing for the row it would be
            crushed to an unreadable ellipsis, so yield it entirely then — the
            heartbeat dot still conveys feed health. */}
        {darkCount === 0 && (
          <Text style={styles.meta} numberOfLines={1}>
            {count} train{count === 1 ? '' : 's'}
            {lastDataMs != null ? ` · ${agoLabel(lastDataMs)}` : ''}
          </Text>
        )}
      </TouchableOpacity>
      <View style={styles.actions}>
        {darkCount > 0 && (
          <TouchableOpacity
            style={styles.darkBadge}
            onPress={onOpenDark}
            accessibilityLabel={`${darkCount} trains not tracking`}
          >
            <Text style={styles.darkBadgeText}>{darkCount} not tracking</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.infoBtn} onPress={onOpenAbout} accessibilityLabel="About">
          <Text style={styles.infoText}>ⓘ</Text>
        </TouchableOpacity>
        {/* No ☰ list button here: tapping the status area on the left already
            opens the roster (same onOpenRoster), and dropping the duplicate
            keeps the action row from crowding out the status text. */}
        <TouchableOpacity style={styles.iconBtn} onPress={onOpenDates}>
          <Text style={styles.iconText}>History</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.unitsBtn} onPress={onOpenHeritage} accessibilityLabel="Notable units">
          <Text style={styles.unitsText}>Units</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const AMBER = '#F5A623';

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
  // Playback: warm amber-tinted banner with an amber border — visually
  // unmistakable vs. the neutral-dark live bar.
  barPlayback: {
    backgroundColor: 'rgba(52,40,16,0.96)',
    borderWidth: 1.5,
    borderColor: AMBER,
  },
  left: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  status: { color: '#fff', fontWeight: '700', fontSize: 13, marginRight: 8 },
  historyDot: { width: 8, height: 8, borderRadius: 2, backgroundColor: AMBER, marginRight: 8 },
  historyLabel: { color: AMBER, fontWeight: '800', fontSize: 13, letterSpacing: 1, marginRight: 8 },
  meta: { color: '#B9BEC7', fontSize: 12, flexShrink: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 10 },
  infoBtn: { paddingHorizontal: 4, paddingVertical: 4 },
  infoText: { color: '#B9BEC7', fontSize: 18, fontWeight: '600' },
  // Attention pill for dark/untracked scheduled trains — amber, like the
  // polling heartbeat and history banner, so "degraded/uncertain" reads alike.
  darkBadge: {
    backgroundColor: 'rgba(245,166,35,0.18)',
    borderColor: AMBER,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
  },
  darkBadgeText: { color: AMBER, fontWeight: '800', fontSize: 12 },
  goLiveBtn: {
    backgroundColor: '#2ECC71',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  goLiveText: { color: '#0E0F12', fontWeight: '800', fontSize: 13 },
  iconBtn: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  iconText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  // Opens the notable-units roster; labelled "Units" to fit the chip row.
  unitsBtn: {
    backgroundColor: '#80276C',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  unitsText: { color: '#fff', fontWeight: '700', fontSize: 12 },
});
