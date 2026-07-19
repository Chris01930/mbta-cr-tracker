import React, { useMemo } from 'react';
import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import { useStore } from '../state/store';
import { useConfigStore } from '../config/configStore';
import { buildTrails } from '../lib/trails';

/**
 * Movement trails overlay. Source frames are the live session history (capped)
 * or, in playback, the day's frames up to the current scrub position — so
 * trails grow as you play. Colored per route; rendered under the train markers.
 */
export function Trails() {
  const mode = useStore((s) => s.mode);
  const liveFrames = useStore((s) => s.frames);
  const playbackDay = useStore((s) => s.playbackDay);
  const playbackIndex = useStore((s) => s.playbackIndex);
  const trailsCfg = useConfigStore((s) => s.config.trails);
  const cap = useConfigStore((s) => s.config.live.maxSessionFrames);

  // Derive the frame window in useMemo (not a selector) so the store snapshot
  // stays a stable reference — a slice in a selector would loop.
  const frames = useMemo(() => {
    if (mode === 'playback' && playbackDay) {
      const end = playbackIndex + 1;
      return playbackDay.frames.slice(Math.max(0, end - cap), end);
    }
    return liveFrames;
  }, [mode, playbackDay, playbackIndex, liveFrames, cap]);

  const data = useMemo(() => buildTrails(frames, trailsCfg), [frames, trailsCfg]);

  return (
    <GeoJSONSource id="trails" data={data}>
      <Layer
        id="trails-line"
        type="line"
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        paint={{
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.5, 12, 3, 15, 4.5],
          'line-opacity': 0.9,
        }}
      />
    </GeoJSONSource>
  );
}
