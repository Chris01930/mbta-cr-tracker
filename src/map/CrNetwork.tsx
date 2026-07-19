import React, { useMemo } from 'react';
import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import type { NativeSyntheticEvent } from 'react-native';
import { lineColor } from '../constants/routes';
import { CONFIG } from '../config';
import rawLines from '../data/crLines.json';
import rawStations from '../data/crStations.json';

/**
 * Static MBTA CR network overlay from bundled MassGIS data: revenue lines
 * colored per-route, plus the 150 stations as tappable dots. Rendered beneath
 * the live train markers.
 */

// Precompute a per-feature color so the LineLayer can be data-driven without a
// giant match expression.
const linesWithColor = {
  type: 'FeatureCollection' as const,
  features: (rawLines as GeoJSON.FeatureCollection).features.map((f) => ({
    ...f,
    properties: { ...f.properties, color: lineColor((f.properties as { line?: string })?.line) },
  })),
};

interface Props {
  onStationPress?: (name: string, lng: number, lat: number) => void;
  /** Show the colored route lines. Stations stay tappable regardless. */
  showLines?: boolean;
}

export function CrNetwork({ onStationPress, showLines = true }: Props) {
  const stations = useMemo(() => rawStations as unknown as GeoJSON.FeatureCollection, []);

  const handleStationPress = (e: NativeSyntheticEvent<unknown>) => {
    // GeoJSONSource onPress delivers the tapped feature(s) in the event payload.
    const payload = e.nativeEvent as unknown as {
      features?: Array<GeoJSON.Feature<GeoJSON.Point, { name?: string }>>;
    };
    const feat = payload.features?.[0];
    if (!feat) return;
    const [lng, lat] = feat.geometry.coordinates;
    onStationPress?.(feat.properties?.name ?? 'Station', lng, lat);
  };

  return (
    <>
      {showLines && (
        <GeoJSONSource id="cr-lines" data={linesWithColor}>
          <Layer
            id="cr-lines-line"
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{
              'line-color': ['get', 'color'],
              'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.2, 11, 3, 14, 5],
              'line-opacity': 0.85,
            }}
          />
        </GeoJSONSource>
      )}

      <GeoJSONSource id="cr-stations" data={stations} onPress={handleStationPress}>
        <Layer
          id="cr-stations-halo"
          type="circle"
          paint={{
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 12, 5, 15, 7],
            'circle-color': '#ffffff',
            'circle-stroke-color': CONFIG.brandColor,
            'circle-stroke-width': 1.5,
            'circle-opacity': 0.95,
          }}
        />
      </GeoJSONSource>
    </>
  );
}
