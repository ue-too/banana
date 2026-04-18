# Phase 2 — Stop Position Stable IDs + Manager CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every `StopPosition` a stable per-platform `id`, expose `add/update/remove` CRUD on both platform managers, and migrate `ScheduledStop` from index-based references (`stopPositionIndex`) to ID-based references (`stopPositionId`). After this phase, the data model is ready for the Phase 3 editor UI.

**Architecture:** Add `id: number` to `StopPosition`. Each platform owns its own ID counter (`max(existingIds) + 1`). Both `StationManager` (island platforms) and `TrackAlignedPlatformManager` (track-aligned) gain `addStopPosition`, `updateStopPosition`, `removeStopPosition`, plus an `isStopPositionReferenced(timetableManager)` helper. `ScheduledStop` switches its in-memory shape to `stopPositionId`; the serialized form retains `stopPositionIndex` as a back-compat fallback resolved at load time. Phase 1's dual-spine migration map is extended to emit `newStopId` so the timetable can be re-pointed to stable IDs in one pass.

**Tech Stack:** TypeScript, Bun test runner (`bun test`), Vite.

---

## Context every task depends on

- **Spec**: `docs/superpowers/specs/2026-04-16-stop-position-editing-design.md` — sections "Data model" and "Migration".
- **Phase 1 plan**: `docs/superpowers/plans/2026-04-16-phase-1-dual-spine-split.md` — the dual-spine split work this phase builds on. Particularly the `PlatformMigrationMap` (`oldPlatformId → oldStopIndex → { newPlatformId, newStopIndex }`) which Phase 2 extends to also carry `newStopId`.
- **In-memory types**:
    - `StopPosition` lives in `src/stations/types.ts` — currently `{ trackSegmentId, direction, tValue }`. Phase 2 adds `id: number`.
    - `Platform` (island, with one `track` segment) and `TrackAlignedPlatform` (one `spine: SpineEntry[]`) both own a `stopPositions: StopPosition[]` array.
- **Existing call sites that build stops inline** (need updating to assign IDs):
    - `src/stations/station-factory.ts:126,139` — island station factory hardcodes two stops per platform.
    - `src/stations/spine-utils.ts:222,232` — `computeStopPositions(spine, getCurve)` returns two stops at the spine midpoint.
    - `src/stations/single-spine-placement-state-machine.ts` — uses `computeStopPositions`.
    - `src/stations/dual-spine-placement-state-machine.ts` — uses `computeStopPositions`.
    - `src/stations/track-aligned-platform-migration.ts:131,139` — split helper writes new face stops.
- **TimetableManager.deserialize** signature today (`src/timetable/timetable-manager.ts`): `(data, trackGraph, trainManager, stationManager, signalStateEngine?)` — Phase 2 adds `trackAlignedPlatformManager` so it can resolve legacy `stopPositionIndex` references to stable `stopPositionId`s.
- **AutoDriver** in `src/timetable/auto-driver.ts:425-441` accesses stop positions via `platform.stopPositions[stopPositionIndex]` — Phase 2 changes the lookup to `platform.stopPositions.find(s => s.id === stopPositionId)`.
- **TimetablePanel** in `src/components/toolbar/TimetablePanel.tsx` builds the stop-position dropdown — Phase 2 switches the dropdown's value from index to ID.

## File structure

**New files:**

- `src/stations/stop-position-utils.ts` — small pure helpers shared by both managers: `nextStopPositionId(stops)`, `assignStopPositionIds(stops)`, `validateStopPositionOnPlatform(...)`. Co-locating these prevents duplication between `StationManager` and `TrackAlignedPlatformManager`.
- `test/stop-position-utils.test.ts` — unit tests for the pure helpers.
- `test/station-manager-stop-crud.test.ts` — CRUD tests for island platform stop positions.
- `test/track-aligned-platform-stop-crud.test.ts` — CRUD tests for track-aligned platform stop positions.
- `test/scheduled-stop-id-migration.test.ts` — covers `TimetableManager.deserialize` resolving legacy `stopPositionIndex` to `stopPositionId`.

**Modified files:**

- `src/stations/types.ts` — add `id: number` to `StopPosition`.
- `src/stations/station-manager.ts` — assign IDs on deserialize; add CRUD methods.
- `src/stations/track-aligned-platform-manager.ts` — assign IDs on deserialize (both `deserialize` and `deserializeAny`); add CRUD methods.
- `src/stations/station-factory.ts`, `src/stations/spine-utils.ts`, `src/stations/single-spine-placement-state-machine.ts`, `src/stations/dual-spine-placement-state-machine.ts`, `src/stations/track-aligned-platform-migration.ts` — emit stops with assigned IDs.
- `src/timetable/types.ts` — `ScheduledStop.stopPositionIndex` → `stopPositionId`. `SerializedScheduledStop` keeps both as optional fields (`stopPositionId?` new, `stopPositionIndex?` legacy).
- `src/timetable/shift-template-manager.ts` — `serialize` writes `stopPositionId`; `deserialize` accepts both forms (resolves index via platform managers when only the legacy field is present); `remapTrackAlignedPlatformReferences` rewrites `stopPositionId`.
- `src/timetable/timetable-manager.ts` — `deserialize` signature gains `trackAlignedPlatformManager`; passes it through to `ShiftTemplateManager.deserialize`.
- `src/timetable/auto-driver.ts` — stop lookup by ID instead of index.
- `src/components/toolbar/TimetablePanel.tsx` — dropdown uses `stopPositionId` as its value.
- `src/scene-serialization.ts` — pass `app.trackAlignedPlatformManager` to the new `TimetableManager.deserialize` signature.
- `src/stations/track-aligned-platform-migration.ts` — `splitLegacyDualSpinePlatform` assigns IDs to the new face stops; `PlatformMigrationMap` value gains `newStopId: number`.
- `src/stations/track-aligned-platform-manager.ts` — `deserializeAny` propagates the new `newStopId` field.

---

## Task 1: `StopPosition.id` + ID utility helpers

**Files:**

- Modify: `src/stations/types.ts`
- Create: `src/stations/stop-position-utils.ts`
- Create: `test/stop-position-utils.test.ts`

This task introduces the new field and the small helpers everyone else will use. After this task, the codebase will not compile (existing call sites still produce `StopPosition` literals without `id`). Tasks 2 and 3 fix that.

- [ ] **Step 1: Write the failing test for the helpers.**

Create `test/stop-position-utils.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';

import {
    assignStopPositionIds,
    nextStopPositionId,
} from '../src/stations/stop-position-utils';
import type { StopPosition } from '../src/stations/types';

describe('nextStopPositionId', () => {
    it('returns 0 for an empty array', () => {
        expect(nextStopPositionId([])).toBe(0);
    });

    it('returns max id + 1 for a non-empty array', () => {
        const stops: StopPosition[] = [
            { id: 4, trackSegmentId: 1, direction: 'tangent', tValue: 0.5 },
            {
                id: 7,
                trackSegmentId: 1,
                direction: 'reverseTangent',
                tValue: 0.5,
            },
        ];
        expect(nextStopPositionId(stops)).toBe(8);
    });

    it('handles non-contiguous ids', () => {
        const stops: StopPosition[] = [
            { id: 0, trackSegmentId: 1, direction: 'tangent', tValue: 0.5 },
            {
                id: 12,
                trackSegmentId: 1,
                direction: 'reverseTangent',
                tValue: 0.5,
            },
            { id: 3, trackSegmentId: 1, direction: 'tangent', tValue: 0.7 },
        ];
        expect(nextStopPositionId(stops)).toBe(13);
    });
});

describe('assignStopPositionIds', () => {
    it('assigns sequential ids starting at 0 to a fresh array', () => {
        const inputs = [
            { trackSegmentId: 1, direction: 'tangent' as const, tValue: 0.5 },
            {
                trackSegmentId: 1,
                direction: 'reverseTangent' as const,
                tValue: 0.5,
            },
        ];
        const result = assignStopPositionIds(inputs);
        expect(result.map(s => s.id)).toEqual([0, 1]);
    });

    it('preserves existing fields verbatim', () => {
        const inputs = [
            { trackSegmentId: 7, direction: 'tangent' as const, tValue: 0.25 },
        ];
        const [stop] = assignStopPositionIds(inputs);
        expect(stop.trackSegmentId).toBe(7);
        expect(stop.direction).toBe('tangent');
        expect(stop.tValue).toBe(0.25);
    });

    it('does not mutate the input objects', () => {
        const inputs = [
            { trackSegmentId: 1, direction: 'tangent' as const, tValue: 0.5 },
        ];
        const result = assignStopPositionIds(inputs);
        expect(result[0]).not.toBe(inputs[0]);
        expect((inputs[0] as { id?: number }).id).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run the test and confirm it fails.**

Run: `bun test test/stop-position-utils.test.ts`
Expected: FAIL — `Cannot find module 'stop-position-utils'`.

- [ ] **Step 3: Add `id` to `StopPosition`.**

Edit `src/stations/types.ts`. Replace the `StopPosition` declaration:

```ts
/** Defines where a train stops on a particular platform. */
export type StopPosition = {
    /** Unique within the owning platform's `stopPositions` array. */
    id: number;
    trackSegmentId: number;
    direction: TrackDirection;
    tValue: number;
};
```

`SerializedStopPosition = StopPosition` already, so the serialized form picks up `id` automatically.

- [ ] **Step 4: Create the helper module.**

Create `src/stations/stop-position-utils.ts`:

```ts
import type { StopPosition } from './types';

/**
 * Pure helpers shared between `StationManager` (island platforms) and
 * `TrackAlignedPlatformManager` (track-aligned platforms) for managing the
 * per-platform id space of `StopPosition` entries.
 */

/**
 * Returns the next available id for a stop position on a platform.
 *
 * IDs are unique within the owning platform's `stopPositions` array but
 * may be sparse (e.g. after deletions). Callers should treat the returned
 * id as a fresh slot — assign it to a new `StopPosition` and append.
 */
export function nextStopPositionId(stops: readonly StopPosition[]): number {
    let max = -1;
    for (const stop of stops) {
        if (stop.id > max) max = stop.id;
    }
    return max + 1;
}

/**
 * Assigns sequential ids (starting at 0) to a list of stop-position
 * descriptors. Used by callers that build `StopPosition` arrays from
 * scratch (e.g. station-factory, the spine-utils midpoint helper, the
 * placement state machines).
 *
 * The returned array contains fresh objects; the input is not mutated.
 */
export function assignStopPositionIds(
    inputs: readonly Omit<StopPosition, 'id'>[]
): StopPosition[] {
    return inputs.map((input, i) => ({ id: i, ...input }));
}
```

- [ ] **Step 5: Run the helper tests and confirm they pass.**

Run: `bun test test/stop-position-utils.test.ts`
Expected: PASS (3 + 3 cases).

- [ ] **Step 6: Do not run `bun test` or `bun run build` for the full suite — they will fail until Task 2 lands.** Skip ahead to commit.

- [ ] **Step 7: Commit.**

```bash
git add \
    src/stations/types.ts \
    src/stations/stop-position-utils.ts \
    test/stop-position-utils.test.ts
git commit -m "feat(stations): add StopPosition.id and id-assignment helpers"
```

---

## Task 2: Update inline stop-construction call sites + deserialize ID backfill

**Files:**

- Modify: `src/stations/station-factory.ts`
- Modify: `src/stations/spine-utils.ts`
- Modify: `src/stations/single-spine-placement-state-machine.ts` (no code change beyond what flows through `computeStopPositions`)
- Modify: `src/stations/dual-spine-placement-state-machine.ts` (same)
- Modify: `src/stations/track-aligned-platform-migration.ts`
- Modify: `src/stations/station-manager.ts`
- Modify: `src/stations/track-aligned-platform-manager.ts`
- Modify: `test/spine-utils.test.ts` (existing test of `computeStopPositions`)
- Modify: `test/track-aligned-platform-manager.test.ts` (existing tests with hand-built stops need `id`)
- Modify: `test/track-aligned-platform-migration.test.ts` (assertions on stop-index map updated)

After this task, the codebase compiles, all existing tests pass, every `StopPosition` in memory has a stable `id`, and `deserialize` paths back-fill IDs onto legacy stop positions that lack one.

- [ ] **Step 1: Update `computeStopPositions` to emit IDs.**

Edit `src/stations/spine-utils.ts`. Locate `computeStopPositions` (around line 187) and rewrite the two `return` blocks to give the two stops ids 0 and 1:

```ts
return [
    { id: 0, trackSegmentId: entry.trackSegment, direction: 'tangent', tValue },
    { id: 1, trackSegmentId: entry.trackSegment, direction: 'reverseTangent', tValue },
];
```

(The fallback block at the end uses the same shape but with `tValue: lastEntry.tEnd`.) Update both `return` arrays.

- [ ] **Step 2: Update `station-factory.ts` to emit IDs on the hardcoded island stops.**

Edit `src/stations/station-factory.ts`. Replace each stop literal in the `stopPositions` arrays:

```ts
// Platform 1
stopPositions: [
    { id: 0, trackSegmentId: seg1, direction: 'tangent', tValue: 0.5 },
    { id: 1, trackSegmentId: seg1, direction: 'reverseTangent', tValue: 0.5 },
],
// Platform 2
stopPositions: [
    { id: 0, trackSegmentId: seg2, direction: 'tangent', tValue: 0.5 },
    { id: 1, trackSegmentId: seg2, direction: 'reverseTangent', tValue: 0.5 },
],
```

- [ ] **Step 3: Update `splitLegacyDualSpinePlatform` to emit IDs on the new face stops.**

Edit `src/stations/track-aligned-platform-migration.ts`. Inside `splitLegacyDualSpinePlatform`, change the two `stopsA.push(copy)` / `stopsB.push(copy)` calls to assign ids using each face's own counter. Replace the relevant block (the for-loop body) with:

```ts
for (let i = 0; i < legacy.stopPositions.length; i++) {
    const stop = legacy.stopPositions[i];
    if (spineASegmentIds.has(stop.trackSegmentId)) {
        const newId = stopsA.length;
        stopIndexMap[i] = { face: 'A', newIndex: stopsA.length, newId };
        stopsA.push({
            id: newId,
            trackSegmentId: stop.trackSegmentId,
            direction: stop.direction,
            tValue: stop.tValue,
        });
    } else if (spineBSegmentIds.has(stop.trackSegmentId)) {
        const newId = stopsB.length;
        stopIndexMap[i] = { face: 'B', newIndex: stopsB.length, newId };
        stopsB.push({
            id: newId,
            trackSegmentId: stop.trackSegmentId,
            direction: stop.direction,
            tValue: stop.tValue,
        });
    } else {
        stopIndexMap[i] = { face: 'A', newIndex: -1, newId: -1 };
    }
}
```

Also extend the `StopIndexMapEntry` type at the top of the file:

```ts
export type StopIndexMapEntry = {
    face: 'A' | 'B';
    newIndex: number;
    newId: number;
};
```

(Phase 1's tests for this helper will need updating; do that in Step 5 below.)

- [ ] **Step 4: Backfill IDs on deserialize for legacy stop positions that lack an `id`.**

Edit `src/stations/station-manager.ts`. In the `deserialize` static method, find the inner platform mapping (around line 88) and replace the `stopPositions: p.stopPositions.map(...)` line with one that assigns sequential ids when missing:

```ts
stopPositions: p.stopPositions.map((sp, i) => ({
    id: typeof sp.id === 'number' ? sp.id : i,
    trackSegmentId: sp.trackSegmentId,
    direction: sp.direction,
    tValue: sp.tValue,
})),
```

Edit `src/stations/track-aligned-platform-manager.ts`. Apply the same pattern in TWO places: inside the existing `deserialize` static method and inside `deserializeAny` (the new-format branch only — the legacy single-spine and dual-spine paths route through `splitLegacyDualSpinePlatform`, which already assigns IDs after Step 3). For `deserialize` (around line 168) and the new-format branch of `deserializeAny` (around line 212), replace `stopPositions: p.stopPositions.map((sp) => ({ ...sp }))` with:

```ts
stopPositions: p.stopPositions.map((sp, i) => ({
    id: typeof sp.id === 'number' ? sp.id : i,
    trackSegmentId: sp.trackSegmentId,
    direction: sp.direction,
    tValue: sp.tValue,
})),
```

Also update the legacy single-spine branch in `deserializeAny` (the block guarded by `if (p.spineB === null)` — around line 224) the same way.

- [ ] **Step 5: Update existing tests to expect `id` on stop positions.**

Edit `test/spine-utils.test.ts`. Find the test cases for `computeStopPositions`. The current tests assert two-element output but don't check ids. Add an assertion to one of the existing tests that the returned stops have `id: 0` and `id: 1`. (You don't need to add new tests — just spot-check that ids are present.)

Edit `test/track-aligned-platform-manager.test.ts`. Locate any test that constructs a `StopPosition` literal — find the test for `'should preserve t-values and side through round-trip'` (constructs an inline platform). Add `id: 0` to its `stopPositions` entry. Also for the test cases in `describe('legacy dual-spine migration', ...)` that pass `stopPositions: [...]` to legacy data — those use the legacy form which doesn't require `id`, so no change there. But if any test reads back `platform.stopPositions[i]` and checks fields, add `expect(platform.stopPositions[0].id).toBeDefined()` style assertions.

Edit `test/track-aligned-platform-migration.test.ts`. The third test (`'emits a migration mapping that traces each old stop index to its new face + index'`) needs to expect `newId` on each entry now:

```ts
expect(stopIndexMap).toEqual([
    { face: 'A', newIndex: 0, newId: 0 },
    { face: 'A', newIndex: 1, newId: 1 },
    { face: 'B', newIndex: 0, newId: 0 },
    { face: 'B', newIndex: 1, newId: 1 },
]);
```

Also update the second test (`'routes each stop position to the face whose spine contains the segment'`) — it asserts `faceA.stopPositions.map((s) => s.trackSegmentId)`. Add a sibling assertion: `expect(faceA.stopPositions.map((s) => s.id)).toEqual([0, 1]);`.

- [ ] **Step 6: Update `deserializeAny`'s migration-map construction to forward `newStopId`.**

Edit `src/stations/track-aligned-platform-manager.ts`. Inside the dual-spine branch of `deserializeAny` (around line 246-254) replace the `entries.set(...)` loop with one that includes `newStopId`:

```ts
const entries = new Map<
    number,
    { newPlatformId: number; newStopIndex: number; newStopId: number }
>();
for (let i = 0; i < stopIndexMap.length; i++) {
    const mapEntry = stopIndexMap[i];
    entries.set(i, {
        newPlatformId: mapEntry.face === 'A' ? idA : idB,
        newStopIndex: mapEntry.newIndex,
        newStopId: mapEntry.newId,
    });
}
```

Also update the type alias `PlatformMigrationEntry` in `src/stations/track-aligned-platform-migration.ts`:

```ts
export type PlatformMigrationEntry = {
    newPlatformId: number;
    newStopIndex: number;
    newStopId: number;
};
```

(Existing Phase 1 callers of `remapTrackAlignedPlatformReferences` will keep using `newStopIndex`. Task 6 below will switch them to `newStopId`.)

- [ ] **Step 7: Run the full test suite and the build.**

Run: `bun test`
Expected: all tests pass.

Run: `bun run build`
Expected: success.

If any test in `test/shift-template-manager-remap.test.ts` from Phase 1 breaks because the `PlatformMigrationEntry` type now requires `newStopId`, add `newStopId: <int>` to the test fixtures. The test logic still uses `newStopIndex` because the remap method hasn't been updated yet — that's Task 6.

- [ ] **Step 8: Commit.**

```bash
git add \
    src/stations/spine-utils.ts \
    src/stations/station-factory.ts \
    src/stations/station-manager.ts \
    src/stations/track-aligned-platform-manager.ts \
    src/stations/track-aligned-platform-migration.ts \
    test/spine-utils.test.ts \
    test/track-aligned-platform-manager.test.ts \
    test/track-aligned-platform-migration.test.ts \
    test/shift-template-manager-remap.test.ts
git commit -m "feat(stations): assign stop position ids at construction and on deserialize"
```

---

## Task 3: `StationManager` stop-position CRUD

**Files:**

- Modify: `src/stations/station-manager.ts`
- Create: `test/station-manager-stop-crud.test.ts`

Add `addStopPosition`, `updateStopPosition`, `removeStopPosition` to the manager for island platforms. Validation: the `trackSegmentId` must equal the platform's `track`; `tValue` must lie within `[0, 1]`.

- [ ] **Step 1: Write the failing tests.**

Create `test/station-manager-stop-crud.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'bun:test';

import { StationManager } from '../src/stations/station-manager';
import type { Platform } from '../src/stations/types';
import { ELEVATION } from '../src/trains/tracks/types';

function makePlatform(track: number): Platform {
    return {
        id: 0,
        track,
        width: 5,
        offset: 1,
        side: 1,
        stopPositions: [
            { id: 0, trackSegmentId: track, direction: 'tangent', tValue: 0.5 },
            {
                id: 1,
                trackSegmentId: track,
                direction: 'reverseTangent',
                tValue: 0.5,
            },
        ],
    };
}

function setupStationWithPlatform(track: number) {
    const mgr = new StationManager();
    const stationId = mgr.createStation({
        name: 'S',
        position: { x: 0, y: 0 },
        elevation: ELEVATION.GROUND,
        platforms: [makePlatform(track)],
        trackSegments: [track],
        joints: [],
        trackAlignedPlatforms: [],
    });
    return { mgr, stationId, platformId: 0 };
}

describe('StationManager stop-position CRUD', () => {
    describe('addStopPosition', () => {
        it('appends a new stop position with a fresh id', () => {
            const { mgr, stationId, platformId } = setupStationWithPlatform(10);
            const newId = mgr.addStopPosition(stationId, platformId, {
                trackSegmentId: 10,
                direction: 'tangent',
                tValue: 0.25,
            });
            expect(newId).toBe(2);
            const platform = mgr.getStation(stationId)!.platforms[0];
            expect(platform.stopPositions).toHaveLength(3);
            expect(platform.stopPositions[2]).toEqual({
                id: 2,
                trackSegmentId: 10,
                direction: 'tangent',
                tValue: 0.25,
            });
        });

        it('throws when the trackSegmentId does not match the platform', () => {
            const { mgr, stationId, platformId } = setupStationWithPlatform(10);
            expect(() =>
                mgr.addStopPosition(stationId, platformId, {
                    trackSegmentId: 99,
                    direction: 'tangent',
                    tValue: 0.5,
                })
            ).toThrow();
        });

        it('throws when tValue is out of [0, 1]', () => {
            const { mgr, stationId, platformId } = setupStationWithPlatform(10);
            expect(() =>
                mgr.addStopPosition(stationId, platformId, {
                    trackSegmentId: 10,
                    direction: 'tangent',
                    tValue: 1.5,
                })
            ).toThrow();
        });
    });

    describe('updateStopPosition', () => {
        it('updates tValue and direction in place', () => {
            const { mgr, stationId, platformId } = setupStationWithPlatform(10);
            mgr.updateStopPosition(stationId, platformId, 0, {
                tValue: 0.8,
                direction: 'reverseTangent',
            });
            const updated =
                mgr.getStation(stationId)!.platforms[0].stopPositions[0];
            expect(updated.tValue).toBe(0.8);
            expect(updated.direction).toBe('reverseTangent');
            expect(updated.id).toBe(0);
        });

        it('throws when the stop id does not exist', () => {
            const { mgr, stationId, platformId } = setupStationWithPlatform(10);
            expect(() =>
                mgr.updateStopPosition(stationId, platformId, 999, {
                    tValue: 0.5,
                })
            ).toThrow();
        });

        it('throws when patch tValue is out of range', () => {
            const { mgr, stationId, platformId } = setupStationWithPlatform(10);
            expect(() =>
                mgr.updateStopPosition(stationId, platformId, 0, {
                    tValue: -0.1,
                })
            ).toThrow();
        });
    });

    describe('removeStopPosition', () => {
        it('removes the stop and preserves remaining ids', () => {
            const { mgr, stationId, platformId } = setupStationWithPlatform(10);
            mgr.removeStopPosition(stationId, platformId, 0);
            const stops = mgr.getStation(stationId)!.platforms[0].stopPositions;
            expect(stops).toHaveLength(1);
            expect(stops[0].id).toBe(1);
        });

        it('subsequent addStopPosition reuses the next id (not a deleted one)', () => {
            const { mgr, stationId, platformId } = setupStationWithPlatform(10);
            mgr.removeStopPosition(stationId, platformId, 0);
            const newId = mgr.addStopPosition(stationId, platformId, {
                trackSegmentId: 10,
                direction: 'tangent',
                tValue: 0.3,
            });
            expect(newId).toBe(2);
        });

        it('is a no-op when the id does not exist', () => {
            const { mgr, stationId, platformId } = setupStationWithPlatform(10);
            expect(() =>
                mgr.removeStopPosition(stationId, platformId, 999)
            ).not.toThrow();
            const stops = mgr.getStation(stationId)!.platforms[0].stopPositions;
            expect(stops).toHaveLength(2);
        });
    });
});
```

- [ ] **Step 2: Run the tests and confirm they fail.**

Run: `bun test test/station-manager-stop-crud.test.ts`
Expected: FAIL — methods do not exist.

- [ ] **Step 3: Implement the CRUD methods on `StationManager`.**

Edit `src/stations/station-manager.ts`. Add this import near the top:

```ts
import { nextStopPositionId } from './stop-position-utils';
import type { StopPosition, TrackDirection } from './types';
```

Add these methods to the class, placed after `destroyStation` and before the `Serialization` section header:

```ts
// -----------------------------------------------------------------------
// Stop position CRUD (island platforms)
// -----------------------------------------------------------------------

/**
 * Append a new stop position to an island platform.
 *
 * @param stationId - Owner station.
 * @param platformId - Island platform id within the station.
 * @param input - The stop's track segment, direction, and tValue.
 * @returns The newly assigned stop position id.
 * @throws If the station/platform is missing, the segment doesn't match
 *   the platform's track, or the tValue is outside `[0, 1]`.
 */
addStopPosition(
    stationId: number,
    platformId: number,
    input: { trackSegmentId: number; direction: TrackDirection; tValue: number },
): number {
    const platform = this._getPlatformOrThrow(stationId, platformId);
    this._validateStop(platform, input);
    const id = nextStopPositionId(platform.stopPositions);
    platform.stopPositions.push({ id, ...input });
    return id;
}

/**
 * Update an existing stop position. `tValue` and `direction` may change;
 * `trackSegmentId` is fixed because an island platform serves a single
 * track segment.
 */
updateStopPosition(
    stationId: number,
    platformId: number,
    stopId: number,
    patch: { direction?: TrackDirection; tValue?: number },
): void {
    const platform = this._getPlatformOrThrow(stationId, platformId);
    const stop = platform.stopPositions.find((s) => s.id === stopId);
    if (!stop) {
        throw new Error(
            `StationManager.updateStopPosition: stop ${stopId} not found on platform ${platformId} of station ${stationId}`,
        );
    }
    const next = {
        trackSegmentId: stop.trackSegmentId,
        direction: patch.direction ?? stop.direction,
        tValue: patch.tValue ?? stop.tValue,
    };
    this._validateStop(platform, next);
    stop.direction = next.direction;
    stop.tValue = next.tValue;
}

/** Remove a stop position. No-op if the id is not present. */
removeStopPosition(
    stationId: number,
    platformId: number,
    stopId: number,
): void {
    const platform = this._getPlatformOrThrow(stationId, platformId);
    platform.stopPositions = platform.stopPositions.filter((s) => s.id !== stopId);
}

private _getPlatformOrThrow(stationId: number, platformId: number) {
    const station = this._manager.getEntity(stationId);
    if (!station) {
        throw new Error(`StationManager: station ${stationId} not found`);
    }
    const platform = station.platforms.find((p) => p.id === platformId);
    if (!platform) {
        throw new Error(
            `StationManager: platform ${platformId} not found on station ${stationId}`,
        );
    }
    return platform;
}

private _validateStop(
    platform: { track: number },
    input: { trackSegmentId: number; tValue: number },
): void {
    if (input.trackSegmentId !== platform.track) {
        throw new Error(
            `StationManager: stop position trackSegmentId ${input.trackSegmentId} does not match platform.track ${platform.track}`,
        );
    }
    if (input.tValue < 0 || input.tValue > 1) {
        throw new Error(
            `StationManager: stop position tValue ${input.tValue} is out of range [0, 1]`,
        );
    }
}
```

(The unused `StopPosition` import is fine if TypeScript flags it; remove it then.)

- [ ] **Step 4: Run the new tests and confirm they pass.**

Run: `bun test test/station-manager-stop-crud.test.ts`
Expected: PASS for all 9 cases.

Also run `bun test` (full) — expect all green.

- [ ] **Step 5: Commit.**

```bash
git add \
    src/stations/station-manager.ts \
    test/station-manager-stop-crud.test.ts
git commit -m "feat(stations): add stop position CRUD to StationManager"
```

---

## Task 4: `TrackAlignedPlatformManager` stop-position CRUD

**Files:**

- Modify: `src/stations/track-aligned-platform-manager.ts`
- Create: `test/track-aligned-platform-stop-crud.test.ts`

Mirror Task 3 for track-aligned platforms. The validation differs because the spine spans multiple segments and each entry has a `[tStart, tEnd]` sub-range.

- [ ] **Step 1: Write the failing tests.**

Create `test/track-aligned-platform-stop-crud.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'bun:test';

import { TrackAlignedPlatformManager } from '../src/stations/track-aligned-platform-manager';
import type { TrackAlignedPlatform } from '../src/stations/track-aligned-platform-types';

function makePlatform(): Omit<TrackAlignedPlatform, 'id'> {
    return {
        stationId: 1,
        spine: [
            { trackSegment: 10, tStart: 0.2, tEnd: 0.8, side: 1 },
            { trackSegment: 11, tStart: 0, tEnd: 0.5, side: 1 },
        ],
        offset: 2,
        outerVertices: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
        ],
        stopPositions: [
            { id: 0, trackSegmentId: 10, direction: 'tangent', tValue: 0.5 },
            {
                id: 1,
                trackSegmentId: 10,
                direction: 'reverseTangent',
                tValue: 0.5,
            },
        ],
    };
}

describe('TrackAlignedPlatformManager stop-position CRUD', () => {
    let mgr: TrackAlignedPlatformManager;
    let platformId: number;

    beforeEach(() => {
        mgr = new TrackAlignedPlatformManager();
        platformId = mgr.createPlatform(makePlatform());
    });

    describe('addStopPosition', () => {
        it('appends a stop with a fresh id when input is on a covered segment', () => {
            const newId = mgr.addStopPosition(platformId, {
                trackSegmentId: 11,
                direction: 'tangent',
                tValue: 0.25,
            });
            expect(newId).toBe(2);
            const stops = mgr.getPlatform(platformId)!.stopPositions;
            expect(stops).toHaveLength(3);
            expect(stops[2]).toEqual({
                id: 2,
                trackSegmentId: 11,
                direction: 'tangent',
                tValue: 0.25,
            });
        });

        it('throws when the trackSegmentId is not in the spine', () => {
            expect(() =>
                mgr.addStopPosition(platformId, {
                    trackSegmentId: 99,
                    direction: 'tangent',
                    tValue: 0.5,
                })
            ).toThrow();
        });

        it('throws when tValue is outside the spine entry range', () => {
            // Spine entry for segment 10 is [0.2, 0.8]
            expect(() =>
                mgr.addStopPosition(platformId, {
                    trackSegmentId: 10,
                    direction: 'tangent',
                    tValue: 0.9,
                })
            ).toThrow();
            expect(() =>
                mgr.addStopPosition(platformId, {
                    trackSegmentId: 10,
                    direction: 'tangent',
                    tValue: 0.1,
                })
            ).toThrow();
        });

        it('accepts tValue at the spine entry boundary', () => {
            expect(() =>
                mgr.addStopPosition(platformId, {
                    trackSegmentId: 10,
                    direction: 'tangent',
                    tValue: 0.2,
                })
            ).not.toThrow();
            expect(() =>
                mgr.addStopPosition(platformId, {
                    trackSegmentId: 10,
                    direction: 'tangent',
                    tValue: 0.8,
                })
            ).not.toThrow();
        });
    });

    describe('updateStopPosition', () => {
        it('updates tValue and direction in place', () => {
            mgr.updateStopPosition(platformId, 0, {
                tValue: 0.6,
                direction: 'reverseTangent',
            });
            const stop = mgr.getPlatform(platformId)!.stopPositions[0];
            expect(stop.tValue).toBe(0.6);
            expect(stop.direction).toBe('reverseTangent');
        });

        it('throws when the stop id is not found', () => {
            expect(() =>
                mgr.updateStopPosition(platformId, 999, { tValue: 0.5 })
            ).toThrow();
        });

        it('throws when the new tValue is outside the spine entry range', () => {
            expect(() =>
                mgr.updateStopPosition(platformId, 0, { tValue: 0.9 })
            ).toThrow();
        });
    });

    describe('removeStopPosition', () => {
        it('removes the stop and keeps remaining ids', () => {
            mgr.removeStopPosition(platformId, 0);
            const stops = mgr.getPlatform(platformId)!.stopPositions;
            expect(stops).toHaveLength(1);
            expect(stops[0].id).toBe(1);
        });

        it('subsequent add issues a fresh id (not the deleted one)', () => {
            mgr.removeStopPosition(platformId, 0);
            const newId = mgr.addStopPosition(platformId, {
                trackSegmentId: 10,
                direction: 'tangent',
                tValue: 0.3,
            });
            expect(newId).toBe(2);
        });

        it('is a no-op when the id does not exist', () => {
            expect(() => mgr.removeStopPosition(platformId, 999)).not.toThrow();
            expect(mgr.getPlatform(platformId)!.stopPositions).toHaveLength(2);
        });
    });
});
```

- [ ] **Step 2: Run the tests and confirm they fail.**

Run: `bun test test/track-aligned-platform-stop-crud.test.ts`
Expected: FAIL — methods do not exist.

- [ ] **Step 3: Implement the CRUD methods.**

Edit `src/stations/track-aligned-platform-manager.ts`. Add the import:

```ts
import { nextStopPositionId } from './stop-position-utils';
import type { TrackDirection } from './types';
```

Add the following methods to the class, placed after `getPlatformsBySegment` and before the `Serialization` section header:

```ts
// -----------------------------------------------------------------------
// Stop position CRUD
// -----------------------------------------------------------------------

addStopPosition(
    platformId: number,
    input: { trackSegmentId: number; direction: TrackDirection; tValue: number },
): number {
    const platform = this._getPlatformOrThrow(platformId);
    this._validateStop(platform, input);
    const id = nextStopPositionId(platform.stopPositions);
    platform.stopPositions.push({ id, ...input });
    this._changeObservable.notify();
    return id;
}

updateStopPosition(
    platformId: number,
    stopId: number,
    patch: { direction?: TrackDirection; tValue?: number },
): void {
    const platform = this._getPlatformOrThrow(platformId);
    const stop = platform.stopPositions.find((s) => s.id === stopId);
    if (!stop) {
        throw new Error(
            `TrackAlignedPlatformManager.updateStopPosition: stop ${stopId} not found on platform ${platformId}`,
        );
    }
    const next = {
        trackSegmentId: stop.trackSegmentId,
        direction: patch.direction ?? stop.direction,
        tValue: patch.tValue ?? stop.tValue,
    };
    this._validateStop(platform, next);
    stop.direction = next.direction;
    stop.tValue = next.tValue;
    this._changeObservable.notify();
}

removeStopPosition(platformId: number, stopId: number): void {
    const platform = this._getPlatformOrThrow(platformId);
    const before = platform.stopPositions.length;
    platform.stopPositions = platform.stopPositions.filter((s) => s.id !== stopId);
    if (platform.stopPositions.length !== before) {
        this._changeObservable.notify();
    }
}

private _getPlatformOrThrow(platformId: number): TrackAlignedPlatform {
    const platform = this._manager.getEntity(platformId);
    if (!platform) {
        throw new Error(
            `TrackAlignedPlatformManager: platform ${platformId} not found`,
        );
    }
    return platform;
}

private _validateStop(
    platform: TrackAlignedPlatform,
    input: { trackSegmentId: number; tValue: number },
): void {
    const entry = platform.spine.find((e) => e.trackSegment === input.trackSegmentId);
    if (!entry) {
        throw new Error(
            `TrackAlignedPlatformManager: trackSegmentId ${input.trackSegmentId} is not on platform ${platform.id}`,
        );
    }
    const lo = Math.min(entry.tStart, entry.tEnd);
    const hi = Math.max(entry.tStart, entry.tEnd);
    if (input.tValue < lo || input.tValue > hi) {
        throw new Error(
            `TrackAlignedPlatformManager: tValue ${input.tValue} is outside spine entry range [${lo}, ${hi}] for segment ${input.trackSegmentId}`,
        );
    }
}
```

- [ ] **Step 4: Run the tests and confirm they pass.**

Run: `bun test test/track-aligned-platform-stop-crud.test.ts`
Expected: PASS (10 cases).

Also run `bun test` full and `bun run build` — both green.

- [ ] **Step 5: Commit.**

```bash
git add \
    src/stations/track-aligned-platform-manager.ts \
    test/track-aligned-platform-stop-crud.test.ts
git commit -m "feat(stations): add stop position CRUD to TrackAlignedPlatformManager"
```

---

## Task 5: `ScheduledStop.stopPositionId` migration

**Files:**

- Modify: `src/timetable/types.ts`
- Modify: `src/timetable/shift-template-manager.ts`
- Modify: `src/timetable/timetable-manager.ts`
- Create: `test/scheduled-stop-id-migration.test.ts`

In-memory `ScheduledStop` switches to `stopPositionId`. Serialized form keeps both `stopPositionId` and `stopPositionIndex` as optional — `deserialize` resolves indices via the platform managers when only the legacy field is present.

- [ ] **Step 1: Write the failing test for the migration.**

Create `test/scheduled-stop-id-migration.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';

import { StationManager } from '../src/stations/station-manager';
import { TrackAlignedPlatformManager } from '../src/stations/track-aligned-platform-manager';
import { ShiftTemplateManager } from '../src/timetable/shift-template-manager';
import type { SerializedShiftTemplate } from '../src/timetable/types';
import { ELEVATION } from '../src/trains/tracks/types';

function makeStationWithIslandPlatform() {
    const mgr = new StationManager();
    const id = mgr.createStation({
        name: 'A',
        position: { x: 0, y: 0 },
        elevation: ELEVATION.GROUND,
        platforms: [
            {
                id: 0,
                track: 100,
                width: 5,
                offset: 1,
                side: 1,
                stopPositions: [
                    {
                        id: 5,
                        trackSegmentId: 100,
                        direction: 'tangent',
                        tValue: 0.5,
                    },
                    {
                        id: 8,
                        trackSegmentId: 100,
                        direction: 'reverseTangent',
                        tValue: 0.5,
                    },
                ],
            },
        ],
        trackSegments: [100],
        joints: [],
        trackAlignedPlatforms: [],
    });
    return { mgr, stationId: id };
}

describe('ShiftTemplateManager.deserialize — ScheduledStop id migration', () => {
    it('uses stopPositionId directly when present in the serialized form', () => {
        const { mgr: stationMgr, stationId } = makeStationWithIslandPlatform();
        const tapMgr = new TrackAlignedPlatformManager();

        const serialized: SerializedShiftTemplate[] = [
            {
                id: 's1',
                name: 'S1',
                activeDays: {
                    '0': true,
                    '1': false,
                    '2': false,
                    '3': false,
                    '4': false,
                    '5': false,
                    '6': false,
                },
                stops: [
                    {
                        stationId,
                        platformKind: 'island',
                        platformId: 0,
                        stopPositionId: 8,
                        arrivalTime: null,
                        departureTime: 100,
                    },
                    {
                        stationId,
                        platformKind: 'island',
                        platformId: 0,
                        stopPositionId: 5,
                        arrivalTime: 200,
                        departureTime: null,
                    },
                ],
                legs: [{ routeId: 'r1' }],
            },
        ];

        const restored = ShiftTemplateManager.deserialize(
            serialized,
            stationMgr,
            tapMgr
        );
        const t = restored.getTemplate('s1')!;
        expect(t.stops[0].stopPositionId).toBe(8);
        expect(t.stops[1].stopPositionId).toBe(5);
    });

    it("resolves legacy stopPositionIndex to the platform stop's id", () => {
        const { mgr: stationMgr, stationId } = makeStationWithIslandPlatform();
        const tapMgr = new TrackAlignedPlatformManager();

        const serialized: SerializedShiftTemplate[] = [
            {
                id: 's1',
                name: 'S1',
                activeDays: {
                    '0': true,
                    '1': false,
                    '2': false,
                    '3': false,
                    '4': false,
                    '5': false,
                    '6': false,
                },
                stops: [
                    {
                        stationId,
                        platformKind: 'island',
                        platformId: 0,
                        stopPositionIndex: 0,
                        arrivalTime: null,
                        departureTime: 100,
                    },
                    {
                        stationId,
                        platformKind: 'island',
                        platformId: 0,
                        stopPositionIndex: 1,
                        arrivalTime: 200,
                        departureTime: null,
                    },
                ],
                legs: [{ routeId: 'r1' }],
            },
        ];

        const restored = ShiftTemplateManager.deserialize(
            serialized,
            stationMgr,
            tapMgr
        );
        const t = restored.getTemplate('s1')!;
        // Index 0 → id 5; index 1 → id 8.
        expect(t.stops[0].stopPositionId).toBe(5);
        expect(t.stops[1].stopPositionId).toBe(8);
    });

    it('leaves stopPositionId as -1 when neither id nor a resolvable index is present', () => {
        const { mgr: stationMgr, stationId } = makeStationWithIslandPlatform();
        const tapMgr = new TrackAlignedPlatformManager();

        const serialized: SerializedShiftTemplate[] = [
            {
                id: 's1',
                name: 'S1',
                activeDays: {
                    '0': true,
                    '1': false,
                    '2': false,
                    '3': false,
                    '4': false,
                    '5': false,
                    '6': false,
                },
                stops: [
                    {
                        stationId,
                        platformKind: 'island',
                        platformId: 0,
                        stopPositionIndex: 99,
                        arrivalTime: null,
                        departureTime: 100,
                    },
                ],
                legs: [],
            },
        ];

        const restored = ShiftTemplateManager.deserialize(
            serialized,
            stationMgr,
            tapMgr
        );
        const t = restored.getTemplate('s1')!;
        expect(t.stops[0].stopPositionId).toBe(-1);
    });
});
```

- [ ] **Step 2: Run the test and confirm it fails.**

Run: `bun test test/scheduled-stop-id-migration.test.ts`
Expected: FAIL — `ShiftTemplateManager.deserialize` doesn't accept the manager arguments yet.

- [ ] **Step 3: Update the in-memory and serialized types.**

Edit `src/timetable/types.ts`. Replace the `ScheduledStop` declaration:

```ts
export type ScheduledStop = {
    stationId: number;
    platformKind: 'island' | 'trackAligned';
    platformId: number;
    /** Stable id within the platform's stopPositions array. */
    stopPositionId: number;
    arrivalTime: WeekMs | null;
    departureTime: WeekMs | null;
};
```

Replace `SerializedScheduledStop`:

```ts
export type SerializedScheduledStop = {
    stationId: number;
    /** Optional for backward compat — defaults to `'island'` when absent. */
    platformKind?: 'island' | 'trackAligned';
    platformId: number;
    /** New format: stable stop id. */
    stopPositionId?: number;
    /** Legacy format: positional index. Resolved to id at deserialize time. */
    stopPositionIndex?: number;
    arrivalTime: number | null;
    departureTime: number | null;
};
```

- [ ] **Step 4: Update `ShiftTemplateManager` serialization.**

Edit `src/timetable/shift-template-manager.ts`. Add imports:

```ts
import type { StationManager } from '@/stations/station-manager';
import type { TrackAlignedPlatformManager } from '@/stations/track-aligned-platform-manager';
```

Rewrite the `serialize` method (around line 122) — the `stops.map` block — to emit `stopPositionId`:

```ts
serialize(): SerializedShiftTemplate[] {
    return this.getAllTemplates().map((t) => ({
        id: t.id,
        name: t.name,
        activeDays: Object.fromEntries(
            Object.entries(t.activeDays).map(([k, v]) => [String(k), v]),
        ),
        stops: t.stops.map((s) => ({
            stationId: s.stationId,
            platformKind: s.platformKind,
            platformId: s.platformId,
            stopPositionId: s.stopPositionId,
            arrivalTime: s.arrivalTime,
            departureTime: s.departureTime,
        })),
        legs: t.legs.map((l) => ({ routeId: l.routeId })),
    }));
}
```

Rewrite the `deserialize` static method (around line 141) to accept platform managers and resolve indices:

```ts
static deserialize(
    data: SerializedShiftTemplate[],
    stationManager: StationManager,
    trackAlignedPlatformManager: TrackAlignedPlatformManager,
): ShiftTemplateManager {
    const manager = new ShiftTemplateManager();
    for (const st of data) {
        const activeDays = {} as DayMask;
        for (let d = DayOfWeek.Monday; d <= DayOfWeek.Sunday; d++) {
            activeDays[d as DayOfWeek] = st.activeDays[String(d)] ?? false;
        }
        manager._templates.set(st.id, {
            id: st.id,
            name: st.name,
            activeDays,
            stops: st.stops.map((s) => ({
                stationId: s.stationId,
                platformKind: s.platformKind ?? 'island',
                platformId: s.platformId,
                stopPositionId: ShiftTemplateManager._resolveStopPositionId(
                    s,
                    stationManager,
                    trackAlignedPlatformManager,
                ),
                arrivalTime: s.arrivalTime,
                departureTime: s.departureTime,
            })),
            legs: st.legs.map((l) => ({ routeId: l.routeId })),
        });
    }
    return manager;
}

/**
 * Resolve a serialized scheduled stop to a stable `stopPositionId`.
 *
 * - If `stopPositionId` is present, it wins.
 * - Else if `stopPositionIndex` is present, look up the platform's
 *   `stopPositions[index].id` and use that.
 * - Otherwise (or if the lookup fails), return `-1` to surface the
 *   reference as broken — the timetable UI / AutoDriver treat negative
 *   ids as "no stop".
 */
private static _resolveStopPositionId(
    s: SerializedScheduledStop,
    stationManager: StationManager,
    trackAlignedPlatformManager: TrackAlignedPlatformManager,
): number {
    if (typeof s.stopPositionId === 'number') return s.stopPositionId;
    if (typeof s.stopPositionIndex !== 'number') return -1;

    const kind = s.platformKind ?? 'island';
    if (kind === 'island') {
        const station = stationManager.getStation(s.stationId);
        const platform = station?.platforms.find((p) => p.id === s.platformId);
        const stop = platform?.stopPositions[s.stopPositionIndex];
        return stop?.id ?? -1;
    }
    const tap = trackAlignedPlatformManager.getPlatform(s.platformId);
    const stop = tap?.stopPositions[s.stopPositionIndex];
    return stop?.id ?? -1;
}
```

Add a `SerializedScheduledStop` import at the top of `shift-template-manager.ts` (alongside the existing `DayOfWeek`, `ShiftTemplate`, etc. imports):

```ts
import type {
    DayMask,
    SerializedScheduledStop,
    SerializedShiftTemplate,
    ShiftTemplate,
    ShiftTemplateId,
} from './types';
```

- [ ] **Step 5: Update `TimetableManager.deserialize` signature.**

Edit `src/timetable/timetable-manager.ts`. Locate the `static deserialize` method. It currently takes `(data, trackGraph, trainManager, stationManager, signalStateEngine?)`. Add a `trackAlignedPlatformManager: TrackAlignedPlatformManager` parameter (after `stationManager`, before `signalStateEngine`). Pass it through to `ShiftTemplateManager.deserialize`.

Concretely (the exact name of internal calls may differ — adjust):

```ts
static deserialize(
    data: SerializedTimetableData,
    trackGraph: TrackGraph,
    trainManager: TrainManager,
    stationManager: StationManager,
    trackAlignedPlatformManager: TrackAlignedPlatformManager,
    signalStateEngine?: SignalStateEngine,
): TimetableManager {
    // ... same as before, but at the line that calls
    // ShiftTemplateManager.deserialize, pass the new manager:
    const shiftTemplateManager = ShiftTemplateManager.deserialize(
        data.shiftTemplates,
        stationManager,
        trackAlignedPlatformManager,
    );
    // ... rest unchanged
}
```

Make sure the type import for `TrackAlignedPlatformManager` is added at the top.

- [ ] **Step 6: Update all call sites of `TimetableManager.deserialize`.**

Three known call sites:

- `src/scene-serialization.ts:170` — already passes `stationManager`. Add `app.trackAlignedPlatformManager` after `stationManager`.
- `src/components/toolbar/TimetablePanel.tsx:980` — same; add `app.trackAlignedPlatformManager`.

Inspect both files and adjust. Search the repo for `TimetableManager.deserialize(` to make sure no others were added.

- [ ] **Step 7: Update existing tests for the new signature.**

Search `test/` for `ShiftTemplateManager.deserialize(` and `TimetableManager.deserialize(`. Likely affected files:

- `test/shift-template-manager.test.ts` — update its `deserialize` calls to pass `new StationManager()` and `new TrackAlignedPlatformManager()`.
- `test/shift-template-manager-remap.test.ts` — its test fixtures construct `ShiftTemplate` objects in memory (not via `deserialize`); they need their `ScheduledStop.stopPositionIndex` field renamed to `stopPositionId`.

Edit each affected test to match the new signature.

- [ ] **Step 8: Run the new test plus the full suite.**

Run: `bun test test/scheduled-stop-id-migration.test.ts`
Expected: PASS (3 cases).

Run: `bun test`
Expected: full suite green.

Run: `bun run build`
Expected: success.

- [ ] **Step 9: Commit.**

```bash
git add \
    src/timetable/types.ts \
    src/timetable/shift-template-manager.ts \
    src/timetable/timetable-manager.ts \
    src/scene-serialization.ts \
    src/components/toolbar/TimetablePanel.tsx \
    test/scheduled-stop-id-migration.test.ts \
    test/shift-template-manager.test.ts \
    test/shift-template-manager-remap.test.ts
git commit -m "feat(timetable): switch ScheduledStop to stopPositionId with legacy index fallback"
```

---

## Task 6: Update Phase 1 dual-spine remap to use `stopPositionId`

**Files:**

- Modify: `src/timetable/shift-template-manager.ts`
- Modify: `test/shift-template-manager-remap.test.ts`

Phase 1's `remapTrackAlignedPlatformReferences` rewrites `(platformId, stopPositionIndex)`. After Task 5, in-memory ScheduledStops use `stopPositionId`, not `stopPositionIndex`. Phase 2 changes the remap to write `stopPositionId` directly using the `newStopId` field added to the migration map in Task 2.

- [ ] **Step 1: Update the existing remap tests for the new shape.**

Edit `test/shift-template-manager-remap.test.ts`. The fixtures build `ShiftTemplate` objects with `stopPositionId: 2` (already renamed in Task 5 Step 7). The migration-map entries gain `newStopId`. Update the assertions to check `stopPositionId`:

```ts
// First test (rewrites...):
const map: PlatformMigrationMap = new Map([
    [5, new Map([[2, { newPlatformId: 11, newStopIndex: 0, newStopId: 0 }]])],
]);
mgr.remapTrackAlignedPlatformReferences(map);

const t = mgr.getTemplate('shift-1')!;
expect(t.stops[0].platformId).toBe(11);
expect(t.stops[0].stopPositionId).toBe(0);
```

Note the test `makeTemplate` helper uses `stopPositionId: 2` to seed the template. The `map.get(5).get(2)` look-up uses `2` as the key — that key is the OLD index (legacy serialized form). Since the migration map's purpose is to bridge OLD index references to NEW (platformId, stopId), the key remains "old index" by design.

Update all three test cases consistently. The orphan test (`'leaves orphaned stops...'`) keeps `newStopId: -1` and the remap should skip the rewrite when `newStopId < 0`.

But wait — the templates' in-memory shape now uses `stopPositionId` not `stopPositionIndex`. After Task 5, the migration map's KEY (old index) doesn't correspond to anything in-memory. The remap needs a different mental model.

**Rethink:** The Phase 1 remap was conceptually `(oldPlatformId, oldStopIndex) → (newPlatformId, newStopIndex)`. The lookup key (old index) was matched against `ScheduledStop.stopPositionIndex` because that's what the in-memory shape was at the time.

In Phase 2, in-memory shape is `stopPositionId`. There is no "old index" in memory anymore — that field was resolved to an id during deserialize. So the migration map keyed on old index is no longer applicable AFTER deserialize.

**Architectural correction:** the dual-spine migration map needs to be applied BEFORE `ShiftTemplateManager.deserialize` resolves the indices to ids. Or equivalently, the deserializer needs to know about the migration map.

Two approaches:

**Approach A (preferred — more local, simpler):** In `ShiftTemplateManager.deserialize`, treat the legacy `stopPositionIndex` lookup as: "first remap (oldPlatformId, oldStopIndex) → (newPlatformId, newStopId) via the migration map, then if no migration entry, fall back to a direct lookup on the platform". The remap method (`remapTrackAlignedPlatformReferences`) becomes obsolete — it's folded into deserialize.

**Approach B (keep two-step):** Continue applying the migration map after deserialize. Re-store `stopPositionIndex` on `ScheduledStop` as a transient field used only for the remap, then drop it. Awkward.

**Go with Approach A.** Replace the remap method entirely.

Rewrite this task as follows:

- Drop `remapTrackAlignedPlatformReferences` from `ShiftTemplateManager` — it's no longer used.
- Update `ShiftTemplateManager.deserialize` to accept an optional migration map and use it during resolution.
- Update `_resolveStopPositionId` accordingly.
- Update `scene-serialization.ts` to pass the migration map to `TimetableManager.deserialize` (which forwards to `ShiftTemplateManager.deserialize`).
- Update `TimetableManager.deserialize` signature to accept the migration map.
- Update or delete the existing `test/shift-template-manager-remap.test.ts`. The remap behavior is now exercised through the deserialize path.

- [ ] **Step 2: Replace the resolve helper to consult the migration map first.**

Edit `src/timetable/shift-template-manager.ts`.

Update the import from `track-aligned-platform-migration` if not already present:

```ts
import type { PlatformMigrationMap } from '@/stations/track-aligned-platform-migration';
```

Change `_resolveStopPositionId` to accept and use the migration map:

```ts
private static _resolveStopPositionId(
    s: SerializedScheduledStop,
    stationManager: StationManager,
    trackAlignedPlatformManager: TrackAlignedPlatformManager,
    platformMigrationMap: PlatformMigrationMap,
): { platformId: number; stopPositionId: number } {
    // Direct id wins.
    if (typeof s.stopPositionId === 'number') {
        return { platformId: s.platformId, stopPositionId: s.stopPositionId };
    }

    if (typeof s.stopPositionIndex !== 'number') {
        return { platformId: s.platformId, stopPositionId: -1 };
    }

    const kind = s.platformKind ?? 'island';

    // Track-aligned: consult the migration map (handles dual-spine split).
    if (kind === 'trackAligned') {
        const migration = platformMigrationMap
            .get(s.platformId)
            ?.get(s.stopPositionIndex);
        if (migration) {
            if (migration.newStopId < 0) {
                // Orphaned by the split — return the migrated platform id
                // but leave the stop reference broken so the UI can flag it.
                return { platformId: migration.newPlatformId, stopPositionId: -1 };
            }
            return {
                platformId: migration.newPlatformId,
                stopPositionId: migration.newStopId,
            };
        }
        // No migration entry: look up directly on the (un-split) platform.
        const tap = trackAlignedPlatformManager.getPlatform(s.platformId);
        const stop = tap?.stopPositions[s.stopPositionIndex];
        return {
            platformId: s.platformId,
            stopPositionId: stop?.id ?? -1,
        };
    }

    // Island platforms never participate in the dual-spine split.
    const station = stationManager.getStation(s.stationId);
    const platform = station?.platforms.find((p) => p.id === s.platformId);
    const stop = platform?.stopPositions[s.stopPositionIndex];
    return { platformId: s.platformId, stopPositionId: stop?.id ?? -1 };
}
```

Update `deserialize` to accept and forward the map:

```ts
static deserialize(
    data: SerializedShiftTemplate[],
    stationManager: StationManager,
    trackAlignedPlatformManager: TrackAlignedPlatformManager,
    platformMigrationMap: PlatformMigrationMap = new Map(),
): ShiftTemplateManager {
    const manager = new ShiftTemplateManager();
    for (const st of data) {
        const activeDays = {} as DayMask;
        for (let d = DayOfWeek.Monday; d <= DayOfWeek.Sunday; d++) {
            activeDays[d as DayOfWeek] = st.activeDays[String(d)] ?? false;
        }
        manager._templates.set(st.id, {
            id: st.id,
            name: st.name,
            activeDays,
            stops: st.stops.map((s) => {
                const resolved = ShiftTemplateManager._resolveStopPositionId(
                    s,
                    stationManager,
                    trackAlignedPlatformManager,
                    platformMigrationMap,
                );
                return {
                    stationId: s.stationId,
                    platformKind: s.platformKind ?? 'island',
                    platformId: resolved.platformId,
                    stopPositionId: resolved.stopPositionId,
                    arrivalTime: s.arrivalTime,
                    departureTime: s.departureTime,
                };
            }),
            legs: st.legs.map((l) => ({ routeId: l.routeId })),
        });
    }
    return manager;
}
```

Delete the now-obsolete `remapTrackAlignedPlatformReferences` method.

- [ ] **Step 3: Update `TimetableManager.deserialize` to forward the migration map.**

Edit `src/timetable/timetable-manager.ts`. Add a `platformMigrationMap?: PlatformMigrationMap` parameter (default empty Map) and pass it through to `ShiftTemplateManager.deserialize`. Add the type import.

- [ ] **Step 4: Update `scene-serialization.ts`.**

Replace the post-deserialize `restored.shiftTemplateManager.remapTrackAlignedPlatformReferences(platformMigrationMap)` call with passing `platformMigrationMap` directly into the `TimetableManager.deserialize` call. Also pass `app.trackAlignedPlatformManager` (Task 5 added that parameter).

The relevant block becomes:

```ts
const restored = TimetableManager.deserialize(
    data.timetable,
    app.curveEngine.trackGraph,
    app.trainManager,
    app.stationManager,
    app.trackAlignedPlatformManager,
    app.signalStateEngine,
    platformMigrationMap
);
// (Drop the line that called `remapTrackAlignedPlatformReferences`.)
```

Adjust parameter ordering as needed to match the actual `TimetableManager.deserialize` signature you defined in Step 3.

- [ ] **Step 5: Update or delete `test/shift-template-manager-remap.test.ts`.**

The test file's purpose was to verify `remapTrackAlignedPlatformReferences`. That method is gone. Either:

- Delete the file (the new behavior is covered by `test/scheduled-stop-id-migration.test.ts` plus a new test below).
- Or repurpose it to exercise the deserialize-with-migration-map path.

Replace the file with this rewrite that exercises the new path:

```ts
import { describe, expect, it } from 'bun:test';

import { StationManager } from '../src/stations/station-manager';
import { TrackAlignedPlatformManager } from '../src/stations/track-aligned-platform-manager';
import type { PlatformMigrationMap } from '../src/stations/track-aligned-platform-migration';
import { ShiftTemplateManager } from '../src/timetable/shift-template-manager';
import type { SerializedShiftTemplate } from '../src/timetable/types';

function makeSerializedTemplate(
    platformId: number,
    stopPositionIndex: number
): SerializedShiftTemplate[] {
    return [
        {
            id: 's1',
            name: 'S1',
            activeDays: {
                '0': true,
                '1': false,
                '2': false,
                '3': false,
                '4': false,
                '5': false,
                '6': false,
            },
            stops: [
                {
                    stationId: 1,
                    platformKind: 'trackAligned',
                    platformId,
                    stopPositionIndex,
                    arrivalTime: null,
                    departureTime: 100,
                },
            ],
            legs: [],
        },
    ];
}

describe('ShiftTemplateManager.deserialize with platformMigrationMap', () => {
    it('rewrites platformId and stopPositionId using the migration map', () => {
        const stationMgr = new StationManager();
        const tapMgr = new TrackAlignedPlatformManager();
        const map: PlatformMigrationMap = new Map([
            [
                5,
                new Map([
                    [2, { newPlatformId: 11, newStopIndex: 0, newStopId: 7 }],
                ]),
            ],
        ]);

        const restored = ShiftTemplateManager.deserialize(
            makeSerializedTemplate(5, 2),
            stationMgr,
            tapMgr,
            map
        );
        const t = restored.getTemplate('s1')!;
        expect(t.stops[0].platformId).toBe(11);
        expect(t.stops[0].stopPositionId).toBe(7);
    });

    it('returns stopPositionId = -1 when migration entry has newStopId = -1 (orphan)', () => {
        const stationMgr = new StationManager();
        const tapMgr = new TrackAlignedPlatformManager();
        const map: PlatformMigrationMap = new Map([
            [
                5,
                new Map([
                    [2, { newPlatformId: 11, newStopIndex: -1, newStopId: -1 }],
                ]),
            ],
        ]);

        const restored = ShiftTemplateManager.deserialize(
            makeSerializedTemplate(5, 2),
            stationMgr,
            tapMgr,
            map
        );
        const t = restored.getTemplate('s1')!;
        expect(t.stops[0].platformId).toBe(11);
        expect(t.stops[0].stopPositionId).toBe(-1);
    });

    it('falls back to direct platform lookup when no migration entry exists', () => {
        const stationMgr = new StationManager();
        const tapMgr = new TrackAlignedPlatformManager();
        // Empty map — no migration.
        const map: PlatformMigrationMap = new Map();

        // Construct an in-memory platform so the fallback lookup finds it.
        // (We don't strictly need this test to find the platform; we just
        // need to verify the migration-miss branch returns -1 cleanly when
        // there's no platform either.)
        const restored = ShiftTemplateManager.deserialize(
            makeSerializedTemplate(99, 0),
            stationMgr,
            tapMgr,
            map
        );
        const t = restored.getTemplate('s1')!;
        expect(t.stops[0].platformId).toBe(99);
        expect(t.stops[0].stopPositionId).toBe(-1);
    });
});
```

- [ ] **Step 6: Run the full test suite.**

Run: `bun test`
Expected: all green.

Run: `bun run build`
Expected: success.

- [ ] **Step 7: Commit.**

```bash
git add \
    src/timetable/shift-template-manager.ts \
    src/timetable/timetable-manager.ts \
    src/scene-serialization.ts \
    test/shift-template-manager-remap.test.ts
git commit -m "feat(timetable): apply dual-spine migration during deserialize"
```

---

## Task 7: AutoDriver lookup by `stopPositionId`

**Files:**

- Modify: `src/timetable/auto-driver.ts`
- Modify: `test/auto-driver.test.ts`

`AutoDriver._getDistanceToStop` (around line 425-441 of `auto-driver.ts`) currently reads the stop position via `platform.stopPositions[stopPositionIndex]`. Phase 2 changes it to `platform.stopPositions.find((s) => s.id === stopPositionId)`.

- [ ] **Step 1: Read the existing AutoDriver test to understand current fixtures.**

Open `test/auto-driver.test.ts`. Find a test that exercises `driveStep` or `_getDistanceToStop`. The existing tests construct `ScheduledStop` objects with the legacy `stopPositionIndex`. Identify two or three such tests as the candidates to update.

- [ ] **Step 2: Update existing AutoDriver tests to use `stopPositionId`.**

In `test/auto-driver.test.ts`:

a) Find every `stopPositionIndex: <n>` field on a `ScheduledStop` literal and rename to `stopPositionId: <id>`. The numeric value can stay the same as long as the corresponding platform's `stopPositions` array has an entry whose `id` matches that value (e.g. test fixtures created via `assignStopPositionIds` or hand-built with `id: 0, id: 1` will give stops at indices 0 and 1 the matching ids 0 and 1, so the existing values keep working).

b) Find every inline `stopPositions: [...]` literal in test fixtures (whether on `Platform` or `TrackAlignedPlatform`) and add `id: 0, 1, ...` to each entry, sequentially.

c) Append the following dedicated test at the end of the file's outermost `describe`. It uses ONLY the existing helpers — read the imports at the top of the test file and keep the same patterns:

```ts
describe('AutoDriver looks up stops by id, not array position', () => {
    it('finds the target stop when its id is non-zero and array index is zero', () => {
        // Build a minimal platform whose ONLY stop has id=42 at array index 0.
        // Build a ScheduledStop with stopPositionId: 42.
        // Drive one step and confirm distance is finite (i.e. the stop was
        // located). If the lookup were by index, only id=0 would resolve.
        // For test scaffolding (track graph, route, station, etc.), copy the
        // setup from the nearest existing test in this file.
    });
});
```

(The plan does not include the full test body because `auto-driver.test.ts`'s setup pattern depends on which test you crib from. Read the closest existing test that exercises `_getDistanceToStop` and adapt its fixtures so the platform's only stop has `id: 42`. Keep the change scoped — don't refactor the harness.)

- [ ] **Step 3: Run the tests, expect failures.**

Run: `bun test test/auto-driver.test.ts`
Expected: FAIL — the implementation still uses index lookup.

- [ ] **Step 4: Update `_getDistanceToStop` in `auto-driver.ts`.**

Edit `src/timetable/auto-driver.ts` around lines 425-441. Replace the index-based lookup with id-based:

```ts
let stopPos: StopPosition | undefined;

if (nextScheduledStop.platformKind === 'trackAligned') {
    const tap = trackAlignedPlatformManager?.getPlatform(nextScheduledStop.platformId);
    stopPos = tap?.stopPositions.find((s) => s.id === nextScheduledStop.stopPositionId);
} else {
    const platform = station.platforms.find(
        (p) => p.id === nextScheduledStop.platformId,
    );
    stopPos = platform?.stopPositions.find((s) => s.id === nextScheduledStop.stopPositionId);
}

if (!stopPos) return null;
```

Note: `nextScheduledStop.stopPositionId` replaces `nextScheduledStop.stopPositionIndex`. Confirm the field name in `ScheduledStop` is now `stopPositionId` (Task 5 renamed it).

- [ ] **Step 5: Run the tests and confirm they pass.**

Run: `bun test test/auto-driver.test.ts`
Expected: PASS.

Also run `bun test` full and `bun run build`.

- [ ] **Step 6: Commit.**

```bash
git add \
    src/timetable/auto-driver.ts \
    test/auto-driver.test.ts
git commit -m "feat(timetable): AutoDriver looks up stop positions by id"
```

---

## Task 8: TimetablePanel UI uses `stopPositionId`

**Files:**

- Modify: `src/components/toolbar/TimetablePanel.tsx`

The dropdown built by `buildStopPositionOptions` and consumed by the shift editor currently uses the array-index `stopPositionIndex` as its option value. Phase 2 switches it to `stopPositionId`.

- [ ] **Step 1: Update `buildStopPositionOptions` to emit ids as values.**

Edit `src/components/toolbar/TimetablePanel.tsx`. Locate `buildStopPositionOptions` (introduced in the earlier `feat(timetable): add stop position selector` commit). Update its return type to `{ id: number; label: string }[]` and its body to map `(_, i) => ({ id: <stop>.id, label: <existing> })` instead of `{ index: i, label }`.

Concretely:

```ts
function buildStopPositionOptions(
    platformValue: string,
    stationId: number,
    stationManager: StationManager,
    trackAlignedPlatformManager: TrackAlignedPlatformManager
): { id: number; label: string }[] {
    const parsed = parsePlatformValue(platformValue);
    if (!parsed) return [];

    const platformLabel =
        parsed.kind === 'trackAligned'
            ? `T${parsed.platformId}`
            : `P${parsed.platformId}`;

    if (parsed.kind === 'trackAligned') {
        const tap = trackAlignedPlatformManager.getPlatform(parsed.platformId);
        if (!tap) return [];
        return tap.stopPositions.map((sp, i) => ({
            id: sp.id,
            label: `${platformLabel}[${i}]`,
        }));
    }

    const station = stationManager.getStation(stationId);
    if (!station) return [];
    const platform = station.platforms.find(p => p.id === parsed.platformId);
    if (!platform) return [];
    return platform.stopPositions.map((sp, i) => ({
        id: sp.id,
        label: `${platformLabel}[${i}]`,
    }));
}
```

(Note: the displayed label still uses array index `[i]` because the debug overlay also uses position-in-array. The internal value uses the stable id.)

- [ ] **Step 2: Update the form state field name and the dropdown wiring.**

Still in `src/components/toolbar/TimetablePanel.tsx`:

a) Rename the per-row form state field from `stopPositionIndex: string` to `stopPositionId: string`. Concretely, find each occurrence of `stopPositionIndex` in this file and rename to `stopPositionId`. Touch points (use Grep to confirm before editing):

- The `useState<...>` initializer for `stopsInput` (the typed shape literal).
- The two `setStopsInput([{ stationId: '', platformValue: '', stopPositionIndex: '', ... }, ...])` reset calls.
- The `addStop` helper that pushes a fresh row.
- The `updateStop` field-name union (`'stationId' | 'platformValue' | 'stopPositionIndex' | ...'`).
- The two `updateStop(i, 'stopPositionIndex', '')` calls (one inside `onValueChange` of the station select, one inside `onValueChange` of the platform select).
- The `<Select value={stop.stopPositionIndex || NONE} onValueChange={(val) => updateStop(i, 'stopPositionIndex', ...)}>` block under the platform selector.
- The `parseInt(s.stopPositionIndex, 10)` line inside `handleAdd` and the resulting `ScheduledStop` literal.

b) In the dropdown render block, change `<SelectItem key={opt.index} value={String(opt.index)}>` to `<SelectItem key={opt.id} value={String(opt.id)}>`. (The local variable `spOptions` now contains `{ id, label }` objects — the import-side update from Step 1.)

c) In the `handleAdd` callback, the local variable `const spIdx = parseInt(s.stopPositionIndex, 10);` becomes `const spId = parseInt(s.stopPositionId, 10);`. The `ScheduledStop` literal sets:

```ts
stopPositionId: isNaN(spId) ? -1 : spId,
```

(Use `-1` rather than `0` for "missing" — `0` is now a valid stable id, but `-1` is the "broken reference" sentinel that downstream code already handles.)

d) Verify nothing in the file still references `.stopPositionIndex` (Grep). If any lingering occurrences remain inside type imports or stale comments, update them.

- [ ] **Step 3: Run `bun test` and `bun run build`.**

Run: `bun test`
Expected: all green.

Run: `bun run build`
Expected: success.

- [ ] **Step 4: Manual verification (optional but encouraged).**

Run: `bun run dev`. Open the Timetable panel, expand a shift, place a track-aligned platform with multiple stops, and confirm the dropdown shows entries like `T0[0]`, `T0[1]`, picks correctly, and persists across save+load.

- [ ] **Step 5: Commit.**

```bash
git add src/components/toolbar/TimetablePanel.tsx
git commit -m "feat(timetable): TimetablePanel uses stopPositionId in shift dropdown"
```

---

## Task 9: `isStopPositionReferenced` helper for Phase 3

**Files:**

- Modify: `src/stations/station-manager.ts`
- Modify: `src/stations/track-aligned-platform-manager.ts`

Phase 3's PlatformEditorPanel will use this to surface the "deletion guard" — listing which shifts reference a stop before the user deletes it. Add the helper now so Phase 3 doesn't have to reach across modules.

The helper takes a `TimetableManager` (or just a `ShiftTemplateManager`) and returns the list of `ShiftTemplate`s whose `ScheduledStop`s reference this `(platformId, stopPositionId)`.

- [ ] **Step 1: Add the helper to both managers.**

Edit `src/stations/station-manager.ts`. Add the import:

```ts
import type { ShiftTemplateManager } from '@/timetable/shift-template-manager';
import type { ShiftTemplate } from '@/timetable/types';
```

Add this method to the class, after the CRUD methods from Task 3:

```ts
/**
 * Return the list of shift templates whose scheduled stops reference the
 * given stop position on an island platform. Used by the editor panel to
 * surface a deletion guard before removing a referenced stop.
 */
findShiftsReferencingStopPosition(
    stationId: number,
    platformId: number,
    stopPositionId: number,
    shiftTemplateManager: ShiftTemplateManager,
): ShiftTemplate[] {
    const result: ShiftTemplate[] = [];
    for (const template of shiftTemplateManager.getAllTemplates()) {
        for (const stop of template.stops) {
            if (
                stop.platformKind === 'island' &&
                stop.stationId === stationId &&
                stop.platformId === platformId &&
                stop.stopPositionId === stopPositionId
            ) {
                result.push(template);
                break;
            }
        }
    }
    return result;
}
```

Edit `src/stations/track-aligned-platform-manager.ts`. Add the same imports and add this method:

```ts
findShiftsReferencingStopPosition(
    platformId: number,
    stopPositionId: number,
    shiftTemplateManager: ShiftTemplateManager,
): ShiftTemplate[] {
    const result: ShiftTemplate[] = [];
    for (const template of shiftTemplateManager.getAllTemplates()) {
        for (const stop of template.stops) {
            if (
                stop.platformKind === 'trackAligned' &&
                stop.platformId === platformId &&
                stop.stopPositionId === stopPositionId
            ) {
                result.push(template);
                break;
            }
        }
    }
    return result;
}
```

- [ ] **Step 2: Add tests for both helpers.**

Append the following describe block to `test/station-manager-stop-crud.test.ts`:

```ts
import { ShiftTemplateManager } from '../src/timetable/shift-template-manager';
import { DayOfWeek } from '../src/timetable/types';

describe('StationManager.findShiftsReferencingStopPosition', () => {
    it('returns templates whose scheduled stops match', () => {
        const { mgr, stationId, platformId } = setupStationWithPlatform(10);
        const stm = new ShiftTemplateManager();
        stm.addTemplate({
            id: 's1',
            name: 'S1',
            activeDays: {
                [DayOfWeek.Monday]: true,
                [DayOfWeek.Tuesday]: false,
                [DayOfWeek.Wednesday]: false,
                [DayOfWeek.Thursday]: false,
                [DayOfWeek.Friday]: false,
                [DayOfWeek.Saturday]: false,
                [DayOfWeek.Sunday]: false,
            },
            stops: [
                {
                    stationId,
                    platformKind: 'island',
                    platformId,
                    stopPositionId: 0,
                    arrivalTime: null,
                    departureTime: 100,
                },
            ],
            legs: [],
        });

        const refs = mgr.findShiftsReferencingStopPosition(
            stationId,
            platformId,
            0,
            stm
        );
        expect(refs).toHaveLength(1);
        expect(refs[0].id).toBe('s1');
    });

    it('returns empty when no template references the stop', () => {
        const { mgr, stationId, platformId } = setupStationWithPlatform(10);
        const stm = new ShiftTemplateManager();
        const refs = mgr.findShiftsReferencingStopPosition(
            stationId,
            platformId,
            0,
            stm
        );
        expect(refs).toHaveLength(0);
    });
});
```

Append a similar block to `test/track-aligned-platform-stop-crud.test.ts`, adapted for the track-aligned manager (the stop's `platformKind === 'trackAligned'`).

- [ ] **Step 3: Run the tests and confirm they pass.**

Run:

```bash
bun test test/station-manager-stop-crud.test.ts
bun test test/track-aligned-platform-stop-crud.test.ts
bun test
```

All expected to pass.

- [ ] **Step 4: Run the build.**

Run: `bun run build`
Expected: success.

- [ ] **Step 5: Commit.**

```bash
git add \
    src/stations/station-manager.ts \
    src/stations/track-aligned-platform-manager.ts \
    test/station-manager-stop-crud.test.ts \
    test/track-aligned-platform-stop-crud.test.ts
git commit -m "feat(stations): add findShiftsReferencingStopPosition helpers"
```

---

## Closing checklist

After completing the tasks above, verify:

- [ ] `bun test` — full suite passes.
- [ ] `bun run build` — production build succeeds.
- [ ] `bun run dev` (manual) — Timetable panel still functions: pick a station + platform + stop position; saved scenes round-trip; previously-existing scenes load without error.
- [ ] Load a pre-Phase-2 saved scene that has a shift template using `stopPositionIndex`; confirm it migrates cleanly to `stopPositionId` and shifts continue to drive correctly.
