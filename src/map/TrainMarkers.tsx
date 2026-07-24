import React, { useMemo } from 'react';
import { Marker } from '@maplibre/maplibre-react-native';
import { routeColor } from '../constants/routes';
import { displayUnitsForCab, useDisplayedTrains, useStore } from '../state/store';
import { ALL_VISIBLE, dedupeTrains, trainKey, trainLabel, trainVisible, type VisibilityFilter } from '../lib/trains';
import { TrainMarkerIcon } from '../components/TrainMarkerIcon';

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
  const designations = useStore((s) => s.designations);
  const assignedAt = useStore((s) => s.assignedAt);
  const selectedKey = useStore((s) => s.selectedKey);

  // cab -> units, primary first. A designated cab may hold two; the marker
  // shows the primary's icon with a "+1", never two icons.
  const unitsByCabDisplay = useMemo(() => {
    const state = { heritage, designations, assignedAt };
    const out: Record<string, string[]> = {};
    for (const cab of new Set(Object.values(heritage))) {
      out[cab] = displayUnitsForCab(state, cab);
    }
    return out;
  }, [heritage, designations, assignedAt]);

  // Dedupe (by tracking key) and drop classes toggled off. Heritage-paired locos
  // must always draw above plain markers where they overlap; render/subview order
  // alone is unreliable (the feed reorders vehicles between polls, so React
  // reindexes marker subviews and the z-stacking churns — a heritage icon
  // "sometimes" slipping behind a plain one, especially during playback). The
  // real fix is the explicit per-marker `zIndex` below (a hard native z), so
  // ordering here only needs to be stable/deterministic: sort by tracking key.
  // Memoized on `trains` + `filter` (stable store snapshot).
  const unique = useMemo(
    () =>
      dedupeTrains(trains)
        .filter((t) => trainVisible(t, filter))
        .sort((a, b) => trainKey(a).localeCompare(trainKey(b))),
    [trains, filter],
  );

  return (
    <>
      {unique.map((t) => {
        const key = trainKey(t);
        const units = (t.cab ? unitsByCabDisplay[t.cab] : undefined) ?? [];
        // Explicit z: assigned locos above all plain markers, deterministically.
        const zIndex = units.length ? 1000 : 0;
        return (
          <Marker key={key} id={key} lngLat={[t.lon, t.lat]} onPress={() => onSelect(key)} style={{ zIndex }}>
            <TrainMarkerIcon
              color={routeColor(t.route)}
              bearing={t.brg}
              label={trainLabel(t)}
              unit={units[0]}
              extraUnits={units.length - 1}
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
