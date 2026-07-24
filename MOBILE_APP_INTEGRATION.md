# MBTA Commuter Rail Tracker — Mobile App Integration Guide

Context document for building an iOS/Android app against the existing
trains.chrisnewell.net infrastructure. The web app at that URL is the
reference implementation; this doc describes every interface the app needs.

## What this system is

A hobbyist MBTA Commuter Rail tracker with two data planes:

1. **Historical archive** — an AWS pipeline polls the MBTA v3 API every
   minute, archives raw vehicle snapshots to S3, and compacts them into
   per-day JSON "frames" files served via CloudFront. Enables playback of
   any past day.
2. **Live view** — clients talk to the MBTA v3 API directly (SSE streaming
   with an API key, REST polling as fallback) for true realtime positions.

A defining feature: **heritage unit tracking**. The MBTA API only ever
reports the cab car (control coach) number and train number — never the
locomotive's own number. Users manually pair heritage locomotives
(1030, 1036, 1071, 1129, 1130, 1776) to the cab car of their consist based
on spotting reports; the app then renders that train with the unit's icon.
This pairing is the product's core value.

## Infrastructure (read-only from the app's perspective)

| Piece | Detail |
|---|---|
| Public base URL | `https://trains.chrisnewell.net` (CloudFront, HTTPS, HTTP/2) |
| Day frames files | `https://trains.chrisnewell.net/frames/YYYY-MM-DD.json` |
| Web app | `https://trains.chrisnewell.net/` (single-file HTML reference impl) |
| AWS account | S3 bucket `chrisnewell-mbta` (us-east-1): `raw/` (private archive), `frames/` (served). Lambda `mbta-cr-poll` (1-min EventBridge schedule), `mbta-cr-compact` (5-min). **The app never writes to AWS** — it is a pure consumer of the CloudFront URLs. |
| Cache headers | Past days: `Cache-Control: public, max-age=31536000, immutable`. Today: `max-age=60`. Files are served gzip (`Content-Encoding: gzip`) — use an HTTP client that decompresses automatically, or sniff the `\x1f\x8b` magic and gunzip. |
| Availability | Frames exist from 2026-07-14 onward. Cadence: 5-minute polls 07-14 → 07-16 evening, 1-minute thereafter. Requesting a missing date returns S3's XML `AccessDenied` (403) — treat 403 on `/frames/*` as "no data for that date". |

## Remote config (source of truth for the route list)

```
GET https://trains.chrisnewell.net/config.json      (Cache-Control: max-age=300)
```

Fetch at app launch (and opportunistically thereafter); cache the last good
copy; fall back to baked-in defaults if unreachable. It carries:

- `routes[]` — the authoritative CR route list with display names, stable
  per-route hex colors, and flags (`seasonal`, `event_service`,
  `hidden_in_route_listing`). **Use this instead of hardcoding the route
  list** — the MBTA restructures routes occasionally (CR-Middleborough and
  CR-Stoughton were retired in the 2025 South Coast Rail changes; CapeFlyer
  is hidden from the default /routes listing), and config updates propagate
  in minutes instead of app-store review cycles. Render unknown route ids
  gracefully (fallback color + raw id as label).
- `endpoints` — frames base URL and MBTA API base.
- `live` / `trails` — the tuning constants described elsewhere in this doc,
  so behavior changes don't require app updates either.
- `heritage_units` — the heritage roster as objects: `unit` (road number,
  the pairing key), `model` (locomotive model designation — **config is the
  authoritative source for model numbers; do not hardcode them in the app**),
  `scheme` (livery name for display), `icon` (hosted PNG URL — see the
  heritage section), and as of schema v3 a `category` field (see the
  top-level `unit_categories` map for labels: heritage, commemorative,
  lease, custom) plus optional `owner` (reporting mark, e.g. RSTX for
  leased power). Treat category as a display grouping — the pairing
  mechanism is identical for all categories. Entries may lack an `icon`
  that is not yet uploaded; render such units with the normal marker plus
  the badge/label only, never a broken image. Schema v2 changed this from
  a plain string array; treat entries as objects.
- `attribution` — required data/basemap credit strings; display in-app.

The comma-joined `filter[route]` value for API calls is simply
`routes[].id` joined with commas.

## Day frames file schema

```jsonc
{
  "date": "2026-07-16",                       // Eastern-time service day
  "updated": "2026-07-16T22:35:23-04:00",     // last compactor write
  "frames": [
    {
      "key": "222419",                        // HHMMSS Eastern, unique per day, sort key
      "time": "2026-07-16T22:24:19-04:00",    // newest vehicle update in the poll
      "trains": [
        {
          "cab":   "1713",          // vehicle label = cab car number (string, may be null)
          "train": "159",           // trip name = timetable train number (may be null)
          "dest":  "Newburyport",   // trip headsign (may be null)
          "route": "CR-Newburyport",
          "status":"IN_TRANSIT_TO", // IN_TRANSIT_TO | STOPPED_AT | INCOMING_AT
          "lat": 42.609, "lon": -70.87492,    // 5 decimal places
          "brg": 135,               // bearing degrees, may be null
          "upd": "2026-07-16T22:24:05-04:00", // per-vehicle updated_at
          "vid": "1934",            // present ONLY when cab is null ("ghost"
                                    // vehicles — no label/trip identity):
                                    // the API vehicle resource id, use it as
                                    // the tracking key for these. Added
                                    // 2026-07-19. Render ghosts distinctly
                                    // (web: dashed route-color ring) and give
                                    // users a toggle to show/hide them.
          "rev": "NON_REVENUE"      // present ONLY for non-revenue moves
                                    // (deadheads, equipment repositioning);
                                    // absent = revenue trip. Added 2026-07-19;
                                    // older frames never carry it. Render
                                    // non-revenue distinctly (web: hollow dot).
        }
      ]
    }
  ]
}
```

Notes:
- Frames are sorted by `key`. Empty polls (overnight) appear with
  `trains: []` and a `time` reconstructed from the key.
- Older frames (before 07-16) lack nothing structurally, but live-only
  fields (`tripId`, `spd` — see below) are **not** in archive files.
- A 1-minute full day is ~1,440 frames, ~500–800 KB gzipped. Load once per
  selected date; never poll archive files on a timer (today's file is only
  used to seed a live session).

## MBTA v3 API usage (the live plane)

Base: `https://api-v3.mbta.com`. All responses JSON:API. The CR routes (take the authoritative list from config.json — the list below
is the baked-in fallback; filtering by explicit route ids inherently excludes
`Shuttle-*` bus routes):

```
CR-Newburyport,CR-Fitchburg,CR-Lowell,CR-Haverhill,CR-Worcester,CR-Franklin,
CR-Needham,CR-Providence,CR-NewBedford,CR-Kingston,CR-Greenbush,CR-Fairmount,
CR-Foxboro,CapeFlyer
```
Notes on this list (verified against the live API 2026-07-19): CR-Middleborough
and CR-Stoughton no longer exist (South Coast Rail restructuring folded them
into CR-NewBedford and CR-Providence). CR-Foxboro is the dedicated event-service
route. CapeFlyer is type 2 but hidden from the default /routes listing — filter
for it explicitly; seasonal (summer weekends).

### Streaming (primary live source; API key REQUIRED)

```
GET /vehicles?filter[route]=<13 routes>&include=trip&api_key=<KEY>
Accept: text/event-stream
```

SSE events: `reset` (full array; trip resources are mixed into it — cache
them by id), then `add` / `update` / `remove` with single resources. Only
**vehicle** resources stream after reset — when a vehicle's trip changes to
one not in your cache, lazily `GET /trips/{id}` (keyless OK) for
name/headsign, and cache it.

Web app's key is embedded in the page (dedicated, rotatable key named for
the site). For the mobile app, **request a separate key per the MBTA's
one-key-per-app policy** at https://api-v3.mbta.com/portal (human approval,
may take days — build the polling path first).

Fallback watchdog (mirror the web app): if no stream data for >60 s, issue
one REST poll; check every 15 s. Surface a heartbeat UI: green =
streaming fresh, amber = polling fallback, red = no data >120 s, with a
"last data Xs ago" ticker.

### REST polling (fallback / keyless)

```
GET /vehicles?filter[route]=<13 routes>&include=trip        (no key needed)
```
Keyless rate limit is low (~20 req/min/IP) — one poll per 60 s per client is
the intended cadence. With a key: 1,000/min.

### Vehicle fields the app should carry (live)

From `attributes`: `label` (cab), `latitude`, `longitude`, `bearing`,
`speed` (**meters/second** — verified empirically; ×2.23694 for mph; often
null), `current_status`, `updated_at`. From `relationships`: `trip.data.id`
(keep it — needed for predictions), `route.data.id`. From included trip:
`name` (train #), `headsign`.

### Predictions (next stops per train)

One bulk request for all visible trains, on explicit user refresh only
(mirror the web app's "Load next stops" button; do NOT auto-poll):

```
GET /predictions?filter[trip]=<comma-separated trip ids>&include=stop
    &fields[prediction]=arrival_time,departure_time,stop_sequence
    &fields[stop]=name
```
Group by trip relationship, sort by `stop_sequence`, use
`arrival_time || departure_time`, drop rows with neither, filter past stops
client-side. Show a "as of <time>" stamp.

### Station schedules (today's timetable at a station)

Stations come from embedded MassGIS data (see below), not MBTA stop IDs.
Resolve by proximity, then query (both keyless):

```
GET /stops?filter[route_type]=2&filter[latitude]=<lat>&filter[longitude]=<lng>
    &filter[radius]=0.02&sort=distance&page[limit]=1
→ use relationships.parent_station.data.id (fallback: stop id), e.g. place-WML-0214

GET /schedules?filter[stop]=<place id>&filter[route]=<13 routes>
    &include=trip&fields[schedule]=arrival_time,departure_time
    &fields[trip]=name,headsign
```
Cache ~10 min per station. Stations with no nearby CR stop (rare) → "no
MBTA service" message. CapeFLYER stations resolve in summer.

## Static map data

The web app embeds two datasets extracted from MassGIS (the app can reuse
the same data — extract from the deployed page, or ask Chris for the source
GeoJSON):

- **Revenue network**: MBTA CR lines + 150 stations
  (source: MassGIS `MBTA_Commuter_Rail` FeatureServer at
  arcgisserver.digital.mass.gov, EPSG:4326).
- **Freight/non-revenue trackage**: 2,152 simplified arcs from the statewide
  MassGIS Trains layer (`TYPE=1 AND COMMRAIL IS NULL`), incl. the CSX
  Framingham Secondary, Grand Junction, yards. Rendered thin/dashed/gray as
  an independently toggleable layer — event-day equipment moves ride these
  tracks.

Brand color: MBTA Commuter Rail purple `#80276C`. Per-route colors in the
web app are assigned dynamically from a palette in first-seen order — the
app may define its own stable per-route palette instead.

## Behavior to replicate (hard-won details)

### Trail rendering (movement history lines)
Group fixes by cab identity (`cab:<label>`), break a trail into a new
segment when ANY of:
- route id changes (equipment reassignment — the strongest signal)
- gap between fixes > 15 min (`TRAIL_GAP_MS`)
- implied straight-line speed > 90 mph (`TRAIL_MAX_MPH`)
- single hop > 7 mi regardless of time (`TRAIL_MAX_HOP_MI`) — catches AVL
  dead zones that bridge at "plausible" speeds (e.g. Westborough→Framingham)
Color each segment by its own route.

### Heritage units
- Icon PNGs are hosted at the URLs in each config entry's `icon` field
  (`https://trains.chrisnewell.net/icons/<unit>.png`) — transparent-trimmed,
  128 px tall, served with Cache-Control: max-age=86400. Fetch and cache them
  at runtime keyed by URL; if a unit's artwork is ever revised the filename
  changes (e.g. 1776-v2.png) so caches self-invalidate. Do not bundle icons
  in the app: new units appear by config update alone. Pairing is unit → cab label, stored locally
  on-device (web uses localStorage key `crHeritage`), user-editable
  (assign / reassign / unassign), persists until changed.
- **Never auto-match** a vehicle label to a unit number — labels are cab
  cars; a coach could coincidentally share a unit's number.
- Pairing changes must repaint affected markers immediately.

### Cab identity & selection
- Track vehicles by cab label across train numbers (a cab runs many trains
  per day). Per-train tap cycle in the web app: 1) label chip
  `Cab ### · Trn ##` → 2) details (destination, prettified status, mph) →
  3) next stops (from the bulk prediction load) → 4) nothing.
- The API never reports locomotive numbers; "ghost" vehicles (null label or
  trip) exist occasionally.

### Time
All display times US Eastern (`America/New_York`), format `M/D/YYYY h:mma`
for timestamps, `h:mma` for schedule times. Frame keys and archive paths
are Eastern. Handle DST via the platform tz database, never fixed offsets.

### Live-mode session model
Seed once from today's frames file → stream is then the source of truth →
in-memory frame snapshots committed ~1/min for scrub/trails (cap history,
web uses 600 frames) → archive never re-fetched unless the user explicitly
reloads/changes date.

## Rate-limit & citizenship rules

- One streaming connection per client; reconnect with backoff.
- Predictions/schedules/trips keyless calls are fine at user-action
  frequency; never on tight timers.
- Attribution: data via MBTA / MassDOT (Developers License Agreement);
  basemap per whatever tile provider the app uses (web uses CARTO/OSM —
  a native app needs its own tile solution: MapLibre + a tile source,
  Apple MapKit, or Google Maps SDK).

## Out of scope for the app

- No writes to S3/AWS; no AWS credentials in the app.
- No shuttle buses (excluded at the route-filter level by design).
- No server component needed — the app is a static-data + MBTA-API client,
  same as the web page.

## Open items an app could improve on

- Web has no notion of push alerts; a native app could notify when a paired
  heritage unit goes active (its assigned cab appears in the live feed).
- Day files >07-16 are 1-minute; a native app could stream-parse the JSON
  for faster first paint on cellular.
- If the MBTA key for streaming is not yet approved, ship polling-only and
  hot-enable streaming later via remote config.
