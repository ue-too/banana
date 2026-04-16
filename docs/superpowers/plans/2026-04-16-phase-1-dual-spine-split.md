# Phase 1 — Dual-Spine Platform Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor dual-spine track-aligned platforms into two single-spine platforms each, so every platform serves exactly one track and can be individually referenced by the timetable. Existing saved scenes (and their timetable shift references) migrate on load.

**Architecture:** Change `TrackAlignedPlatform` from a union that could represent either a single or dual platform into a strict single-spine record (`spine: SpineEntry[]`, `outerVertices: Point[]`). A migration helper reads legacy dual-spine serialized data, splits each one into two single-spine records, and produces a mapping that `scene-serialization.ts` uses to rewrite `ScheduledStop.platformId` and `stopPositionIndex` in the timetable. The dual-spine placement state machine is updated to commit two platforms instead of one.

**Tech Stack:** TypeScript, Bun test runner (`bun test`), Vite.

---

## Context every task depends on

- **Spec**: `docs/superpowers/specs/2026-04-16-stop-position-editing-design.md` — especially the "Dual-spine split" and "Migration" sections.
- **Central types file**: `src/stations/track-aligned-platform-types.ts` (types for `TrackAlignedPlatform`, `SpineEntry`, `OuterVertices`, and their serialized forms).
- **Key mesh helper**: `sampleSpineEdge(spine, offset, getCurve, stepsPerSegment?)` in `src/stations/spine-utils.ts` samples the offset edge of a spine.
- **Known placement entry points that build platforms**:
  - `src/stations/single-spine-placement-state-machine.ts:424-434` (already single-spine; will need the new `outerVertices: Point[]` shape)
  - `src/stations/dual-spine-placement-state-machine.ts:786-800` (currently creates one dual platform; will create two single-spine platforms)
- **Render system entry point**: `TrackAlignedPlatformRenderSystem._buildMesh()` at `src/stations/track-aligned-platform-render-system.ts:558` — the `if (platform.outerVertices.kind === 'single')` branch stays, the `else` dual branch is removed.
- **Scene load orchestration**: `deserializeSceneData()` in `src/scene-serialization.ts:60`. Note that `data.timetable` is currently deserialized BEFORE `data.trackAlignedPlatforms`. That order must be reversed (or a post-pass added) so the migration map is available when timetable references are rewritten.

## File structure

**New files:**

- `src/stations/track-aligned-platform-migration.ts` — pure helpers for reading legacy serialized data, splitting dual-spine into two single-spine records, and producing a `PlatformMigrationMap`.
- `test/track-aligned-platform-migration.test.ts` — unit tests for the migration helpers.

**Modified files:**

- `src/stations/track-aligned-platform-types.ts` — in-memory type becomes strict single-spine; add legacy-shape types for reading old data.
- `src/stations/track-aligned-platform-manager.ts` — update CRUD surface; `deserialize` accepts legacy and new formats, returning the migration map alongside the manager.
- `src/stations/track-aligned-platform-render-system.ts` — delete the dual-spine mesh path; collapse to single-spine only.
- `src/stations/dual-spine-placement-state-machine.ts` — on commit, create two single-spine platforms with a shared midline.
- `src/stations/single-spine-placement-state-machine.ts` — emit `outerVertices` in the new `Point[]` shape.
- `src/scene-serialization.ts` — reorder the load sequence so track-aligned platforms deserialize before the timetable, and apply the platform migration map to `SerializedScheduledStop` entries before `TimetableManager.deserialize`.
- `src/timetable/shift-template-manager.ts` — add a `remapPlatformReferences()` method that applies a platform migration map to in-memory templates (used after loads; also handy for runtime migrations later).
- `test/track-aligned-platform-manager.test.ts` — existing tests update to the new type shape; dual-spine helper retires.

---

## Task 1: Legacy serialized types and the new in-memory type

**Files:**

- Modify: `src/stations/track-aligned-platform-types.ts`

This task changes the types only. After this task, the codebase will not compile until the dependents (manager, render system, placement machines) are updated in subsequent tasks. That is intentional — these are cohesive changes in one commit's worth of work.

- [ ] **Step 1: Define the new in-memory type and keep a legacy serialized type for reading old data.**

Replace the content of `src/stations/track-aligned-platform-types.ts` with:

```ts
import type { Point } from '@ue-too/math';
import type { StopPosition } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Half the car body width in meters. Typical passenger car ~3m wide. */
export const DEFAULT_CAR_HALF_WIDTH = 1.5;

/** Safety gap between car body edge and platform edge (meters). */
export const DEFAULT_PLATFORM_CLEARANCE = 0.15;

/** Maximum distance (meters) from station position to platform start point. */
export const MAX_STATION_DISTANCE = 500;

// ---------------------------------------------------------------------------
// Spine
// ---------------------------------------------------------------------------

/** One segment of a platform spine — a slice of a track curve. */
export type SpineEntry = {
    trackSegment: number;
    tStart: number;
    tEnd: number;
    /**
     * Which side of this segment's curve the platform is on.
     * Per-segment because curve tangent direction can flip at joints.
     *  1 = positive-normal (left of tangent),
     * -1 = negative-normal (right of tangent).
     */
    side: 1 | -1;
};

// ---------------------------------------------------------------------------
// Entity (in-memory)
// ---------------------------------------------------------------------------

export type TrackAlignedPlatform = {
    id: number;
    /** Required — every track-aligned platform belongs to a station. */
    stationId: number;
    /** The single spine for this platform (track-side edge). */
    spine: SpineEntry[];
    /** Offset from track centerline to platform edge (meters). */
    offset: number;
    /** User-placed vertices defining the non-track side, ordered from spine end back to spine start. */
    outerVertices: Point[];
    stopPositions: StopPosition[];
};

// ---------------------------------------------------------------------------
// Serialization — new format
// ---------------------------------------------------------------------------

export type SerializedSpineEntry = {
    trackSegment: number;
    tStart: number;
    tEnd: number;
    side: 1 | -1;
};

export type SerializedTrackAlignedPlatform = {
    id: number;
    stationId: number;
    spine: SerializedSpineEntry[];
    offset: number;
    outerVertices: { x: number; y: number }[];
    stopPositions: StopPosition[];
};

export type SerializedTrackAlignedPlatformData = {
    platforms: SerializedTrackAlignedPlatform[];
};

// ---------------------------------------------------------------------------
// Serialization — legacy formats (read-only)
// ---------------------------------------------------------------------------

/**
 * Legacy outer-vertices union, kept so we can decode saved scenes that still
 * use the dual-spine representation.  New saves never write this shape.
 */
export type LegacySerializedOuterVertices =
    | { kind: 'single'; vertices: { x: number; y: number }[] }
    | { kind: 'dual'; capA: { x: number; y: number }[]; capB: { x: number; y: number }[] };

export type LegacySerializedTrackAlignedPlatform = {
    id: number;
    stationId: number;
    spineA: SerializedSpineEntry[];
    spineB: SerializedSpineEntry[] | null;
    offset: number;
    outerVertices: LegacySerializedOuterVertices;
    stopPositions: StopPosition[];
};

/**
 * A raw serialized platforms payload, which may be in either the new format
 * (`platform.spine` and `platform.outerVertices: Point[]`) or the legacy
 * format (`spineA` / `spineB` / `outerVertices: { kind: ... }`).
 */
export type AnySerializedTrackAlignedPlatform =
    | SerializedTrackAlignedPlatform
    | LegacySerializedTrackAlignedPlatform;

export type AnySerializedTrackAlignedPlatformData = {
    platforms: AnySerializedTrackAlignedPlatform[];
};

/** Type guard: does this entry use the legacy dual/single union shape? */
export function isLegacySerializedPlatform(
    p: AnySerializedTrackAlignedPlatform,
): p is LegacySerializedTrackAlignedPlatform {
    return (p as LegacySerializedTrackAlignedPlatform).spineA !== undefined;
}
```

- [ ] **Step 2: Do not run tests yet — the rest of the codebase is broken until Task 2 lands.**

- [ ] **Step 3: Commit.**

```bash
git add src/stations/track-aligned-platform-types.ts
git commit -m "refactor(stations): redefine TrackAlignedPlatform as single-spine"
```

---

## Task 2: Update the manager surface and existing helpers

**Files:**

- Modify: `src/stations/track-aligned-platform-manager.ts`
- Modify: `src/stations/single-spine-placement-state-machine.ts`
- Modify: `src/stations/track-aligned-platform-render-system.ts`
- Modify: `test/track-aligned-platform-manager.test.ts`

This task brings the dependents of the type change up to date so the project compiles and the existing tests pass again. Migration logic is deferred to Task 3.

- [ ] **Step 1: Replace the `makePlatform` helper in the tests with a single-spine shape; remove `makeDualSpinePlatform` and the dual-spine test cases.**

Edit `test/track-aligned-platform-manager.test.ts`:

Replace the `makePlatform` helper:

```ts
function makePlatform(stationId: number, segments: number[]): Omit<TrackAlignedPlatform, 'id'> {
    return {
        stationId,
        spine: segments.map((seg) => ({ trackSegment: seg, tStart: 0, tEnd: 1, side: 1 as const })),
        offset: 2.0,
        outerVertices: [{ x: 0, y: 5 }, { x: 10, y: 5 }],
        stopPositions: [],
    };
}
```

Delete the `makeDualSpinePlatform` helper and every `describe` block that references it: the `'should find platforms via spineB segment'` case, the entire `describe('dual-spine segment lookup', ...)` block, the `'should round-trip a dual-spine platform'` case, and `'should preserve outerVertices kind=dual through round-trip'`. Also delete the `'should preserve t-values and side through round-trip'` case's `outerVertices: { kind: 'single', vertices: [...] }` object literal and replace it with `outerVertices: [{ x: 1, y: 2 }]`.

Replace any `platform.spineA` reference in the remaining tests with `platform.spine`.

- [ ] **Step 2: Update `TrackAlignedPlatformManager` to use the new in-memory shape.**

In `src/stations/track-aligned-platform-manager.ts`:

- Change the `getPlatformsBySegment` method to check only the single spine (drop the `spineB` branch):

```ts
getPlatformsBySegment(segmentId: number): { id: number; platform: TrackAlignedPlatform }[] {
    return this._manager
        .getLivingEntitiesWithIndex()
        .filter(({ entity }) => entity.spine.some((e) => e.trackSegment === segmentId))
        .map(({ index, entity }) => ({ id: index, platform: entity }));
}
```

- Rewrite `serialize` to emit the new `SerializedTrackAlignedPlatform` shape (single `spine` field, plain `Point[]` outer vertices):

```ts
serialize(): SerializedTrackAlignedPlatformData {
    const platforms: SerializedTrackAlignedPlatform[] = this._manager
        .getLivingEntitiesWithIndex()
        .map(({ index, entity }) => ({
            id: index,
            stationId: entity.stationId,
            spine: entity.spine.map((e) => ({
                trackSegment: e.trackSegment,
                tStart: e.tStart,
                tEnd: e.tEnd,
                side: e.side,
            })),
            offset: entity.offset,
            outerVertices: entity.outerVertices.map((v) => ({ x: v.x, y: v.y })),
            stopPositions: entity.stopPositions.map((sp) => ({ ...sp })),
        }));
    return { platforms };
}
```

- Rewrite `deserialize` to accept ONLY the new format for now (legacy handling comes in Task 3). It should simply mirror the new `serialize` output:

```ts
static deserialize(data: SerializedTrackAlignedPlatformData): TrackAlignedPlatformManager {
    const maxId = data.platforms.reduce((max, p) => Math.max(max, p.id), -1);
    const manager = new TrackAlignedPlatformManager(Math.max(maxId + 1, 10));
    for (const p of data.platforms) {
        manager._manager.createEntityWithId(p.id, {
            id: p.id,
            stationId: p.stationId,
            spine: p.spine.map((e) => ({
                trackSegment: e.trackSegment,
                tStart: e.tStart,
                tEnd: e.tEnd,
                side: e.side,
            })),
            offset: p.offset,
            outerVertices: p.outerVertices.map((v) => ({ x: v.x, y: v.y })),
            stopPositions: p.stopPositions.map((sp) => ({ ...sp })),
        });
    }
    return manager;
}
```

- [ ] **Step 3: Update the single-spine placement state machine to emit plain `Point[]` outer vertices.**

In `src/stations/single-spine-placement-state-machine.ts`, replace the `createPlatform` call at lines 424-434 with the new shape:

```ts
const platformId = this._platformManager.createPlatform({
    stationId: this._activeStationId,
    spine: [...this._spine],
    offset: this._offset,
    outerVertices: [...this._outerVertices],
    stopPositions: computeStopPositions(this._spine, getCurve),
});
```

- [ ] **Step 4: Update the render system to consume the new platform shape.**

In `src/stations/track-aligned-platform-render-system.ts`, replace the entire `_buildMesh` method and delete `_buildDualSpineStripMesh` and `_appendCapTriangles`:

```ts
private _buildMesh(platform: TrackAlignedPlatform): MeshSimple | null {
    const texture = this._getOrCreateTexture();
    if (texture === null) return null;

    const getCurve = (segmentId: number) => {
        const curve = this._trackGraph.getTrackSegmentCurve(segmentId);
        if (curve === null) throw new Error(`Missing curve for segment ${segmentId}`);
        return curve;
    };

    try {
        const trackEdge = sampleSpineEdge(platform.spine, platform.offset, getCurve);
        return this._buildSingleSpineStripMesh(trackEdge, platform.outerVertices, texture);
    } catch {
        return null;
    }
}
```

Also delete the `earcut` import at the top of the file (it is no longer referenced) — this will also need `import earcut from 'earcut';` removed.

- [ ] **Step 5: Update the dual-spine placement state machine's `finalize()` to compile against the new shape. This is the *temporary* form; Task 5 replaces it with the real two-platform commit.**

In `src/stations/dual-spine-placement-state-machine.ts`, around line 786, temporarily replace the `createPlatform` call with a placeholder that creates a single-spine platform from `spineA` only, so the file compiles:

```ts
const platformId = this._platformManager.createPlatform({
    stationId: this._activeStationId,
    spine: [...this._spineA],
    offset: this._spineAOffset,
    outerVertices: [...this._capA],
    stopPositions: computeStopPositions(this._spineA, getCurve),
});
```

Leave a `// TODO(phase-1-task-5): create a second platform for spineB` comment immediately above it. The dual-spine placement tool will be broken at runtime (it ignores spine B) until Task 5 fixes it; no existing automated test exercises this code path so the build-and-test is still green.

- [ ] **Step 6: Run `bun test` and confirm the suite is green.**

Run: `bun test`
Expected: all tests pass.

- [ ] **Step 7: Commit.**

```bash
git add \
    src/stations/track-aligned-platform-manager.ts \
    src/stations/track-aligned-platform-render-system.ts \
    src/stations/single-spine-placement-state-machine.ts \
    src/stations/dual-spine-placement-state-machine.ts \
    test/track-aligned-platform-manager.test.ts
git commit -m "refactor(stations): update track-aligned platform consumers to single-spine shape"
```

---

## Task 3: Legacy-data split migration helper

**Files:**

- Create: `src/stations/track-aligned-platform-migration.ts`
- Create: `test/track-aligned-platform-migration.test.ts`

This task introduces a pure, testable helper that converts one legacy dual-spine record into two new single-spine records, plus the mapping needed later for timetable rewriting. The output of this helper will be consumed by Task 4.

- [ ] **Step 1: Write the failing test file.**

Create `test/track-aligned-platform-migration.test.ts`:

```ts
import { describe, it, expect } from 'bun:test';
import type { Point } from '@ue-too/math';
import { splitLegacyDualSpinePlatform } from '../src/stations/track-aligned-platform-migration';
import type { LegacySerializedTrackAlignedPlatform } from '../src/stations/track-aligned-platform-types';

function makeLegacyDual(): LegacySerializedTrackAlignedPlatform {
    return {
        id: 7,
        stationId: 3,
        spineA: [{ trackSegment: 10, tStart: 0, tEnd: 1, side: 1 }],
        spineB: [{ trackSegment: 20, tStart: 0, tEnd: 1, side: -1 }],
        offset: 2,
        outerVertices: {
            kind: 'dual',
            capA: [{ x: 5, y: 5 }],
            capB: [{ x: 5, y: -5 }],
        },
        stopPositions: [
            { trackSegmentId: 10, direction: 'tangent', tValue: 0.5 },
            { trackSegmentId: 10, direction: 'reverseTangent', tValue: 0.5 },
            { trackSegmentId: 20, direction: 'tangent', tValue: 0.5 },
            { trackSegmentId: 20, direction: 'reverseTangent', tValue: 0.5 },
        ],
    };
}

describe('splitLegacyDualSpinePlatform', () => {
    it('splits a dual-spine record into two single-spine records', () => {
        const legacy = makeLegacyDual();
        const { faceA, faceB } = splitLegacyDualSpinePlatform(
            legacy,
            () => [{ x: 0, y: 0 }, { x: 10, y: 0 }] as Point[],
        );

        expect(faceA.stationId).toBe(3);
        expect(faceA.spine).toEqual(legacy.spineA);
        expect(faceB.spine).toEqual(legacy.spineB);
    });

    it('routes each stop position to the face whose spine contains the segment', () => {
        const legacy = makeLegacyDual();
        const { faceA, faceB } = splitLegacyDualSpinePlatform(
            legacy,
            () => [{ x: 0, y: 0 }, { x: 10, y: 0 }] as Point[],
        );

        expect(faceA.stopPositions.map((s) => s.trackSegmentId)).toEqual([10, 10]);
        expect(faceB.stopPositions.map((s) => s.trackSegmentId)).toEqual([20, 20]);
    });

    it('emits a migration mapping that traces each old stop index to its new face + index', () => {
        const legacy = makeLegacyDual();
        const { stopIndexMap } = splitLegacyDualSpinePlatform(
            legacy,
            () => [{ x: 0, y: 0 }, { x: 10, y: 0 }] as Point[],
        );

        expect(stopIndexMap).toEqual([
            { face: 'A', newIndex: 0 },
            { face: 'A', newIndex: 1 },
            { face: 'B', newIndex: 0 },
            { face: 'B', newIndex: 1 },
        ]);
    });

    it("uses the supplied getMidline to populate each face's outer vertices", () => {
        const legacy = makeLegacyDual();
        const midline: Point[] = [{ x: 1, y: 1 }, { x: 9, y: 1 }];
        const { faceA, faceB } = splitLegacyDualSpinePlatform(legacy, () => midline);
        expect(faceA.outerVertices).toEqual(midline);
        expect(faceB.outerVertices).toEqual(midline);
    });
});
```

- [ ] **Step 2: Run the test and confirm it fails.**

Run: `bun test test/track-aligned-platform-migration.test.ts`
Expected: FAIL because `src/stations/track-aligned-platform-migration.ts` does not exist yet.

- [ ] **Step 3: Implement the migration helper.**

Create `src/stations/track-aligned-platform-migration.ts`:

```ts
import type { Point } from '@ue-too/math';
import type { BCurve } from '@ue-too/curve';
import type { StopPosition } from './types';
import type {
    LegacySerializedTrackAlignedPlatform,
    SerializedSpineEntry,
    TrackAlignedPlatform,
} from './track-aligned-platform-types';
import { sampleSpineEdge } from './spine-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-stop entry in the migration mapping for one dual-spine platform. */
export type StopIndexMapEntry = { face: 'A' | 'B'; newIndex: number };

/**
 * Result of splitting a legacy dual-spine serialized platform into two new
 * single-spine platforms.
 *
 * `faceA` and `faceB` are ready to be inserted into the manager; they carry
 * the `id: number` slot as `-1` to be assigned by the caller when it mints
 * fresh IDs. `stopIndexMap[i]` describes where the legacy stop at position
 * `i` has landed.
 */
export type DualSpineSplitResult = {
    faceA: Omit<TrackAlignedPlatform, 'id'>;
    faceB: Omit<TrackAlignedPlatform, 'id'>;
    stopIndexMap: StopIndexMapEntry[];
};

/** Mapping from an old platform+stop-index to the new platform+stop-index. */
export type PlatformMigrationEntry = {
    newPlatformId: number;
    newStopIndex: number;
};

/** oldPlatformId -> oldStopIndex -> new location. */
export type PlatformMigrationMap = Map<number, Map<number, PlatformMigrationEntry>>;

// ---------------------------------------------------------------------------
// Split helper
// ---------------------------------------------------------------------------

/**
 * Compute the midline between two spines by sampling both offset edges and
 * averaging paired points.
 *
 * @param spineA - First spine entries.
 * @param spineB - Second spine entries.
 * @param offset - Lateral offset in world units.
 * @param getCurve - Curve lookup for each segment id.
 * @returns A polyline running between the two spine offset edges. The caller
 *   assigns this to each face's `outerVertices`.
 */
export function computeDualSpineMidline(
    spineA: SerializedSpineEntry[],
    spineB: SerializedSpineEntry[],
    offset: number,
    getCurve: (segmentId: number) => BCurve,
): Point[] {
    const edgeA = sampleSpineEdge(spineA, offset, getCurve);
    const edgeB = sampleSpineEdge(spineB, offset, getCurve);
    const n = Math.min(edgeA.length, edgeB.length);
    const midline: Point[] = [];
    for (let i = 0; i < n; i++) {
        midline.push({
            x: (edgeA[i].x + edgeB[i].x) / 2,
            y: (edgeA[i].y + edgeB[i].y) / 2,
        });
    }
    return midline;
}

/**
 * Split a legacy dual-spine serialized platform into two new single-spine
 * platform records.
 *
 * @param legacy - The legacy platform to split. Must have `spineB !== null`
 *   and `outerVertices.kind === 'dual'`.
 * @param getMidline - Callback that returns the midline polyline used as
 *   each face's `outerVertices`. Taking this as a parameter keeps the helper
 *   pure (no curve lookup dependency) and lets the scene loader supply real
 *   geometry while tests can inject a stub.
 */
export function splitLegacyDualSpinePlatform(
    legacy: LegacySerializedTrackAlignedPlatform,
    getMidline: () => Point[],
): DualSpineSplitResult {
    if (legacy.spineB === null) {
        throw new Error(`splitLegacyDualSpinePlatform: legacy.spineB is null for platform ${legacy.id}`);
    }

    const midline = getMidline();

    const spineASegmentIds = new Set(legacy.spineA.map((e) => e.trackSegment));
    const spineBSegmentIds = new Set(legacy.spineB.map((e) => e.trackSegment));

    const stopsA: StopPosition[] = [];
    const stopsB: StopPosition[] = [];
    const stopIndexMap: StopIndexMapEntry[] = new Array(legacy.stopPositions.length);

    for (let i = 0; i < legacy.stopPositions.length; i++) {
        const stop = legacy.stopPositions[i];
        const copy: StopPosition = { ...stop };
        if (spineASegmentIds.has(stop.trackSegmentId)) {
            stopIndexMap[i] = { face: 'A', newIndex: stopsA.length };
            stopsA.push(copy);
        } else if (spineBSegmentIds.has(stop.trackSegmentId)) {
            stopIndexMap[i] = { face: 'B', newIndex: stopsB.length };
            stopsB.push(copy);
        } else {
            // Stop references a segment on neither spine — drop it. The
            // corresponding map entry points to face A at `-1` so downstream
            // code can recognise "no longer reachable".
            stopIndexMap[i] = { face: 'A', newIndex: -1 };
        }
    }

    const faceA: Omit<TrackAlignedPlatform, 'id'> = {
        stationId: legacy.stationId,
        spine: legacy.spineA.map((e) => ({ ...e })),
        offset: legacy.offset,
        outerVertices: midline.map((v) => ({ x: v.x, y: v.y })),
        stopPositions: stopsA,
    };

    const faceB: Omit<TrackAlignedPlatform, 'id'> = {
        stationId: legacy.stationId,
        spine: legacy.spineB.map((e) => ({ ...e })),
        offset: legacy.offset,
        outerVertices: midline.map((v) => ({ x: v.x, y: v.y })),
        stopPositions: stopsB,
    };

    return { faceA, faceB, stopIndexMap };
}
```

- [ ] **Step 4: Run the test and confirm it passes.**

Run: `bun test test/track-aligned-platform-migration.test.ts`
Expected: PASS for all four cases.

- [ ] **Step 5: Commit.**

```bash
git add \
    src/stations/track-aligned-platform-migration.ts \
    test/track-aligned-platform-migration.test.ts
git commit -m "feat(stations): add legacy dual-spine → single-spine split helper"
```

---

## Task 4: Legacy-aware deserialization in `TrackAlignedPlatformManager`

**Files:**

- Modify: `src/stations/track-aligned-platform-manager.ts`
- Modify: `test/track-aligned-platform-manager.test.ts`

Extend `deserialize` to accept both new and legacy serialized formats, applying the split helper for legacy dual-spine records. It returns the migration map alongside the manager so callers can rewrite timetable references. This task isolates the deserialization change from the scene-level orchestration (that lives in Task 6).

- [ ] **Step 1: Write the failing tests.**

In `test/track-aligned-platform-manager.test.ts`, add a new `describe` block after the existing `describe('serialization edge cases', ...)` block:

```ts
// -----------------------------------------------------------------------
// 10. Legacy dual-spine migration
// -----------------------------------------------------------------------

describe('legacy dual-spine migration', () => {
    it('splits a legacy dual-spine platform into two single-spine platforms', () => {
        const legacyData = {
            platforms: [
                {
                    id: 5,
                    stationId: 1,
                    spineA: [{ trackSegment: 10, tStart: 0, tEnd: 1, side: 1 as const }],
                    spineB: [{ trackSegment: 20, tStart: 0, tEnd: 1, side: -1 as const }],
                    offset: 2,
                    outerVertices: {
                        kind: 'dual' as const,
                        capA: [{ x: 0, y: 5 }],
                        capB: [{ x: 10, y: 5 }],
                    },
                    stopPositions: [
                        { trackSegmentId: 10, direction: 'tangent' as const, tValue: 0.5 },
                        { trackSegmentId: 20, direction: 'tangent' as const, tValue: 0.5 },
                    ],
                },
            ],
        };
        const { manager, migrationMap } = TrackAlignedPlatformManager.deserializeAny(
            legacyData,
            () => [{ x: 5, y: 0 }, { x: 5, y: 2.5 }],
        );

        const all = manager.getAllPlatforms();
        expect(all).toHaveLength(2);
        expect(all.map((p) => p.platform.spine[0].trackSegment).sort()).toEqual([10, 20]);

        // Migration map records where each legacy index ended up.
        const entries = migrationMap.get(5);
        expect(entries).toBeDefined();
        expect(entries!.size).toBe(2);
    });

    it('reads the new format unchanged (empty migration map)', () => {
        const newData = {
            platforms: [
                {
                    id: 3,
                    stationId: 1,
                    spine: [{ trackSegment: 10, tStart: 0, tEnd: 1, side: 1 as const }],
                    offset: 2,
                    outerVertices: [{ x: 0, y: 5 }, { x: 10, y: 5 }],
                    stopPositions: [
                        { trackSegmentId: 10, direction: 'tangent' as const, tValue: 0.5 },
                    ],
                },
            ],
        };
        const { manager, migrationMap } = TrackAlignedPlatformManager.deserializeAny(
            newData,
            () => [],
        );
        expect(manager.getAllPlatforms()).toHaveLength(1);
        expect(migrationMap.size).toBe(0);
    });
});
```

- [ ] **Step 2: Run the tests and confirm they fail.**

Run: `bun test test/track-aligned-platform-manager.test.ts`
Expected: FAIL — `TrackAlignedPlatformManager.deserializeAny` does not exist.

- [ ] **Step 3: Implement `deserializeAny`.**

Edit `src/stations/track-aligned-platform-manager.ts`. Add these imports at the top:

```ts
import type {
    AnySerializedTrackAlignedPlatformData,
    LegacySerializedTrackAlignedPlatform,
} from './track-aligned-platform-types';
import { isLegacySerializedPlatform } from './track-aligned-platform-types';
import {
    computeDualSpineMidline,
    splitLegacyDualSpinePlatform,
    type PlatformMigrationMap,
} from './track-aligned-platform-migration';
import type { BCurve } from '@ue-too/curve';
```

Add the following static method to the class. Place it directly after the existing `deserialize` method:

```ts
/**
 * Deserialize a serialized platforms payload that may contain legacy
 * dual-spine entries.  Dual-spine platforms are split into two single-spine
 * platforms and `migrationMap` records where each legacy stop-position
 * index landed, so the caller can rewrite timetable references.
 *
 * For new-format payloads, the migration map is empty and platform IDs are
 * preserved unchanged.
 *
 * @param data - Serialized payload in legacy or new format.
 * @param getCurve - Curve lookup used to compute midlines for split faces.
 */
static deserializeAny(
    data: AnySerializedTrackAlignedPlatformData,
    getCurve: (segmentId: number) => BCurve,
): { manager: TrackAlignedPlatformManager; migrationMap: PlatformMigrationMap } {
    const migrationMap: PlatformMigrationMap = new Map();

    // Pre-compute the maximum id so assigned new ids do not collide with
    // existing ones.
    let maxId = data.platforms.reduce((max, p) => Math.max(max, p.id), -1);
    const manager = new TrackAlignedPlatformManager(Math.max(maxId + 1, 10));

    const nextId = () => ++maxId;

    for (const p of data.platforms) {
        if (!isLegacySerializedPlatform(p)) {
            // Already new format.
            manager._manager.createEntityWithId(p.id, {
                id: p.id,
                stationId: p.stationId,
                spine: p.spine.map((e) => ({ ...e })),
                offset: p.offset,
                outerVertices: p.outerVertices.map((v) => ({ x: v.x, y: v.y })),
                stopPositions: p.stopPositions.map((sp) => ({ ...sp })),
            });
            continue;
        }

        // Legacy path.
        if (p.spineB === null) {
            // Legacy single-spine: flatten outerVertices and keep the id.
            const verts =
                p.outerVertices.kind === 'single'
                    ? p.outerVertices.vertices.map((v) => ({ x: v.x, y: v.y }))
                    : [];
            manager._manager.createEntityWithId(p.id, {
                id: p.id,
                stationId: p.stationId,
                spine: p.spineA.map((e) => ({ ...e })),
                offset: p.offset,
                outerVertices: verts,
                stopPositions: p.stopPositions.map((sp) => ({ ...sp })),
            });
            continue;
        }

        // Legacy dual-spine: split into two platforms.
        const { faceA, faceB, stopIndexMap } = splitLegacyDualSpinePlatform(
            p,
            () => computeDualSpineMidline(p.spineA, p.spineB!, p.offset, getCurve),
        );
        const idA = nextId();
        const idB = nextId();
        manager._manager.createEntityWithId(idA, { ...faceA, id: idA });
        manager._manager.createEntityWithId(idB, { ...faceB, id: idB });

        const entries = new Map<number, { newPlatformId: number; newStopIndex: number }>();
        for (let i = 0; i < stopIndexMap.length; i++) {
            const mapEntry = stopIndexMap[i];
            entries.set(i, {
                newPlatformId: mapEntry.face === 'A' ? idA : idB,
                newStopIndex: mapEntry.newIndex,
            });
        }
        migrationMap.set(p.id, entries);
    }

    return { manager, migrationMap };
}
```

- [ ] **Step 4: Run the tests and confirm they pass.**

Run: `bun test test/track-aligned-platform-manager.test.ts`
Expected: PASS for all tests, including the two new cases.

- [ ] **Step 5: Commit.**

```bash
git add \
    src/stations/track-aligned-platform-manager.ts \
    test/track-aligned-platform-manager.test.ts
git commit -m "feat(stations): accept legacy dual-spine payloads via deserializeAny"
```

---

## Task 5: Dual-spine placement tool creates two single-spine platforms

**Files:**

- Modify: `src/stations/dual-spine-placement-state-machine.ts`

Replace the temporary single-platform commit (placed in Task 2 Step 5) with the real two-platform commit. Both platforms share a midline computed from the two spine offset edges.

- [ ] **Step 1: Write a failing integration-style test that drives the state machine through placement.**

There are currently no tests for this placement state machine. Adding one is out of scope for this task — it depends on a lot of Pixi and CurveEngine plumbing. Skip the red-step and rely on Task 7 (scene-load integration test) to verify behaviour end-to-end via a serialized scene.

- [ ] **Step 2: Update `finalize()` to create two platforms.**

In `src/stations/dual-spine-placement-state-machine.ts`, add an import near the existing imports:

```ts
import { computeDualSpineMidline } from './track-aligned-platform-migration';
```

Replace the temporary single-platform block (the one marked `TODO(phase-1-task-5)`) and the remainder of `finalize()` down to the `notifyChange()` call with the following, which creates two platforms and repositions the station to the first spine's midpoint (preserving the existing behaviour):

```ts
const midline = computeDualSpineMidline(
    this._spineA,
    this._spineB,
    this._spineAOffset,
    getCurve,
);

const platformIdA = this._platformManager.createPlatform({
    stationId: this._activeStationId,
    spine: [...this._spineA],
    offset: this._spineAOffset,
    outerVertices: [...midline],
    stopPositions: computeStopPositions(this._spineA, getCurve),
});
station.trackAlignedPlatforms.push(platformIdA);

const platformIdB = this._platformManager.createPlatform({
    stationId: this._activeStationId,
    spine: [...this._spineB],
    offset: this._spineAOffset,
    outerVertices: [...midline],
    stopPositions: computeStopPositions(this._spineB, getCurve),
});
station.trackAlignedPlatforms.push(platformIdB);

// When the first platform is added, reposition the station to the
// spine A midpoint so the station label sits on the platform.
if (
    station.trackAlignedPlatforms.length === 2 &&
    station.platforms.length === 0
) {
    const stops = computeStopPositions(this._spineA, getCurve);
    if (stops.length > 0) {
        const curve = getCurve(stops[0].trackSegmentId);
        station.position = curve.get(stops[0].tValue);
    }
}

const elevation = station.elevation;
this._platformRenderSystem.addPlatform(platformIdA, elevation);
this._platformRenderSystem.addPlatform(platformIdB, elevation);

// Notify after the station's trackAlignedPlatforms array is updated
// so subscribers (e.g. debug overlay) see the new platforms.
this._platformManager.notifyChange();
```

(The block after this — `hidePreview`, `_onHint`, `_resetState` — remains untouched.)

- [ ] **Step 3: Run the full test suite to check for regressions.**

Run: `bun test`
Expected: all tests pass.

- [ ] **Step 4: Run the build to verify typecheck passes end-to-end.**

Run: `bun run build`
Expected: build succeeds.

- [ ] **Step 5: Commit.**

```bash
git add src/stations/dual-spine-placement-state-machine.ts
git commit -m "feat(stations): dual-spine placement creates two single-spine platforms"
```

---

## Task 6: Thread platform migration map through scene loading

**Files:**

- Modify: `src/timetable/shift-template-manager.ts`
- Modify: `src/scene-serialization.ts`

Wire the platform migration map returned from `deserializeAny` into the scene loader so that `SerializedScheduledStop` entries pointing at a legacy dual-spine platform get rewritten before `TimetableManager.deserialize` runs.

- [ ] **Step 1: Write a failing test for the timetable remap method.**

Create `test/shift-template-manager-remap.test.ts`:

```ts
import { describe, it, expect } from 'bun:test';
import { ShiftTemplateManager } from '../src/timetable/shift-template-manager';
import { DayOfWeek, type ShiftTemplate } from '../src/timetable/types';
import type { PlatformMigrationMap } from '../src/stations/track-aligned-platform-migration';

function makeTemplate(
    stationId: number,
    platformId: number,
    stopPositionIndex: number,
): ShiftTemplate {
    return {
        id: 'shift-1',
        name: 'Test',
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
                platformKind: 'trackAligned',
                platformId,
                stopPositionIndex,
                arrivalTime: null,
                departureTime: 100,
            },
            {
                stationId,
                platformKind: 'trackAligned',
                platformId,
                stopPositionIndex,
                arrivalTime: 200,
                departureTime: null,
            },
        ],
        legs: [{ routeId: 'r1' }],
    };
}

describe('ShiftTemplateManager.remapTrackAlignedPlatformReferences', () => {
    it('rewrites platformId and stopPositionIndex according to the migration map', () => {
        const mgr = new ShiftTemplateManager();
        mgr.addTemplate(makeTemplate(1, 5, 2));

        const map: PlatformMigrationMap = new Map([
            [
                5,
                new Map([
                    [2, { newPlatformId: 11, newStopIndex: 0 }],
                ]),
            ],
        ]);
        mgr.remapTrackAlignedPlatformReferences(map);

        const t = mgr.getTemplate('shift-1')!;
        expect(t.stops[0].platformId).toBe(11);
        expect(t.stops[0].stopPositionIndex).toBe(0);
        expect(t.stops[1].platformId).toBe(11);
        expect(t.stops[1].stopPositionIndex).toBe(0);
    });

    it('leaves island-platform stops unchanged', () => {
        const mgr = new ShiftTemplateManager();
        const template = makeTemplate(1, 5, 2);
        template.stops[0].platformKind = 'island';
        mgr.addTemplate(template);

        const map: PlatformMigrationMap = new Map([
            [5, new Map([[2, { newPlatformId: 11, newStopIndex: 0 }]])],
        ]);
        mgr.remapTrackAlignedPlatformReferences(map);

        const t = mgr.getTemplate('shift-1')!;
        expect(t.stops[0].platformId).toBe(5);
        expect(t.stops[0].stopPositionIndex).toBe(2);
    });

    it('leaves unrelated track-aligned stops unchanged', () => {
        const mgr = new ShiftTemplateManager();
        mgr.addTemplate(makeTemplate(1, 99, 0));

        const map: PlatformMigrationMap = new Map([
            [5, new Map([[2, { newPlatformId: 11, newStopIndex: 0 }]])],
        ]);
        mgr.remapTrackAlignedPlatformReferences(map);

        const t = mgr.getTemplate('shift-1')!;
        expect(t.stops[0].platformId).toBe(99);
        expect(t.stops[0].stopPositionIndex).toBe(0);
    });
});
```

- [ ] **Step 2: Run the test and confirm it fails.**

Run: `bun test test/shift-template-manager-remap.test.ts`
Expected: FAIL because `remapTrackAlignedPlatformReferences` does not exist.

- [ ] **Step 3: Implement `remapTrackAlignedPlatformReferences` on `ShiftTemplateManager`.**

In `src/timetable/shift-template-manager.ts`, add this import:

```ts
import type { PlatformMigrationMap } from '@/stations/track-aligned-platform-migration';
```

Add this method to the class (place it before the `Serialization` section):

```ts
/**
 * Rewrite `stopPositionIndex` and `platformId` on every `ScheduledStop`
 * that refers to a track-aligned platform listed in `map`.
 *
 * Intended for one-off migrations on scene load; does not emit change
 * events because the templates have not yet been observed by the UI.
 */
remapTrackAlignedPlatformReferences(map: PlatformMigrationMap): void {
    if (map.size === 0) return;
    for (const template of this._templates.values()) {
        for (const stop of template.stops) {
            if (stop.platformKind !== 'trackAligned') continue;
            const entries = map.get(stop.platformId);
            if (entries === undefined) continue;
            const target = entries.get(stop.stopPositionIndex);
            if (target === undefined) continue;
            stop.platformId = target.newPlatformId;
            stop.stopPositionIndex = target.newStopIndex;
        }
    }
}
```

- [ ] **Step 4: Run the test and confirm it passes.**

Run: `bun test test/shift-template-manager-remap.test.ts`
Expected: PASS for all three cases.

- [ ] **Step 5: Update `scene-serialization.ts` to use `deserializeAny` and apply the migration map.**

In `src/scene-serialization.ts`, `deserializeSceneData` currently deserializes in this order: tracks → trains → terrain → **timetable (line 88)** → time → signals → **stations (line 117)** → **track-aligned platforms (line 131)** → joint direction preferences. The migration map is produced when track-aligned platforms deserialize, so the timetable block must move down to run AFTER platforms.

**Delete** the existing `if (data.timetable) { ... }` block at line 88 and the existing `if (data.trackAlignedPlatforms) { ... }` block at line 131. Then immediately after the `if (data.stations) { ... }` block (which ends around line 128), **insert** the following consolidated replacement:

```ts
// Load track-aligned platforms (split any legacy dual-spine) before the
// timetable so shift-template references can be rewritten using the
// migration map.
let platformMigrationMap: PlatformMigrationMap = new Map();
if (data.trackAlignedPlatforms) {
    const { manager: restored, migrationMap } =
        TrackAlignedPlatformManager.deserializeAny(
            data.trackAlignedPlatforms,
            (segmentId) => {
                const curve = app.curveEngine.trackGraph.getTrackSegmentCurve(segmentId);
                if (curve === null) throw new Error(`Missing curve for segment ${segmentId}`);
                return curve;
            },
        );
    platformMigrationMap = migrationMap;

    for (const { id } of app.trackAlignedPlatformManager.getAllPlatforms()) {
        app.trackAlignedPlatformRenderSystem.removePlatform(id);
        app.trackAlignedPlatformManager.destroyPlatform(id);
    }
    for (const { id, platform } of restored.getAllPlatforms()) {
        app.trackAlignedPlatformManager.createPlatformWithId(id, platform);
        const elevation =
            app.stationManager.getStation(platform.stationId)?.elevation ?? 0;
        app.trackAlignedPlatformRenderSystem.addPlatform(id, elevation);
    }

    // Any station that used to list only dual-spine platforms now needs
    // its trackAlignedPlatforms array to reflect the split entries. The
    // restored StationManager already holds that list, so no extra work
    // is needed here — the station block above wrote the correct ids.
}

// Load timetable data if present (after platforms so migration map is known).
if (data.timetable) {
    app.timetableManager.dispose();
    const restored = TimetableManager.deserialize(
        data.timetable,
        app.curveEngine.trackGraph,
        app.trainManager,
        app.stationManager,
        app.signalStateEngine,
    );
    // Rewrite any ScheduledStop entries that referenced a legacy dual-spine
    // platform.
    restored.shiftTemplateManager.remapTrackAlignedPlatformReferences(
        platformMigrationMap,
    );
    (app as { timetableManager: TimetableManager }).timetableManager = restored;
    app.timetableRef.current = restored;
}
```

Also add the required import at the top of the file:

```ts
import type { PlatformMigrationMap } from '@/stations/track-aligned-platform-migration';
```

(`TimetableManager.shiftTemplateManager` is a public getter in `src/timetable/timetable-manager.ts:126`, so no additional plumbing is needed.)

- [ ] **Step 6: Run `bun test` to verify everything still passes.**

Run: `bun test`
Expected: all tests pass.

- [ ] **Step 7: Run `bun run build` to verify the TypeScript build.**

Run: `bun run build`
Expected: build succeeds.

- [ ] **Step 8: Commit.**

```bash
git add \
    src/timetable/shift-template-manager.ts \
    src/scene-serialization.ts \
    test/shift-template-manager-remap.test.ts
git commit -m "feat(stations): apply platform migration map to timetable on load"
```

---

## Closing checklist

After completing the tasks above, verify:

- [ ] `bun test` — full suite passes.
- [ ] `bun run build` — production build succeeds.
- [ ] `bun run dev` (manual) — place a dual-spine platform via the UI; confirm the station list shows two track-aligned platform ids, the debug overlay draws stop-position labels for both, and the new timetable dropdown shows both faces as independent entries.
- [ ] Load a pre-existing saved scene that contains a dual-spine platform; confirm it opens without console errors, shows two platforms in the station list, and any existing shift that referenced the old platform still resolves (drive a train through the assignment to verify stopping still works).
