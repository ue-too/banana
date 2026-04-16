# Stop Position Editing — Design

## Goal

Let users add, edit, and remove stop positions on station platforms. Stop positions are the per-platform points where trains stop under timetable control. Today they are auto-generated once at platform creation time (two entries per platform, at the arc-length midpoint, one per travel direction) and are immutable afterward.

Users need two things this blocks:

- Multiple stop positions per platform, so trains with different lengths or roles can stop at different spots (e.g. short-formation trains at the back of the platform)
- The ability to reposition a stop when the auto-computed midpoint is not where the train should actually stop (e.g. platforms on curves, or near exits)

## Scope

In scope:

- Data-model support for multiple, user-defined stop positions per platform with stable IDs
- Refactor of dual-spine track-aligned platforms into two independent single-spine platforms (each serving one track) so that timetables can select which face of an island they refer to
- A `PlatformEditorPanel` UI for adding, moving, flipping direction, and removing stop positions
- Migration of existing saved scenes (old dual-spine platforms, old index-based shift references) on deserialize
- Timetable integration: `ScheduledStop` references a stop position by stable ID; missing references surface as explicit warnings instead of silently pointing at the wrong stop

Out of scope:

- On-canvas direct manipulation (drag markers on the map). Editing is panel-based only.
- Editing platform width, offset, name, side, or other non-stop-position properties. The panel is structured to allow this later but does not implement it in this spec.
- Grouping single-spine platforms back into a visual "island" after the dual-spine split. If users place two single-spine platforms back-to-back, they render as two adjacent platforms. A future "island grouping" concept can be added later if needed.

## Data model

### Stop positions gain stable IDs

```ts
export type StopPosition = {
  id: number;                  // NEW — stable, unique within the owning platform
  trackSegmentId: number;
  direction: TrackDirection;
  tValue: number;
};
```

The ID is unique within the owning platform (both `Platform` for island, and `TrackAlignedPlatform` for track-aligned). A per-platform counter is sufficient — IDs never need to be globally unique.

### ScheduledStop references by ID instead of index

```ts
export type ScheduledStop = {
  stationId: number;
  platformKind: 'island' | 'trackAligned';
  platformId: number;
  stopPositionId: number;      // NEW — replaces stopPositionIndex
  arrivalTime: WeekMs | null;
  departureTime: WeekMs | null;
};
```

The old `stopPositionIndex` field is dropped from the in-memory type. The serialized form keeps a fallback during migration (see below).

### Dual-spine split

`TrackAlignedPlatform` is simplified to always be a single-spine platform:

```ts
export type TrackAlignedPlatform = {
  id: number;
  stationId: number;
  spine: SpineEntry[];                // renamed from spineA; spineB removed
  offset: number;
  outerVertices: Point[];             // was OuterVertices (single | dual); now always a polyline
  stopPositions: StopPosition[];
};
```

The dual-spine placement tool now creates **two** `TrackAlignedPlatform` records — one per spine — each self-contained:

- Each platform has its own `spine`, its own `stopPositions`, its own `outerVertices`
- Each platform's outer vertices trace its spine's offset edge outward, then cross the centerline, then return — so each face is a closed polygon in its own right
- The two platforms sit back-to-back along the shared centerline; rendering each independently produces the same visual result as the old combined dual-spine platform

After this change every `TrackAlignedPlatform` serves exactly one track segment spine, just like a `Platform` (island) serves exactly one track segment.

### Why stable IDs, not indices

Users can delete a stop position, and they may (implicitly) reorder the array by deleting the middle entry and adding a new one at the end. Any `ScheduledStop` referencing a deleted or shifted index would silently point to the wrong stop. This codebase already uses stable IDs for every other first-class entity (trains, formations, signals, routes, shifts, stations, platforms), so stop positions should follow the same pattern.

## Managers

Both `StationManager` (for island platforms) and `TrackAlignedPlatformManager` gain:

- `addStopPosition(platformId, { trackSegmentId, tValue, direction }) → number` — returns the assigned id
- `updateStopPosition(platformId, stopId, patch)` — change `tValue` or `direction`
- `removeStopPosition(platformId, stopId)`
- `isStopPositionReferenced(platformId, stopId, timetableManager) → ShiftTemplate[]` — returns which shifts reference this stop, for the deletion-guard UI

Validation on add/update:

- `trackSegmentId` must be a segment the platform covers (the single segment for island platforms; any segment in the spine for track-aligned)
- `tValue` must lie within the platform's coverage range on that segment (for track-aligned, within the spine entry's `[tStart, tEnd]`; for island, within `[0, 1]`)

The managers remain free of UI dependencies — deletion-guard logic (listing referenced shifts) takes the timetable manager as an argument so the core managers stay test-friendly.

## PlatformEditorPanel

### Launch

`StationListPanel` gains a horizontal row of platform chips under each station entry: `P0`, `P1`, `T3`, `T4`. Clicking a chip opens the `PlatformEditorPanel` for that platform. Chips are labelled consistently with the debug overlay (`P` for island `Platform`, `T` for `TrackAlignedPlatform`, followed by the platform id).

### Layout

Header:

- Platform label (`P0` or `T3`)
- The track segment(s) the platform covers (same info the existing dropdown shows)

Body — a list of stop positions, one row per entry:

- A position-in-array index label: `[0]`, `[1]`, ... — matches the debug overlay
- A slider (0 → 1) representing normalized position along the platform's arc length. While dragging, the debug overlay marker updates in real time.
- A direction toggle (`→` / `←` for `tangent` / `reverseTangent`)
- A delete button

Footer:

- An **Add stop** button. Adds a new entry at the arc-length midpoint of the platform with `direction: 'tangent'`. User can then drag the slider and toggle direction.

### Arc-length resolution

The editor works in a single normalized coordinate (0 = platform start, 1 = platform end), regardless of whether the platform has one segment (island) or spans multiple segments (track-aligned). A helper converts between the normalized coordinate and `(segmentId, tValue)`:

- **Island platform** (single segment): normalized value is the segment's `tValue` directly.
- **Track-aligned platform** (spine of N segments): walk the spine, accumulating arc length; the target normalized value maps to whichever spine entry contains the corresponding arc-length point, then linearly interpolates to the segment's `tValue`.

This mirrors the existing logic in `computeStopPositions` (`spine-utils.ts`), which already finds the midpoint by arc length. The same primitive is generalized to arbitrary normalized positions.

### Deletion guard

Before deleting a stop position referenced by any `ScheduledStop`:

- Show a confirmation dialog listing the shifts that reference it
- User can cancel or proceed
- If the user proceeds, the referenced shifts end up with a dangling `stopPositionId`. The AutoDriver already tolerates missing stop positions (treats them as "no stop" — it cannot compute a distance and holds the current throttle). The Timetable panel surfaces dangling references explicitly so the user can re-pick.

## Timetable panel

### Dropdown labels

Unchanged — still `P0[0]`, `P0[1]`, `T3[0]`, ..., matching the debug overlay. Internally the selected value is the stop position's stable ID, not the index.

### Missing-reference handling

If a `ScheduledStop` references a `stopPositionId` that no longer exists on its platform:

- The dropdown for that stop shows an explicit placeholder — e.g. `⚠ Missing stop` — distinct from the "nothing selected" placeholder
- The user can re-select a valid stop from the dropdown to repair the shift

## Migration

Performed once on deserialize. All existing saved scenes must load without data loss.

### Dual-spine platforms → two single-spine platforms

For each serialized platform with `outerVertices.kind === 'dual'`:

1. Compute the centerline polyline — the arc-length midline between `spineA` and `spineB`. Cap endpoints come from `capA` and `capB`.
2. Create a new single-spine platform for `spineA`: spine = old `spineA`, outer vertices = the spine A offset edge + the centerline back to the start (closing via capA/capB endpoints as needed).
3. Create a second single-spine platform for `spineB` symmetrically.
4. Split the old `stopPositions`: each stop goes to whichever new platform contains its `trackSegmentId` in its spine.
5. Assign fresh stop-position IDs in both new platforms.
6. Record a mapping from each old `(oldPlatformId, oldIndex)` to the new `(newPlatformId, newStopPositionId)` — used below for shift-reference migration.

Single-spine track-aligned platforms are left mostly untouched: they just get stop-position IDs assigned and their `outerVertices` field converted from `{ kind: 'single', vertices }` to a plain `Point[]`.

### ScheduledStop index → id

Old serialized form (post-migration of platforms, before this field is dropped):

```ts
type SerializedScheduledStop = {
  stationId: number;
  platformKind?: 'island' | 'trackAligned';
  platformId: number;
  stopPositionIndex?: number;   // legacy
  stopPositionId?: number;      // new
  arrivalTime: number | null;
  departureTime: number | null;
};
```

On load:

- If `stopPositionId` is present, use it as-is; `platformId` is already correct.
- Else if `stopPositionIndex` is present:
  - For platforms that were never dual, resolve to the current platform's `stopPositions[index].id`; `platformId` is unchanged.
  - For platforms that were dual and have been split, use the mapping built during platform migration — the lookup returns the new `(platformId, stopPositionId)` pair, and the `ScheduledStop`'s `platformId` is rewritten accordingly.
- If neither the old index nor the new ID resolves to an existing stop, leave `stopPositionId` pointing to an unresolved number — the Timetable panel will surface it as `⚠ Missing stop`.

### Stop-position IDs on existing single-spine and island platforms

On deserialize, every loaded `StopPosition` that lacks an `id` is assigned one from its owning platform's fresh id counter. This is a silent, lossless migration.

## Testing

New or updated tests:

- **Managers**: `addStopPosition`, `updateStopPosition`, `removeStopPosition` on both `StationManager` and `TrackAlignedPlatformManager`. Verify: stable-id uniqueness per platform; validation of `trackSegmentId` against platform coverage; `isStopPositionReferenced` returns the correct shifts.
- **Arc-length resolution**: normalized-position → `(segmentId, tValue)`. Cases: single-segment trivial; multi-segment spine crossing a joint; values at 0, 1, and a midpoint-of-spine boundary.
- **Dual-spine split migration**: round-trip a saved scene containing a dual-spine platform. Verify: two new platforms, correct spine assignment, stop positions split correctly, fresh IDs assigned.
- **ScheduledStop migration**: old `stopPositionIndex` serialized form resolves to the correct `stopPositionId` after deserialize, including across a dual-spine split.
- **AutoDriver**: still stops correctly at stops after migration; dangling `stopPositionId` does not crash — the driver just cannot compute a distance and holds.
- **Timetable panel**: dangling reference renders as `⚠ Missing stop` and can be repaired by re-selection.

## Sequencing

The implementation plan should cover three logical phases, each independently testable and leaving the app in a working state:

1. **Dual-spine split refactor.** Data model, migration, placement state machine, render system. No UI yet. At the end of this phase, every platform is single-spine, scenes round-trip cleanly, and the existing `stopPositionIndex`-based timetable still works.
2. **Stop-position stable IDs + manager CRUD.** Add `id` to `StopPosition`, ID assignment on deserialize, manager add/update/remove, `ScheduledStop.stopPositionId` with migration from `stopPositionIndex`. `TimetablePanel` dropdown switched to use stable IDs. Still no editor panel.
3. **`PlatformEditorPanel` UI.** Chips in `StationListPanel`, arc-length slider, direction toggle, delete with confirmation, real-time debug overlay updates, missing-reference handling in the Timetable panel.
