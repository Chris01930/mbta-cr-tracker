import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { MapScreen } from './src/map/MapScreen';
import { useLiveSession } from './src/hooks/useLiveSession';
import { useHeritageNotifications } from './src/hooks/useHeritageNotifications';
import { useStore } from './src/state/store';
import { useConfigStore } from './src/config/configStore';
import { configureNotifications, ensureNotifyPermission } from './src/lib/notify';

/**
 * MBTA Commuter Rail Tracker. Seeds from today's archive frames, then follows
 * the MBTA v3 API live — SSE streaming when remote config supplies a key,
 * 60s keyless polling otherwise.
 */
export default function App() {
  const hydrateHeritage = useStore((s) => s.hydrateHeritage);
  const hydrateLayerPrefs = useStore((s) => s.hydrateLayerPrefs);
  const hydrateConfig = useConfigStore((s) => s.hydrate);
  const refreshConfig = useConfigStore((s) => s.refresh);

  // Load runtime config (cached copy + fresh fetch), persisted heritage + prefs,
  // and set up notifications (handler + permission) for heritage-arrival alerts.
  // expo-notifications is touched only here (post-mount), never at module scope.
  useEffect(() => {
    void hydrateConfig();
    void refreshConfig();
    void hydrateHeritage();
    void hydrateLayerPrefs();
    configureNotifications();
    void ensureNotifyPermission();
  }, [hydrateConfig, refreshConfig, hydrateHeritage, hydrateLayerPrefs]);

  // Start the live session (seed + stream-or-poll + watchdog).
  useLiveSession();

  // Notify when a heritage locomotive newly appears in the live feed.
  useHeritageNotifications();

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
