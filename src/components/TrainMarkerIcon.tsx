import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { heritageIconUrl } from '../constants/heritage';
import { markIconFailed, useUsableIconUrl } from '../lib/iconFallback';
import { heritageIconOpacity, puckAppearance } from '../lib/markerStyle';

/**
 * Visual for a single train marker.
 *
 * - Standard train: a route-colored chevron pointing along the vehicle's
 *   bearing.
 * - Consist paired to a notable unit: the unit's loco icon (a hosted PNG loaded
 *   by URL; React Native caches it by URI) instead of the chevron, upright.
 * - Paired to a unit with no usable artwork (no `icon` in config, or an `icon`
 *   whose URL fails): the standard chevron. Never a broken image.
 *
 * The label below ALWAYS shows the cab car number — the icon conveys which
 * notable unit is on the consist, the badge conveys the cab.
 */

interface Props {
  color: string;
  bearing: number | null;
  label: string; // cab number / ghost id — always shown
  unit?: string | null; // notable unit number if paired
  selected?: boolean;
  isNonRevenue?: boolean; // deadhead / equipment move — render distinctly
  isGhost?: boolean; // no cab/trip — dashed ring
}

export function TrainMarkerIcon({
  color,
  bearing,
  label,
  unit,
  selected,
  isNonRevenue = false,
  isGhost = false,
}: Props) {
  const iconUrl = useUsableIconUrl(heritageIconUrl(unit));
  const puck = puckAppearance(color, isNonRevenue, isGhost);

  return (
    <View style={styles.wrap} pointerEvents="none">
      {iconUrl ? (
        <View style={[styles.locoWrap, selected && styles.locoSelected]}>
          <Image
            source={{ uri: iconUrl }}
            style={[styles.loco, { opacity: heritageIconOpacity(isNonRevenue) }]}
            resizeMode="contain"
            onError={() => markIconFailed(iconUrl)}
          />
        </View>
      ) : (
        <View
          style={[
            styles.puck,
            {
              backgroundColor: puck.backgroundColor,
              borderColor: puck.borderColor,
              borderStyle: puck.dashed ? 'dashed' : 'solid',
            },
            selected && styles.puckSelected,
          ]}
        >
          <View style={[styles.arrow, { transform: [{ rotate: `${bearing ?? 0}deg` }] }]}>
            <View style={[styles.arrowHead, { borderBottomColor: puck.chevronColor }]} />
          </View>
        </View>
      )}
      <View style={styles.badge}>
        <Text style={styles.badgeText} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </View>
  );
}

const LOCO_W = 40;
const LOCO_H = 54; // ~0.74 aspect of the source art

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', width: 72 },

  // Standard chevron puck
  puck: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  puckSelected: { borderColor: '#00E5FF', borderWidth: 3 },
  arrow: { position: 'absolute', width: 26, height: 26, alignItems: 'center' },
  arrowHead: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderBottomWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#ffffff',
    marginTop: -2,
  },

  // Heritage loco icon
  locoWrap: {
    width: LOCO_W,
    height: LOCO_H,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 2.5,
    shadowOffset: { width: 0, height: 1 },
    elevation: 4,
  },
  locoSelected: {
    borderWidth: 2,
    borderColor: '#00E5FF',
    backgroundColor: 'rgba(0,229,255,0.15)',
  },
  loco: { width: LOCO_W, height: LOCO_H },

  // Cab-number badge (always shown)
  badge: {
    marginTop: 2,
    paddingHorizontal: 4,
    paddingVertical: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 4,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
});
