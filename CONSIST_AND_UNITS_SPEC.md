# Spec: Notable Units v3 + Consist Designations (sandwich / doubleheader)

Hand this file to Claude Code with MOBILE_APP_INTEGRATION.md (updated) in the
repo and config.json schema v3 deployed at
https://trains.chrisnewell.net/config.json. Propose a plan before implementing;
list every site where the current one-unit-per-cab assumption lives.

## Vocabulary

- **Notable unit** — a rostered locomotive from config `heritage_units[]`
  (name kept for compatibility; entries now span categories).
- **Assignment** — a user pairing of one notable unit to one cab label
  (existing heritage-pairing mechanism, extended below).
- **Designation** — a user-marked consist configuration for a cab label
  (new): `sandwich` or `doubleheader`.

## Part A — adopt config.json schema v3

`heritage_units[]` entries gained fields:
- `category`: `heritage | commemorative | lease | custom` — display labels
  in new top-level `unit_categories` map.
- `owner` (optional): reporting mark for lease power (e.g. `RSTX`).
- Entries MAY lack `icon` (artwork not yet uploaded, e.g. unit 1002).
  Render icon-less units with the normal route marker plus badge/labels —
  never a broken image; the roster row shows a placeholder glyph.

UI changes:
- Rename user-facing "Heritage" framing to **"Notable units"**.
- Roster grouped by category using `unit_categories` labels.
- Unit detail shows category label and, when present, owner:
  "Lease power · RSTX".
- Pairing mechanics are identical across categories.

## Part B — consist designations

Local store keyed by cab label (same persistence approach as assignments):

```
{ cab: "1704",
  kind: "sandwich" | "doubleheader",
  locos: ["1002", "1139"],     // 0-2 freeform strings: the physical units
  positions: { "1002": "OB", "1139": "IB" },  // optional; see rules below
  note: "optional freeform",
  markedAt: <timestamp> }
```

- **sandwich** = one locomotive on EACH end (cab car rides within).
  Position tags, when given, are one `OB` and one `IB`.
- **doubleheader** = two locomotives coupled on the SAME end.
  Position tags, when given, are `lead` and `trail`.
- `locos` entries are freeform (not restricted to rostered units). When a
  locos entry matches a rostered unit's number, render it linked (icon
  chip / tappable to the unit).
- Manage UI lives beside the notable-units section: add/edit/remove a
  designation for any cab (pick from cabs in current data or manual
  entry). Removal deletes outright.
- Staleness: if `markedAt` > 14 days old, append "· verify?" and soften
  the badge. Never auto-delete.

## Part C — assignment capacity rules (the core behavior change)

How many notable units may be assigned to one cab is governed by that
cab's designation:

| Designation      | Max assignments |
|------------------|-----------------|
| none ("regular") | 1               |
| sandwich         | 2               |
| doubleheader     | 2               |

Rules:
1. Capacity is a maximum, not a requirement — a sandwich with one (or
   zero) notable units assigned is valid. (Real current case: cab 1704 is
   a sandwich of locos 1002 + 1139; only 1002 is rostered today.)
2. Assigning a second unit to an undesignated cab prompts: "Mark cab X as
   sandwich or doubleheader?" — choosing one creates the designation and
   completes the assignment; cancel aborts the assignment.
3. Removing or downgrading a designation while 2 units are assigned is
   blocked with a prompt to unassign one first. Never silently drop an
   assignment.
4. When a cab has a designation with position tags, each assignment may
   optionally carry the matching position (sandwich: OB/IB; doubleheader:
   lead/trail). Untagged is allowed.
5. Storage remains unit -> cab (a unit is on at most one cab). Enforce
   capacity at assignment time by counting units mapped to the target
   cab. Existing single assignments migrate untouched.

## Part D — display

Train detail view (cab with designation and/or assignments):
- Designation badge: "SANDWICH · locos 1002 + 1139 · marked 3d ago"
  (+ note; + "· verify?" when stale). Doubleheader analogous.
- Each assigned notable unit gets its own line: icon chip (if icon),
  number, model, scheme, category label, owner, and position tag when
  set: "1002 · F40PH-3C · Rolling Stock Solutions · Lease power · RSTX ·
  OB end".
- Heritage/notable badge and designation badge coexist.

Map marker with assignments:
- 1 unit assigned: unit icon replaces the dot (current behavior).
- 2 units assigned: show the **primary** unit's icon with a small "+1"
  chip; primary defaults to the first-assigned and is user-swappable in
  the detail view. Never render two icons on one marker.
- Designation alone (no assignments): marker unchanged — designation is
  detail-level information only.

## Part E — tests

1. Config v3 parses; icon-less unit renders without broken image; roster
   groups by category; owner shown for lease entries.
2. Regular cab: second assignment triggers the designation prompt;
   cancel leaves one assignment.
3. Sandwich cab: two assignments accepted; both render in detail; marker
   shows primary icon + "+1"; primary swap works.
4. Downgrade with 2 assigned is blocked until one is unassigned.
5. Designation with freeform locos matching a rostered number renders
   the link; non-matching numbers render as plain text.
6. Stale (>14d) designation styling triggers.
7. Existing single heritage assignments load unchanged after migration.

## Out of scope

- No backend / frames-schema changes; designations and assignments stay
  local to the device.
- No sharing/sync between users.
- No map-marker treatment for designations themselves.
