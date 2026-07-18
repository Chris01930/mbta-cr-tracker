import React, { useMemo } from 'react';
import { Marker } from '@maplibre/maplibre-react-native';
import { routeColor } from '../constants/routes';
import { cabToUnit, useDisplayedTrains, useStore } from '../state/store';
import { dedupeTrains, trainKey } from '../lib/trains';
import { TrainMarkerIcon } from '../components/TrainMarkerIcon';

/**
 * Renders one tappable Marker per plottable train. Markers repaint immediately
 * when a heritage pairing changes (the cab->unit map is derived from store
 * state, so a pairing edit re-renders affected markers).
 */
export function TrainMarkers({ onSelect }: { onSelect: (cab: string) => void }) {
  const trains = useDisplayedTrains();
  const heritage = useStore((s) => s.heritage);
  const selectedCab = useStore((s) => s.selectedCab);

  const unitByCab = useMemo(() => cabToUnit(heritage), [heritage]);

  // Dedupe so a cab appearing twice in a poll yields one marker with a unique
  // key — duplicate MapLibre annotation ids otherwise trigger a render loop.
  // Memoized on `trains` so the store snapshot stays a stable reference.
  const unique = useMemo(() => dedupeTrains(trains), [trains]);

  return (
    <>
      {unique.map((t) => {
        const key = trainKey(t);
        const unit = t.cab ? unitByCab[t.cab] : undefined;
        return (
          <Marker key={key} id={key} lngLat={[t.lon, t.lat]} onPress={() => t.cab && onSelect(t.cab)}>
            <TrainMarkerIcon
              color={routeColor(t.route)}
              bearing={t.brg}
              label={t.cab ?? '?'}
              unit={unit}
              selected={!!t.cab && t.cab === selectedCab}
            />
          </Marker>
        );
      })}
    </>
  );
}
