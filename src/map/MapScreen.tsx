import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, Map } from '@maplibre/maplibre-react-native';
import { CONFIG } from '../config';
import { useStore } from '../state/store';
import { usePlayback } from '../hooks/usePlayback';
import { CrNetwork } from './CrNetwork';
import { TrainMarkers } from './TrainMarkers';
import { HeartbeatBar } from '../components/HeartbeatBar';
import { InspectCard } from '../components/InspectCard';
import { PlaybackBar } from '../components/PlaybackBar';
import { HeritageSheet } from '../components/HeritageSheet';
import { DatePickerSheet } from '../components/DatePickerSheet';
import { StationSheet, type StationTarget } from '../components/StationSheet';
import { AboutSheet } from '../components/AboutSheet';

/**
 * The single map screen: MapLibre basemap + CR network overlay + train markers
 * (live or scrubbed), with the status bar on top and the inspect card /
 * playback transport at the bottom.
 */
export function MapScreen() {
  const cycleInspect = useStore((s) => s.cycleInspect);
  const selectCab = useStore((s) => s.selectCab);
  const mode = useStore((s) => s.mode);
  const [heritageOpen, setHeritageOpen] = useState(false);
  const [datesOpen, setDatesOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [station, setStation] = useState<StationTarget | null>(null);

  // Tapping a marker also registers as a map tap on iOS; ignore that map tap
  // (which would otherwise deselect) briefly after a marker tap wins.
  const markerTapAt = useRef(0);

  const handleMarkerSelect = useCallback(
    (cab: string) => {
      markerTapAt.current = Date.now();
      cycleInspect(cab);
    },
    [cycleInspect],
  );

  const handleMapPress = useCallback(() => {
    // Marker taps also fire the map's onPress on iOS; ignore it briefly so the
    // selection a marker just made isn't immediately cleared.
    if (Date.now() - markerTapAt.current < 400) return;
    selectCab(null);
  }, [selectCab]);

  // Round the playback frame's corners to match the physical screen on devices
  // with a notch/Dynamic Island (large top inset); square screens keep square.
  const insets = useSafeAreaInsets();
  const screenCornerRadius = insets.top > 30 ? 55 : 0;

  // Drives the playback timeline when playing (no-op in live mode).
  usePlayback();

  return (
    <View style={styles.root}>
      <Map
        style={styles.map}
        mapStyle={CONFIG.mapStyleUrl}
        logo
        attribution
        compass
        onPress={handleMapPress}
      >
        <Camera
          initialViewState={{
            center: CONFIG.initialCenter,
            zoom: CONFIG.initialZoom,
          }}
        />
        <CrNetwork onStationPress={(name, lng, lat) => setStation({ name, lng, lat })} />
        <TrainMarkers onSelect={handleMarkerSelect} />
      </Map>

      {/* Ambient cue: amber frame around the map while viewing history. */}
      {mode === 'playback' && (
        <View
          style={[styles.playbackFrame, { borderRadius: screenCornerRadius }]}
          pointerEvents="none"
        />
      )}

      {/* Overlays */}
      <SafeAreaView style={styles.overlay} pointerEvents="box-none" edges={['top', 'bottom']}>
        <View style={styles.topBar} pointerEvents="box-none">
          <HeartbeatBar
            onOpenHeritage={() => setHeritageOpen(true)}
            onOpenDates={() => setDatesOpen(true)}
            onOpenAbout={() => setAboutOpen(true)}
          />
        </View>
        <View style={styles.bottomBar} pointerEvents="box-none">
          <InspectCard />
          {mode === 'playback' && <PlaybackBar />}
        </View>
      </SafeAreaView>

      <HeritageSheet visible={heritageOpen} onClose={() => setHeritageOpen(false)} />
      <DatePickerSheet visible={datesOpen} onClose={() => setDatesOpen(false)} />
      <AboutSheet visible={aboutOpen} onClose={() => setAboutOpen(false)} />
      <StationSheet target={station} onClose={() => setStation(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  map: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'space-between',
  },
  topBar: { paddingHorizontal: 12, paddingTop: 8 },
  bottomBar: { paddingHorizontal: 12, paddingBottom: 8, gap: 8 },
  playbackFrame: {
    ...StyleSheet.absoluteFill,
    borderWidth: 3,
    borderColor: '#F5A623',
  },
});
