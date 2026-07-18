# MBTA Commuter Rail Tracker (iOS + Android)

A cross-platform React Native (Expo) app for tracking MBTA Commuter Rail trains
in real time, with manual **heritage unit** pairing. Built against the
`trains.chrisnewell.net` infrastructure described in
[`../MOBILE_APP_INTEGRATION.md`](../MOBILE_APP_INTEGRATION.md).

This is the **polling-only live MVP**: it needs no MBTA API key. It seeds from
today's archive frames, then polls the keyless MBTA v3 REST API every 60s.
Streaming can be hot-enabled later (see [Enabling streaming](#enabling-streaming)).

## Features

- **Live map** of all 13 CR routes on a MapLibre basemap (Carto Positron, keyless).
- **Historical playback / scrub** — pick any archived day (History button), then
  scrub the timeline slider or play it back at 1–8× with transport controls. The
  map, markers, heritage picker, and inspect card all reflect the scrubbed frame.
  Loads each day's frames file once; a 403 surfaces as "no data for this day".
- **CR network overlay** — 150 stations + revenue lines, bundled from MassGIS,
  colored per route. Tap a station for today's timetable.
- **Heritage unit tracking** — pair any of the six units (1030, 1036, 1071,
  1129, 1130, 1776) to the cab of a live consist. Pairings persist on-device and
  repaint markers immediately. The app never auto-matches a label to a unit.
- **Tap-to-inspect cycle** on each train: label chip → details (destination,
  status, mph) → next stops → dismiss.
- **Freshness heartbeat**: green = streaming, amber = polling, red = stale, with
  a live "last data Xs ago" ticker.
- **Predictions** loaded only on explicit user action (never auto-polled).
- **Eastern-time** formatting throughout, DST-safe via the platform tz database.

## Architecture

```
App.tsx                     launch: hydrate heritage, start live session
src/
  config.ts                 all tunables (routes, URLs, cadences, thresholds)
  types.ts                  Train / Frame / DayFrames domain types
  constants/
    routes.ts               13 routes, stable per-route palette, line coloring
    heritage.ts             the six heritage units
  api/
    mbta.ts                 MBTA v3 REST: vehicles, predictions, schedules, trips
    frames.ts               CloudFront day-frames archive loader (403 = no data)
  hooks/
    useLivePolling.ts       seed → poll(60s) → watchdog(15s); swap point for SSE
    usePlayback.ts          advances the scrub timeline while playing
  state/
    store.ts                zustand store; live+playback modes, displayed-trains
                            selector, AsyncStorage heritage persistence
  lib/
    time.ts                 Eastern-time / "ago" formatting
    format.ts               status/speed/heartbeat presentation helpers
  map/
    MapScreen.tsx           Map + Camera + overlays
    CrNetwork.tsx           bundled lines/stations layers
    TrainMarkers.tsx        one tappable marker per train (heritage-aware)
  components/
    HeartbeatBar, InspectCard, HeritageSheet, StationSheet, TrainMarkerIcon,
    PlaybackBar (transport + slider), DatePickerSheet (day selection)
  data/
    crLines.json            25 line features (MassGIS, rounded to 5 decimals)
    crStations.json         150 stations (MassGIS)
```

The store contract is deliberately source-agnostic: `setTrains(trains, source)`
is fed by the poll loop today and can be fed by an SSE stream later with no
changes to any feature code.

## Prerequisites

- Node 20+ (tested on Node 24)
- **iOS**: Xcode + an iOS simulator or device
- **Android**: Android Studio + a JDK (17) + an emulator or device
- MapLibre is a native module, so the app **cannot run in Expo Go** — it needs a
  development build (below).

> **Path must have no spaces.** React Native + Expo + CocoaPods break on spaces
> in the build path, so this project lives at `~/Desktop/mbta-tracker` (not under
> `MBTA Tracker App/`). Keep it on a space-free path.

## Running

```bash
cd ~/Desktop/mbta-tracker
npm install   # runs `patch-package` postinstall to apply the toolchain patches

# Generate the native projects (once, and after any native config change):
npx expo prebuild

# Then run a development build on a simulator/device:
npx expo run:ios       # or: npx expo run:android
```

`npx expo run:ios` compiles the dev client and launches Metro. Subsequent JS-only
changes hot-reload; you only re-run `prebuild`/`run` after native config changes.

### Typecheck / bundle check

```bash
npx tsc --noEmit
npx expo export --platform ios   # validates the full JS module graph
```

## Enabling streaming

The MVP is keyless. To turn on SSE streaming later:

1. Request a dedicated key at <https://api-v3.mbta.com/portal> (one key per app;
   human approval, can take days).
2. Set `CONFIG.mbtaApiKey` in [`src/config.ts`](src/config.ts) (or wire it to
   remote config).
3. Replace the poll loop in [`src/hooks/useLivePolling.ts`](src/hooks/useLivePolling.ts)
   with an `EventSource` against
   `/vehicles?filter[route]=…&include=trip&api_key=…` (SSE `reset`/`add`/
   `update`/`remove`), keeping the same `setTrains(..., 'stream')` calls and the
   60s/120s watchdog. The heartbeat will report green automatically.

## Building for the stores

Use [EAS Build](https://docs.expo.dev/build/introduction/):

```bash
npm i -g eas-cli
eas build --platform ios       # or android, or "all"
```

Bundle identifiers are set in [`app.json`](app.json)
(`net.chrisnewell.mbtacr`) — change them to your own before submitting.

## Not yet implemented (documented follow-ups)

- **Movement trails** — the segmentation rules (route change, >15 min gap,
  >90 mph, >7 mi hop) are specified in the guide; render as colored line
  segments per cab from the frame history.
- **Freight / non-revenue trackage layer** — the toggle exists in the store
  (`showFreight`); it needs the statewide MassGIS Trains layer
  (`TYPE=1 AND COMMRAIL IS NULL`) bundled as a second GeoJSON.
- **Push alerts** when a paired heritage unit's cab appears in the live feed.

## Toolchain patches (Xcode 26.3 / macOS 26.3)

Building on this bleeding-edge toolchain required three dependency fixes, applied
automatically on `npm install` via `patch-package` (see [`patches/`](patches/)):

- **expo-modules-jsi** — `abs(x)` is ambiguous under Xcode 26's Swift compiler;
  switched to `x.magnitude`.
- **expo-modules-jsi** — macOS 26 stamps `com.apple.FinderInfo` xattrs on build
  products, which breaks `codesign`. The xcframework build now disables signing
  for its nested build and strips xattrs (the outer app build re-signs).
- **expo-constants** — its `bash -l -c` script phase didn't quote the script
  path; single-quoted it so a project path (if it ever has spaces) won't break.
  Requires `pod install` to regenerate the Pods script.

If you bump Expo/RN versions, regenerate the patches (`npx patch-package <pkg>`)
or drop them if the upstream fixes land.

## Attribution

Transit data © MBTA / MassDOT (Developers License Agreement). Basemap © CARTO,
© OpenStreetMap contributors. Network geometry from MassGIS.
