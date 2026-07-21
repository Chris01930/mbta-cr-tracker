import React, { useMemo } from 'react';
import { Marker } from '@maplibre/maplibre-react-native';
import { routeColor } from '../constants/routes';
import { cabToUnit, useDisplayedTrains, useStore } from '../state/store';
import { ALL_VISIBLE, dedupeTrains, trainKey, trainLabel, trainVisible, type VisibilityFilter } from '../lib/trains';
import { TrainMarkerIcon } from '../components/TrainMarkerIcon';
import type { Train } from '../types';

/**
 * Renders one tappable Marker per plottable train (ghosts included, keyed by
 * their vehicle id). Markers repaint immediately when a heritage pairing
 * changes. Selection is by tracking key, so ghosts are tappable too. `filter`
 * drops train classes toggled off (ghost / revenue / non-revenue).
 */
export function TrainMarkers({
  onSelect,
  filter = ALL_VISIBLE,
}: {
  onSelect: (key: string) => void;
  filter?: VisibilityFilter;
}) {
  const trains = useDisplayedTrains();
  const heritage = useStore((s) => s.heritage);
  const selectedKey = useStore((s) => s.selectedKey);

  const unitByCab = useMemo(() => cabToUnit(heritage), [heritage]);

  // Dedupe (by tracking key) so a repeated entity yields one marker with a
  // unique id, and drop classes toggled off. Heritage-paired locos are rendered
  // last: map markers stack in render/subview order, so putting them at the end
  // keeps their icons always above plain train markers. Stable partition
  // preserves each group's relative order. Memoized on `trains` + `filter` +
  // `unitByCab` so the store snapshot stays a stable reference.
  const unique = useMemo(() => {
    const visible = dedupeTrains(trains).filter((t) => trainVisible(t, filter));
    const plain: Train[] = [];
    const heritage: Train[] = [];
    for (const t of visible) (t.cab && unitByCab[t.cab] ? heritage : plain).push(t);
    return [...plain, ...heritage];
  }, [trains, filter, unitByCab]);

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
