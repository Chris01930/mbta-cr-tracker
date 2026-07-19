import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { MapScreen } from './src/map/MapScreen';
import { useLivePolling } from './src/hooks/useLivePolling';
import { useStore } from './src/state/store';
import { useConfigStore } from './src/config/configStore';

/**
 * MBTA Commuter Rail Tracker — polling-only live MVP.
 * Seeds from today's archive frames, then polls the MBTA v3 API every 60s.
 */
export default function App() {
  const hydrateHeritage = useStore((s) => s.hydrateHeritage);
  const hydrateConfig = useConfigStore((s) => s.hydrate);
  const refreshConfig = useConfigStore((s) => s.refresh);

  // Load runtime config (cached copy + fresh fetch) and persisted heritage.
  useEffect(() => {
    void hydrateConfig();
    void refreshConfig();
    void hydrateHeritage();
  }, [hydrateConfig, refreshConfig, hydrateHeritage]);

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
