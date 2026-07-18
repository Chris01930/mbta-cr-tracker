import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { CONFIG } from '../config';
import { currentPlaybackFrame, useStore } from '../state/store';
import { formatClock, friendlyDate } from '../lib/time';

/**
 * Historical playback transport: a scrub slider across the day's frames plus
 * play/pause, speed, and a button back to live. Shown only in playback mode.
 */
export function PlaybackBar() {
  const day = useStore((s) => s.playbackDay);
  const date = useStore((s) => s.playbackDate);
  const index = useStore((s) => s.playbackIndex);
  const playing = useStore((s) => s.playbackPlaying);
  const speed = useStore((s) => s.playbackSpeed);
  const loading = useStore((s) => s.playbackLoading);
  const error = useStore((s) => s.playbackError);
  const frame = useStore(currentPlaybackFrame);

  const setPlaybackIndex = useStore((s) => s.setPlaybackIndex);
  const setPlaybackPlaying = useStore((s) => s.setPlaybackPlaying);
  const setPlaybackSpeed = useStore((s) => s.setPlaybackSpeed);
  const stepPlayback = useStore((s) => s.stepPlayback);
  const exitToLive = useStore((s) => s.exitToLive);

  const frameCount = day?.frames.length ?? 0;
  const trainCount = frame?.trains.length ?? 0;

  const cycleSpeed = () => {
    const speeds = CONFIG.playbackSpeeds;
    const i = speeds.indexOf(speed as (typeof speeds)[number]);
    setPlaybackSpeed(speeds[(i + 1) % speeds.length]);
  };

  return (
    <View style={styles.bar}>
      <View style={styles.topRow}>
        <View>
          <Text style={styles.date}>{date ? friendlyDate(date) : 'Playback'}</Text>
          {loading ? (
            <Text style={styles.time}>Loading…</Text>
          ) : error ? (
            <Text style={styles.error}>{error}</Text>
          ) : (
            <Text style={styles.time}>
              {frame ? formatClock(frame.time) : '—'} · {trainCount} train{trainCount === 1 ? '' : 's'}
            </Text>
          )}
        </View>
        <TouchableOpacity style={styles.liveBtn} onPress={exitToLive}>
          <Text style={styles.liveText}>● Live</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color="#F5C518" style={{ marginVertical: 14 }} />
      ) : (
        !error && (
          <>
            <View style={styles.transport}>
              <TouchableOpacity style={styles.ctrl} onPress={() => stepPlayback(-1)}>
                <Text style={styles.ctrlText}>⟸</Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.ctrl, styles.playBtn]} onPress={() => setPlaybackPlaying(!playing)}>
                <Text style={styles.playText}>{playing ? '❚❚' : '▶'}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.ctrl} onPress={() => stepPlayback(1)}>
                <Text style={styles.ctrlText}>⟹</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.speedBtn} onPress={cycleSpeed}>
                <Text style={styles.speedText}>{speed}×</Text>
              </TouchableOpacity>
            </View>

            <Slider
              style={styles.slider}
              minimumValue={0}
              maximumValue={Math.max(0, frameCount - 1)}
              step={1}
              value={index}
              minimumTrackTintColor="#F5C518"
              maximumTrackTintColor="rgba(255,255,255,0.25)"
              thumbTintColor="#fff"
              onValueChange={(v) => {
                if (playing) setPlaybackPlaying(false);
                setPlaybackIndex(v);
              }}
            />
          </>
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: 'rgba(20,20,24,0.96)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  date: { color: '#fff', fontSize: 15, fontWeight: '800' },
  time: { color: '#B9BEC7', fontSize: 12, marginTop: 2 },
  error: { color: '#E74C3C', fontSize: 12, marginTop: 2 },
  liveBtn: { backgroundColor: '#2ECC71', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8 },
  liveText: { color: '#0E0F12', fontWeight: '800', fontSize: 13 },
  transport: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 10 },
  ctrl: {
    width: 40,
    height: 36,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctrlText: { color: '#fff', fontSize: 16 },
  playBtn: { backgroundColor: '#80276C' },
  playText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  speedBtn: {
    marginLeft: 'auto',
    paddingHorizontal: 14,
    height: 36,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedText: { color: '#F5C518', fontWeight: '800', fontSize: 14 },
  slider: { marginTop: 4, height: 36 },
});
