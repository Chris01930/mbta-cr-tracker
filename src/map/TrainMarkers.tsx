import React, { useMemo } from 'react';
import { Marker } from '@maplibre/maplibre-react-native';
import { routeColor } from '../constants/routes';
import { cabToUnit, useDisplayedTrains, useStore } from '../state/store';
import { dedupeTrains, trainKey, trainLabel } from '../lib/trains';
import { TrainMarkerIcon } from '../components/TrainMarkerIcon';

/**
 * Renders one tappable Marker per plottable train (ghosts included, keyed by
 * their vehicle id). Markers repaint immediately when a heritage pairing
 * changes. Selection is by tracking key, so ghosts are tappable too.
 */
export function TrainMarkers({
  onSelect,
  showGhosts = true,
}: {
  onSelect: (key: string) => void;
  showGhosts?: boolean;
}) {
  const trains = useDisplayedTrains();
  const heritage = useStore((s) => s.heritage);
  const selectedKey = useStore((s) => s.selectedKey);

  const unitByCab = useMemo(() => cabToUnit(heritage), [heritage]);

  // Dedupe (by tracking key) so a repeated entity yields one marker with a
  // unique id, and drop ghosts when the toggle is off. Memoized on `trains` +
  // `showGhosts` so the store snapshot stays a stable reference.
  const unique = useMemo(
    () => dedupeTrains(trains).filter((t) => showGhosts || !t.isGhost),
    [trains, showGhosts],
  );

  return (
    <>
      {unique.map((t) => {
        const key = trainKey(t);
        const unit = t.cab ? unitByCab[t.cab] : undefined;
        return (
          <Marker key={key} id={key} lngLat={[t.lon, t.lat]} onPress={() => onSelect(key)}>
            <TrainMarkerIcon
              color={routeColor(t.route)}
              bearing={t.brg}
              label={trainLabel(t)}
              unit={unit}
              selected={key === selectedKey}
              isNonRevenue={t.isNonRevenue}
              isGhost={t.isGhost}
            />
          </Marker>
        );
      })}
    </>
  );
}
