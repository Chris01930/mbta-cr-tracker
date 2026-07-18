import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { MapScreen } from './src/map/MapScreen';
import { useLivePolling } from './src/hooks/useLivePolling';
import { useStore } from './src/state/store';

/**
 * MBTA Commuter Rail Tracker — polling-only live MVP.
 * Seeds from today's archive frames, then polls the MBTA v3 API every 60s.
 */
export default function App() {
  const hydrateHeritage = useStore((s) => s.hydrateHeritage);

  // Load persisted heritage pairings once on launch.
  useEffect(() => {
    void hydrateHeritage();
  }, [hydrateHeritage]);

  // Start the live session (seed + poll + watchdog).
  useLivePolling();

  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        <StatusBar style="light" />
        <MapScreen />
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0E0F12' },
});
