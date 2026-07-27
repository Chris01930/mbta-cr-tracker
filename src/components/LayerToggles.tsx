import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useClassPresence, useStore } from '../state/store';

/**
 * Compact map-layer toggles (floating, top-right). Two groups: map layers
 * (trails / routes / stations) and train-class filters (revenue / non-revenue /
 * ghosts), which hide those classes from both the markers and the trails.
 *
 * The Non-revenue and Ghosts rows are shown only when the dataset in view
 * actually contains such a train — those states are vanishingly rare in
 * production, so the controls stay out of the way until they'd do something,
 * and reappear the instant a qualifying train arrives (live) or an archive day
 * that has them is loaded. Revenue is always shown. Hiding the row is purely
 * visibility: the underlying filter state, parsing, and rendering are untouched.
 */
export function LayerToggles() {
  const showTrails = useStore((s) => s.showTrails);
  const showRoutes = useStore((s) => s.showRoutes);
  const showStations = useStore((s) => s.showStations);
  const showRevenue = useStore((s) => s.showRevenue);
  const showNonRevenue = useStore((s) => s.showNonRevenue);
  const showGhosts = useStore((s) => s.showGhosts);
  const toggleTrails = useStore((s) => s.toggleTrails);
  const toggleRoutes = useStore((s) => s.toggleRoutes);
  const toggleStations = useStore((s) => s.toggleStations);
  const toggleRevenue = useStore((s) => s.toggleRevenue);
  const toggleNonRevenue = useStore((s) => s.toggleNonRevenue);
  const toggleGhosts = useStore((s) => s.toggleGhosts);

  const present = useClassPresence();

  return (
    <View style={styles.panel}>
      <Toggle label="Trails" on={showTrails} onPress={toggleTrails} />
      <View style={styles.divider} />
      <Toggle label="Routes" on={showRoutes} onPress={toggleRoutes} />
      <View style={styles.divider} />
      <Toggle label="Stations" on={showStations} onPress={toggleStations} />
      <View style={styles.groupDivider} />
      <Toggle label="Revenue" on={showRevenue} onPress={toggleRevenue} />
      {present.nonRevenue && (
        <>
          <View style={styles.divider} />
          <Toggle label="Non-revenue" on={showNonRevenue} onPress={toggleNonRevenue} />
        </>
      )}
      {present.ghost && (
        <>
          <View style={styles.divider} />
          <Toggle label="Ghosts" on={showGhosts} onPress={toggleGhosts} />
        </>
      )}
    </View>
  );
}

function Toggle({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.pill} onPress={onPress} accessibilityRole="switch" accessibilityState={{ checked: on }}>
      <View style={[styles.dot, on ? styles.dotOn : styles.dotOff]} />
      <Text style={[styles.label, on && styles.labelOn]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: 'rgba(20,20,24,0.92)',
    borderRadius: 10,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  pill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8 },
  dot: { width: 9, height: 9, borderRadius: 5, marginRight: 7 },
  dotOn: { backgroundColor: '#2ECC71' },
  dotOff: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#6B717C' },
  label: { color: '#8A909B', fontSize: 12, fontWeight: '700' },
  labelOn: { color: '#fff' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.12)', marginHorizontal: 8 },
  groupDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.28)', marginHorizontal: 4, marginVertical: 2 },
});
