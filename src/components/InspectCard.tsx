import React, { useCallback, useEffect, useMemo } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { loadPredictions, type PredictionRow } from '../api/mbta';
import { routeColor, routeShort } from '../constants/routes';
import { heritageInfo, heritageName, unitCategoryLine } from '../constants/heritage';
import { cabToUnit, useDisplayedTrains, useStore } from '../state/store';
import { findByKey, mphLabel, prettyStatus } from '../lib/format';
import { trainKey, trainTitle } from '../lib/trains';
import { formatClock } from '../lib/time';

/**
 * Bottom inspect card driven by the per-train tap cycle:
 *   stage 1 -> label chip (Cab ### · Trn ##)
 *   stage 2 -> details (destination, status, mph, notable unit if paired)
 *   stage 3 -> next stops (predictions, auto-loaded on entry)
 *   (tap again dismisses)
 * Tapping the card advances the stage; the marker tap sets/advances too.
 */
export function InspectCard() {
  const trains = useDisplayedTrains();
  const mode = useStore((s) => s.mode);
  const selectedKey = useStore((s) => s.selectedKey);
  const stage = useStore((s) => s.inspectStage);
  const cycleInspect = useStore((s) => s.cycleInspect);
  const heritage = useStore((s) => s.heritage);
  const predictions = useStore((s) => s.predictions);
  const predictionsAsOf = useStore((s) => s.predictionsAsOf);
  const loading = useStore((s) => s.predictionsLoading);
  const setPredictions = useStore((s) => s.setPredictions);
  const setPredictionsLoading = useStore((s) => s.setPredictionsLoading);

  const train = findByKey(trains, selectedKey);

  // Which notable unit (if any) is paired to this cab.
  const unitByCab = useMemo(() => cabToUnit(heritage), [heritage]);
  const unit = train?.cab ? unitByCab[train.cab] : undefined;
  const unitInfo = heritageInfo(unit);

  const onLoadStops = useCallback(async () => {
    // Bulk-load predictions for every visible trip once (cached by tripId), so
    // switching between trains is instant. Keyless is fine at user-action rate.
    const tripIds = Array.from(
      new Set(trains.map((t) => t.tripId).filter((id): id is string => !!id)),
    );
    if (tripIds.length === 0) return;
    setPredictionsLoading(true);
    try {
      const grouped = await loadPredictions(tripIds);
      const obj: Record<string, PredictionRow[]> = {};
      grouped.forEach((rows, id) => {
        obj[id] = rows;
      });
      setPredictions(obj);
    } catch {
      setPredictionsLoading(false);
    }
  }, [trains, setPredictions, setPredictionsLoading]);

  // Auto-load the first time the user reaches the stops stage for a live train.
  const needsStops =
    stage >= 3 && !!train?.tripId && predictionsAsOf == null && !loading;
  useEffect(() => {
    if (needsStops) void onLoadStops();
  }, [needsStops, onLoadStops]);

  if (!train || stage < 1) return null;

  const color = routeColor(train.route);

  const advance = () => cycleInspect(trainKey(train));

  // The next-stops list scrolls, so it can't live inside a tappable wrapper (the
  // tap responder would swallow the scroll gesture). The chip/details area and
  // the hint stay tappable to advance/dismiss the inspect stage.
  return (
    <View style={styles.card}>
      <TouchableOpacity activeOpacity={0.9} onPress={advance}>
        {/* Stage 1+: chip */}
        <View style={styles.chipRow}>
          <View style={[styles.routeDot, { backgroundColor: color }]} />
          <Text style={styles.chip}>{trainTitle(train)}</Text>
          <Text style={styles.route}>{routeShort(train.route)}</Text>
        </View>

        {/* Ghost tag (whenever selected) */}
        {train.isGhost && (
          <View style={styles.ghostTag}>
            <Text style={styles.ghostText}>GHOST (no trip/label)</Text>
          </View>
        )}

        {/* Notable-unit tag (whenever paired, from stage 1). The category label
            leads, so lease power reads "LEASE POWER · …" not "HERITAGE · …". */}
        {unit && (
          <View style={styles.heritageTag}>
            <Text style={styles.heritageText}>
              {(unitInfo?.categoryLabel ?? 'Notable unit').toUpperCase()} · {heritageName(unit)}
            </Text>
          </View>
        )}

        {/* Non-revenue tag (whenever selected) */}
        {train.isNonRevenue && (
          <View style={styles.nonRevTag}>
            <Text style={styles.nonRevText}>NON-REVENUE</Text>
          </View>
        )}

        {/* Stage 2+: details */}
        {stage >= 2 && (
          <View style={styles.details}>
            <Detail label="Destination" value={train.dest ?? '—'} />
            <Detail label="Status" value={prettyStatus(train.status)} />
            <Detail label="Speed" value={mphLabel(train.spd)} />
            {unit && (
              <Detail
                label="Notable unit"
                value={unitInfo ? `${unitInfo.model} · ${heritageName(unit)}` : heritageName(unit)}
              />
            )}
            {unitInfo && <Detail label="Category" value={unitCategoryLine(unitInfo)} />}
          </View>
        )}
      </TouchableOpacity>

      {/* Stage 3: next stops (outside the tappable area so the list can scroll) */}
      {stage >= 3 && (
        <View style={styles.stops}>
          {train.isGhost ? (
            <Text style={styles.noStops}>No trip data — this is a ghost (unassigned) vehicle.</Text>
          ) : mode === 'playback' && !train.tripId ? (
            <Text style={styles.noStops}>Next stops are available in live mode only.</Text>
          ) : predictionsAsOf == null ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color="#F5C518" size="small" />
              <Text style={styles.loadingText}>Loading next stops…</Text>
            </View>
          ) : (
            <NextStops
              tripId={train.tripId ?? null}
              predictions={predictions}
              asOf={predictionsAsOf}
              loading={loading}
              onRefresh={onLoadStops}
            />
          )}
        </View>
      )}

      <TouchableOpacity activeOpacity={0.9} onPress={advance}>
        <Text style={styles.hint}>{stage < 3 ? 'Tap for more' : 'Tap to dismiss'}</Text>
      </TouchableOpacity>
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function NextStops({
  tripId,
  predictions,
  asOf,
  loading,
  onRefresh,
}: {
  tripId: string | null;
  predictions: Record<string, PredictionRow[]>;
  asOf: number;
  loading: boolean;
  onRefresh: () => void;
}) {
  const rows = (tripId ? predictions[tripId] : undefined) ?? [];
  const now = Date.now();
  const future = rows.filter((r) => new Date(r.time).getTime() >= now - 60_000); // drop past stops
  return (
    <View>
      <View style={styles.stopsHeader}>
        <Text style={styles.asOf}>Next stops · as of {formatClock(asOf)}</Text>
        <TouchableOpacity onPress={onRefresh} disabled={loading} hitSlop={8}>
          {loading ? (
            <ActivityIndicator color="#F5C518" size="small" />
          ) : (
            <Text style={styles.refresh}>Refresh</Text>
          )}
        </TouchableOpacity>
      </View>
      {future.length === 0 ? (
        <Text style={styles.noStops}>No upcoming stops for this trip.</Text>
      ) : (
        <ScrollView
          style={styles.stopScroll}
          nestedScrollEnabled
          showsVerticalScrollIndicator
          keyboardShouldPersistTaps="handled"
        >
          {future.map((r, i) => (
            <View key={`${r.stopSequence}-${i}`} style={styles.stopRow}>
              <Text style={styles.stopName} numberOfLines={1}>
                {r.stopName}
              </Text>
              <Text style={styles.stopTime}>{formatClock(r.time)}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(20,20,24,0.96)',
    borderRadius: 14,
    padding: 14,
  },
  chipRow: { flexDirection: 'row', alignItems: 'center' },
  routeDot: { width: 12, height: 12, borderRadius: 6, marginRight: 8 },
  chip: { color: '#fff', fontWeight: '800', fontSize: 15 },
  route: { color: '#B9BEC7', fontSize: 12, marginLeft: 'auto' },
  heritageTag: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(245,197,24,0.15)',
    borderColor: '#F5C518',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  heritageText: { color: '#F5C518', fontSize: 12, fontWeight: '700' },
  nonRevTag: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(245,166,35,0.15)',
    borderColor: '#F5A623',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  nonRevText: { color: '#F5A623', fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  ghostTag: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(149,165,166,0.18)',
    borderColor: '#95A5A6',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  ghostText: { color: '#C9CDD4', fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  details: { marginTop: 10, gap: 4 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between' },
  detailLabel: { color: '#8A909B', fontSize: 13 },
  detailValue: { color: '#fff', fontSize: 13, fontWeight: '600', flexShrink: 1, textAlign: 'right', marginLeft: 8 },
  stops: { marginTop: 12 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  loadingText: { color: '#B9BEC7', fontSize: 13 },
  stopsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  asOf: { color: '#8A909B', fontSize: 11 },
  refresh: { color: '#F5C518', fontSize: 12, fontWeight: '700' },
  noStops: { color: '#B9BEC7', fontSize: 13 },
  stopScroll: { maxHeight: 240 },
  stopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  stopName: { color: '#fff', fontSize: 13, flexShrink: 1, marginRight: 8 },
  stopTime: { color: '#F5C518', fontSize: 13, fontWeight: '700' },
  hint: { color: '#5A606B', fontSize: 11, marginTop: 10, textAlign: 'center' },
});
