# Station Presence Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `StationPresenceDetector` that continuously tracks which trains are near a station's stop position, fires arrive/depart events, and exposes a query API for both UI indicators and logic consumers.

**Architecture:** A segment-indexed spatial index maps each track segment to the stop positions on it (from both island and track-aligned platforms). Each frame, after trains update, the detector checks each train's head position against the stop index using arc-length proximity. A `Map<trainId, StationPresence>` is diffed frame-to-frame to emit arrive/depart events via an observable. The stop index is rebuilt when platforms change (via manager change callbacks). The detector plugs into `TrainRenderSystem.update()` alongside the existing `OccupancyRegistry` and `ProximityDetector`.

**Tech Stack:** TypeScript, Bun test runner (`bun test`), Vite.

---

## Context every task depends on

- **`OccupancyRegistry`** (`src/trains/occupancy-registry.ts`): rebuilt each frame in `TrainRenderSystem.update()` (line 422). Maps segments → train IDs and trains → occupied segments. The new detector runs AFTER occupancy is updated — it uses `occupancyRegistry.getTrainsOnSegment()` as a broad-phase filter to avoid iterating all trains × all stops.
- **`TrainRenderSystem.update()`** (`src/trains/train-render-system.ts:414-436`): the per-frame tick. Currently calls `occupancyRegistry.updateFromTrains(placed)`, then `proximityDetector.update(...)`, then `collisionGuard.update(...)`. The new detector slots in after the occupancy update.
- **Platform managers**: `StationManager.getStations()` returns island platforms (each with `stopPositions` on a single `track` segment). `TrackAlignedPlatformManager.getAllPlatforms()` returns track-aligned platforms (each with `stopPositions` referencing segments in the `spine`).
- **`Train.position`** (`src/trains/formation.ts`): `{ trackSegment, tValue, direction } | null`. The head position of the train.
- **`Train.speed`**: `number`. The train's current speed.
- **`TrackGraph.getTrackSegmentCurve(segmentId)`**: returns a `BCurve` with `lengthAtT(t): number` (arc length from t=0 to t) and `fullLength: number`. Used to compute world-space distance between two t-values on the same segment.
- **`Observable` / `SynchronousObservable`** from `@ue-too/board`: the event system used throughout the codebase. `observable.subscribe(listener)` returns an unsubscribe function.

## File structure

**New files:**

- `src/trains/station-presence-detector.ts` — the `StationPresenceDetector` class: stop index, per-frame update, queries, arrive/depart observable.
- `test/station-presence-detector.test.ts` — unit tests.

**Modified files:**

- `src/trains/train-render-system.ts` — instantiate the detector; call `detector.update(...)` each frame after the occupancy update; expose a public getter.
- `src/utils/init-app.ts` — wire the detector's rebuild trigger to manager change callbacks (so the stop index updates when platforms are added/removed).

---

## Task 1: Stop index types + builder + proximity check

**Files:**

- Create: `src/trains/station-presence-detector.ts` (partial — types + index builder + proximity helper)
- Create: `test/station-presence-detector.test.ts`

The stop index is a `Map<segmentId, StopIndexEntry[]>` pre-built from all platforms. Each entry points to a specific stop position and the station it belongs to. The proximity check tests whether a train's head position on a segment is within a world-space arc-length threshold of any indexed stop on that same segment.

- [ ] **Step 1: Write the failing tests.**

Create `test/station-presence-detector.test.ts`:

```ts
import { describe, it, expect } from 'bun:test';
import {
    buildStopIndex,
    findNearestStop,
    type StopIndexEntry,
    type StationPresence,
} from '../src/trains/station-presence-detector';
import type { StationManager } from '../src/stations/station-manager';
import type { TrackAlignedPlatformManager } from '../src/stations/track-aligned-platform-manager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStationManager(
    stations: {
        id: number;
        platforms: { id: number; track: number; stopPositions: { id: number; trackSegmentId: number; tValue: number; direction: 'tangent' | 'reverseTangent' }[] }[];
        trackAlignedPlatforms: number[];
    }[],
): StationManager {
    return {
        getStations: () =>
            stations.map((s) => ({
                id: s.id,
                station: {
                    id: s.id,
                    platforms: s.platforms,
                    trackAlignedPlatforms: s.trackAlignedPlatforms,
                },
            })),
    } as unknown as StationManager;
}

function makeTapManager(
    platforms: {
        id: number;
        stationId: number;
        spine: { trackSegment: number }[];
        stopPositions: { id: number; trackSegmentId: number; tValue: number; direction: 'tangent' | 'reverseTangent' }[];
    }[],
): TrackAlignedPlatformManager {
    return {
        getAllPlatforms: () =>
            platforms.map((p) => ({ id: p.id, platform: p })),
    } as unknown as TrackAlignedPlatformManager;
}

/** Stub curve: linear, arc length = fullLength * t. */
function makeCurve(fullLength: number) {
    return {
        fullLength,
        lengthAtT: (t: number) => fullLength * t,
    };
}

function makeGetCurve(map: Record<number, number>) {
    return (segmentId: number) => makeCurve(map[segmentId] ?? 100);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildStopIndex', () => {
    it('indexes island-platform stop positions by segment', () => {
        const sm = makeStationManager([
            {
                id: 1,
                platforms: [
                    {
                        id: 0,
                        track: 10,
                        stopPositions: [
                            { id: 0, trackSegmentId: 10, tValue: 0.5, direction: 'tangent' },
                        ],
                    },
                ],
                trackAlignedPlatforms: [],
            },
        ]);
        const tapMgr = makeTapManager([]);

        const index = buildStopIndex(sm, tapMgr);
        expect(index.get(10)).toHaveLength(1);
        expect(index.get(10)![0].stationId).toBe(1);
        expect(index.get(10)![0].platformKind).toBe('island');
    });

    it('indexes track-aligned platform stop positions by segment', () => {
        const sm = makeStationManager([
            { id: 1, platforms: [], trackAlignedPlatforms: [5] },
        ]);
        const tapMgr = makeTapManager([
            {
                id: 5,
                stationId: 1,
                spine: [{ trackSegment: 20 }],
                stopPositions: [
                    { id: 0, trackSegmentId: 20, tValue: 0.5, direction: 'tangent' },
                    { id: 1, trackSegmentId: 20, tValue: 0.5, direction: 'reverseTangent' },
                ],
            },
        ]);

        const index = buildStopIndex(sm, tapMgr);
        expect(index.get(20)).toHaveLength(2);
        expect(index.get(20)![0].platformKind).toBe('trackAligned');
    });

    it('returns empty map when no platforms exist', () => {
        const sm = makeStationManager([]);
        const tapMgr = makeTapManager([]);
        const index = buildStopIndex(sm, tapMgr);
        expect(index.size).toBe(0);
    });
});

describe('findNearestStop', () => {
    it('returns the nearest stop within threshold', () => {
        const entries: StopIndexEntry[] = [
            {
                stationId: 1,
                platformId: 0,
                platformKind: 'island',
                stopPositionId: 0,
                tValue: 0.5,
                direction: 'tangent',
            },
        ];
        const getCurve = makeGetCurve({ 10: 100 });
        // Train at tValue=0.52, stop at 0.5, distance = 2 world units (100 * 0.02).
        const result = findNearestStop(entries, 0.52, 10, getCurve, 5);
        expect(result).not.toBeNull();
        expect(result!.stopPositionId).toBe(0);
    });

    it('returns null when no stop is within threshold', () => {
        const entries: StopIndexEntry[] = [
            {
                stationId: 1,
                platformId: 0,
                platformKind: 'island',
                stopPositionId: 0,
                tValue: 0.5,
                direction: 'tangent',
            },
        ];
        const getCurve = makeGetCurve({ 10: 100 });
        // Train at tValue=0.9, distance = 40 world units. Threshold = 5.
        const result = findNearestStop(entries, 0.9, 10, getCurve, 5);
        expect(result).toBeNull();
    });

    it('picks the closer stop when multiple are within threshold', () => {
        const entries: StopIndexEntry[] = [
            {
                stationId: 1,
                platformId: 0,
                platformKind: 'island',
                stopPositionId: 0,
                tValue: 0.4,
                direction: 'tangent',
            },
            {
                stationId: 1,
                platformId: 0,
                platformKind: 'island',
                stopPositionId: 1,
                tValue: 0.52,
                direction: 'reverseTangent',
            },
        ];
        const getCurve = makeGetCurve({ 10: 100 });
        // Train at 0.5. Stop 0 at 0.4 (dist=10), Stop 1 at 0.52 (dist=2). Threshold=15.
        const result = findNearestStop(entries, 0.5, 10, getCurve, 15);
        expect(result).not.toBeNull();
        expect(result!.stopPositionId).toBe(1);
    });
});
```

- [ ] **Step 2: Run tests and confirm they fail.**

Run: `bun test test/station-presence-detector.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the types, stop index builder, and proximity helper.**

Create `src/trains/station-presence-detector.ts`:

```ts
import { Observable, SynchronousObservable } from '@ue-too/board';
import type { StationManager } from '@/stations/station-manager';
import type { TrackAlignedPlatformManager } from '@/stations/track-aligned-platform-manager';
import type { TrackGraph } from './tracks/track';
import type { PlacedTrainEntry } from './train-manager';
import type { OccupancyRegistry } from './occupancy-registry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single indexed stop-position entry, pre-built from platform data. */
export type StopIndexEntry = {
    stationId: number;
    platformId: number;
    platformKind: 'island' | 'trackAligned';
    stopPositionId: number;
    tValue: number;
    direction: 'tangent' | 'reverseTangent';
};

/** Which station/platform/stop a train is currently near. */
export type StationPresence = {
    stationId: number;
    platformId: number;
    platformKind: 'island' | 'trackAligned';
    stopPositionId: number;
};

export type StationPresenceEvent =
    | { type: 'arrived'; trainId: number; presence: StationPresence }
    | { type: 'departed'; trainId: number; previousPresence: StationPresence };

// ---------------------------------------------------------------------------
// Stop index builder
// ---------------------------------------------------------------------------

/**
 * Build a segment-keyed spatial index of all stop positions across all
 * platforms (both island and track-aligned).
 *
 * Rebuilt when platforms are added/removed/modified.
 */
export function buildStopIndex(
    stationManager: StationManager,
    trackAlignedPlatformManager: TrackAlignedPlatformManager,
): Map<number, StopIndexEntry[]> {
    const index = new Map<number, StopIndexEntry[]>();

    function addEntry(segmentId: number, entry: StopIndexEntry): void {
        let list = index.get(segmentId);
        if (!list) {
            list = [];
            index.set(segmentId, list);
        }
        list.push(entry);
    }

    // Island platforms
    for (const { id: stationId, station } of stationManager.getStations()) {
        for (const platform of station.platforms) {
            for (const stop of platform.stopPositions) {
                addEntry(stop.trackSegmentId, {
                    stationId,
                    platformId: platform.id,
                    platformKind: 'island',
                    stopPositionId: stop.id,
                    tValue: stop.tValue,
                    direction: stop.direction,
                });
            }
        }
    }

    // Track-aligned platforms
    for (const { platform } of trackAlignedPlatformManager.getAllPlatforms()) {
        for (const stop of platform.stopPositions) {
            addEntry(stop.trackSegmentId, {
                stationId: platform.stationId,
                platformId: platform.id,
                platformKind: 'trackAligned',
                stopPositionId: stop.id,
                tValue: stop.tValue,
                direction: stop.direction,
            });
        }
    }

    return index;
}

// ---------------------------------------------------------------------------
// Proximity check
// ---------------------------------------------------------------------------

type CurveLike = { fullLength: number; lengthAtT: (t: number) => number };

/**
 * Find the nearest stop position to a train's head on a given segment.
 *
 * @param entries - Stop index entries for this segment.
 * @param trainT - The train's t-value on the segment.
 * @param segmentId - The segment id (for curve lookup).
 * @param getCurve - Returns the curve for a segment.
 * @param threshold - Maximum arc-length distance (world units) to consider "at" a stop.
 * @returns The matching `StationPresence`, or `null` if nothing is close enough.
 */
export function findNearestStop(
    entries: readonly StopIndexEntry[],
    trainT: number,
    segmentId: number,
    getCurve: (segmentId: number) => CurveLike,
    threshold: number,
): StationPresence | null {
    const curve = getCurve(segmentId);
    const trainArc = curve.lengthAtT(trainT);

    let best: StationPresence | null = null;
    let bestDist = Infinity;

    for (const entry of entries) {
        const stopArc = curve.lengthAtT(entry.tValue);
        const dist = Math.abs(trainArc - stopArc);
        if (dist <= threshold && dist < bestDist) {
            bestDist = dist;
            best = {
                stationId: entry.stationId,
                platformId: entry.platformId,
                platformKind: entry.platformKind,
                stopPositionId: entry.stopPositionId,
            };
        }
    }

    return best;
}

// ---------------------------------------------------------------------------
// Detector class
// ---------------------------------------------------------------------------

/** Default proximity threshold in world units (meters). */
const DEFAULT_THRESHOLD = 5;

/**
 * Continuously tracks which trains are near a station stop position.
 *
 * Call `update()` each frame after trains have moved and the occupancy
 * registry has been rebuilt. Subscribe to the observable for arrive/depart
 * events; use `getPresenceForTrain()` for point-in-time queries.
 */
export class StationPresenceDetector {
    private _stopIndex: Map<number, StopIndexEntry[]> = new Map();
    private _presence: Map<number, StationPresence> = new Map();
    private _observable: Observable<[StationPresenceEvent]> =
        new SynchronousObservable<[StationPresenceEvent]>();
    private _threshold: number;

    private _stationManager: StationManager;
    private _trackAlignedPlatformManager: TrackAlignedPlatformManager;
    private _trackGraph: TrackGraph;

    constructor(
        stationManager: StationManager,
        trackAlignedPlatformManager: TrackAlignedPlatformManager,
        trackGraph: TrackGraph,
        threshold: number = DEFAULT_THRESHOLD,
    ) {
        this._stationManager = stationManager;
        this._trackAlignedPlatformManager = trackAlignedPlatformManager;
        this._trackGraph = trackGraph;
        this._threshold = threshold;
        this.rebuildIndex();
    }

    /** Rebuild the segment → stop-position spatial index. */
    rebuildIndex(): void {
        this._stopIndex = buildStopIndex(
            this._stationManager,
            this._trackAlignedPlatformManager,
        );
    }

    /**
     * Per-frame update. Checks each train's head position against the stop
     * index, updates the presence map, and fires arrive/depart events.
     */
    update(
        trains: readonly PlacedTrainEntry[],
        occupancyRegistry: OccupancyRegistry,
    ): void {
        const getCurve = (segmentId: number) => {
            const curve = this._trackGraph.getTrackSegmentCurve(segmentId);
            if (curve === null) {
                return { fullLength: 0, lengthAtT: () => 0 };
            }
            return curve;
        };

        // Track which trains are still present this frame.
        const seen = new Set<number>();

        for (const { id, train } of trains) {
            const pos = train.position;
            if (pos === null) continue;

            const entries = this._stopIndex.get(pos.trackSegment);
            if (!entries || entries.length === 0) continue;

            const match = findNearestStop(
                entries,
                pos.tValue,
                pos.trackSegment,
                getCurve,
                this._threshold,
            );

            if (match) {
                seen.add(id);
                const prev = this._presence.get(id);
                if (!prev) {
                    // Arrived.
                    this._presence.set(id, match);
                    this._observable.notify({
                        type: 'arrived',
                        trainId: id,
                        presence: match,
                    });
                } else if (
                    prev.stationId !== match.stationId ||
                    prev.platformId !== match.platformId ||
                    prev.stopPositionId !== match.stopPositionId
                ) {
                    // Moved to a different stop — depart old, arrive new.
                    this._observable.notify({
                        type: 'departed',
                        trainId: id,
                        previousPresence: prev,
                    });
                    this._presence.set(id, match);
                    this._observable.notify({
                        type: 'arrived',
                        trainId: id,
                        presence: match,
                    });
                }
                // else: same stop, no event.
            }
        }

        // Departed trains: in the old presence map but not seen this frame.
        for (const [trainId, presence] of this._presence) {
            if (!seen.has(trainId)) {
                this._presence.delete(trainId);
                this._observable.notify({
                    type: 'departed',
                    trainId,
                    previousPresence: presence,
                });
            }
        }
    }

    // -----------------------------------------------------------------------
    // Queries
    // -----------------------------------------------------------------------

    /** Which station/platform/stop is this train near, if any? */
    getPresenceForTrain(trainId: number): StationPresence | null {
        return this._presence.get(trainId) ?? null;
    }

    /** Which train IDs are currently at a given station? */
    getTrainsAtStation(stationId: number): number[] {
        const result: number[] = [];
        for (const [trainId, presence] of this._presence) {
            if (presence.stationId === stationId) {
                result.push(trainId);
            }
        }
        return result;
    }

    /** Subscribe to arrive/depart events. Returns an unsubscribe function. */
    subscribe(listener: (event: StationPresenceEvent) => void): () => void {
        return this._observable.subscribe(listener);
    }
}
```

- [ ] **Step 4: Run the tests and confirm they pass.**

Run: `bun test test/station-presence-detector.test.ts`
Expected: PASS (6 cases — 3 for `buildStopIndex`, 3 for `findNearestStop`).

- [ ] **Step 5: Run full suite and build.**

Run: `bun test && bun run build`
Expected: all green.

- [ ] **Step 6: Commit.**

```bash
git add src/trains/station-presence-detector.ts test/station-presence-detector.test.ts
git commit -m "feat(trains): add station presence detector with stop index and proximity check"
```

---

## Task 2: StationPresenceDetector update + event tests

**Files:**

- Modify: `test/station-presence-detector.test.ts`

Add tests for the `StationPresenceDetector` class's `update()` method, the arrive/depart events, and the query methods.

- [ ] **Step 1: Add detector-level tests.**

Append to `test/station-presence-detector.test.ts`:

```ts
import { StationPresenceDetector, type StationPresenceEvent } from '../src/trains/station-presence-detector';
import type { TrackGraph } from '../src/trains/tracks/track';
import type { OccupancyRegistry } from '../src/trains/occupancy-registry';
import type { PlacedTrainEntry } from '../src/trains/train-manager';
import type { Train } from '../src/trains/formation';

function makeTrackGraph(curves: Record<number, number>): TrackGraph {
    return {
        getTrackSegmentCurve: (segmentId: number) => {
            const len = curves[segmentId];
            if (len === undefined) return null;
            return {
                fullLength: len,
                lengthAtT: (t: number) => len * t,
            };
        },
    } as unknown as TrackGraph;
}

function makeTrain(segment: number, tValue: number, speed = 0): Train {
    return {
        position: { trackSegment: segment, tValue, direction: 'tangent', point: { x: 0, y: 0 } },
        speed,
    } as unknown as Train;
}

function makePlaced(entries: { id: number; train: Train }[]): PlacedTrainEntry[] {
    return entries as PlacedTrainEntry[];
}

const nullOccupancy = {} as OccupancyRegistry;

describe('StationPresenceDetector', () => {
    function makeDetector() {
        const sm = makeStationManager([
            {
                id: 1,
                platforms: [
                    {
                        id: 0,
                        track: 10,
                        stopPositions: [
                            { id: 0, trackSegmentId: 10, tValue: 0.5, direction: 'tangent' },
                        ],
                    },
                ],
                trackAlignedPlatforms: [],
            },
        ]);
        const tapMgr = makeTapManager([]);
        const trackGraph = makeTrackGraph({ 10: 100, 20: 100 });
        return new StationPresenceDetector(sm, tapMgr, trackGraph, 5);
    }

    it('detects a train near a stop position', () => {
        const detector = makeDetector();
        const trains = makePlaced([
            { id: 1, train: makeTrain(10, 0.51) },
        ]);
        detector.update(trains, nullOccupancy);
        const presence = detector.getPresenceForTrain(1);
        expect(presence).not.toBeNull();
        expect(presence!.stationId).toBe(1);
        expect(presence!.stopPositionId).toBe(0);
    });

    it('returns null for a train far from any stop', () => {
        const detector = makeDetector();
        const trains = makePlaced([
            { id: 1, train: makeTrain(10, 0.1) },
        ]);
        detector.update(trains, nullOccupancy);
        expect(detector.getPresenceForTrain(1)).toBeNull();
    });

    it('returns null for a train on a segment with no stops', () => {
        const detector = makeDetector();
        const trains = makePlaced([
            { id: 1, train: makeTrain(20, 0.5) },
        ]);
        detector.update(trains, nullOccupancy);
        expect(detector.getPresenceForTrain(1)).toBeNull();
    });

    it('fires an arrived event when a train enters proximity', () => {
        const detector = makeDetector();
        const events: StationPresenceEvent[] = [];
        detector.subscribe((e) => events.push(e));

        detector.update(makePlaced([{ id: 1, train: makeTrain(10, 0.51) }]), nullOccupancy);

        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('arrived');
        if (events[0].type === 'arrived') {
            expect(events[0].trainId).toBe(1);
            expect(events[0].presence.stationId).toBe(1);
        }
    });

    it('fires a departed event when a train leaves proximity', () => {
        const detector = makeDetector();
        const events: StationPresenceEvent[] = [];

        // Frame 1: train arrives.
        detector.update(makePlaced([{ id: 1, train: makeTrain(10, 0.51) }]), nullOccupancy);
        detector.subscribe((e) => events.push(e));

        // Frame 2: train is gone (empty train list).
        detector.update(makePlaced([]), nullOccupancy);

        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('departed');
        if (events[0].type === 'departed') {
            expect(events[0].trainId).toBe(1);
        }
    });

    it('does not fire events when a train stays at the same stop', () => {
        const detector = makeDetector();

        // Frame 1: arrive.
        detector.update(makePlaced([{ id: 1, train: makeTrain(10, 0.51) }]), nullOccupancy);

        const events: StationPresenceEvent[] = [];
        detector.subscribe((e) => events.push(e));

        // Frame 2: still there.
        detector.update(makePlaced([{ id: 1, train: makeTrain(10, 0.52) }]), nullOccupancy);

        expect(events).toHaveLength(0);
    });

    it('getTrainsAtStation returns matching train ids', () => {
        const detector = makeDetector();
        detector.update(makePlaced([
            { id: 1, train: makeTrain(10, 0.51) },
            { id: 2, train: makeTrain(10, 0.1) },
        ]), nullOccupancy);

        expect(detector.getTrainsAtStation(1)).toEqual([1]);
        expect(detector.getTrainsAtStation(99)).toEqual([]);
    });
});
```

- [ ] **Step 2: Run tests and confirm they pass.**

Run: `bun test test/station-presence-detector.test.ts`
Expected: PASS (all cases including the new detector-level tests).

- [ ] **Step 3: Run full suite and build.**

Run: `bun test && bun run build`
Expected: all green.

- [ ] **Step 4: Commit.**

```bash
git add test/station-presence-detector.test.ts
git commit -m "test(trains): add StationPresenceDetector update and event tests"
```

---

## Task 3: Wire into TrainRenderSystem and app init

**Files:**

- Modify: `src/trains/train-render-system.ts`
- Modify: `src/utils/init-app.ts` (or wherever `TrainRenderSystem` is constructed and managers are wired)

Instantiate the detector in `TrainRenderSystem`, call `detector.update(placed, occupancyRegistry)` each frame, and trigger `rebuildIndex()` when platforms change.

- [ ] **Step 1: Add the detector to `TrainRenderSystem`.**

Edit `src/trains/train-render-system.ts`. Add the import:

```ts
import { StationPresenceDetector } from './station-presence-detector';
import type { StationManager } from '@/stations/station-manager';
import type { TrackAlignedPlatformManager } from '@/stations/track-aligned-platform-manager';
```

Add a private field to the class:

```ts
private _stationPresenceDetector: StationPresenceDetector | null = null;
```

Add a public setter and getter:

```ts
/** Set the station presence detector. Called during app init. */
setStationPresenceDetector(detector: StationPresenceDetector): void {
    this._stationPresenceDetector = detector;
}

/** The station presence detector, updated each frame. */
get stationPresenceDetector(): StationPresenceDetector | null {
    return this._stationPresenceDetector;
}
```

In the `update()` method (around line 422-424), after `this._collisionGuard?.update(placed, this._occupancyRegistry);`, add:

```ts
this._stationPresenceDetector?.update(placed, this._occupancyRegistry);
```

- [ ] **Step 2: Wire the detector in `init-app.ts` (or wherever the render system + managers are constructed).**

Read `src/utils/init-app.ts` to find where `TrainRenderSystem` and the platform managers are constructed. Add:

```ts
const stationPresenceDetector = new StationPresenceDetector(
    stationManager,
    trackAlignedPlatformManager,
    trackGraph,
);
trainRenderSystem.setStationPresenceDetector(stationPresenceDetector);

// Rebuild the stop index when platforms change.
trackAlignedPlatformManager.onChange(() => stationPresenceDetector.rebuildIndex());
```

(Adapt variable names to match the actual init-app code. Read the file first and place this after the render system and managers are both created.)

For island platforms: `StationManager` doesn't have a change observable. If a station's platforms change at runtime (currently only via factory creation and platform reassignment), a manual `stationPresenceDetector.rebuildIndex()` call is needed at those sites. For now, the track-aligned platform observable covers the common case; island platforms are typically static after placement.

Also expose the detector on the app object for UI consumption:

```ts
// Add to the app components type / object:
stationPresenceDetector,
```

- [ ] **Step 3: Run `bun test && bun run build`.**

Expected: all green.

- [ ] **Step 4: Commit.**

```bash
git add \
    src/trains/train-render-system.ts \
    src/utils/init-app.ts
git commit -m "feat(trains): wire StationPresenceDetector into render loop and app init"
```

---

## Closing checklist

After completing the tasks above, verify:

- [ ] `bun test` — full suite passes (new tests included).
- [ ] `bun run build` — production build succeeds.
- [ ] `bun run dev` (manual) — place a train near a station stop position. Open the browser console and call `app.stationPresenceDetector.getPresenceForTrain(<trainId>)` to verify it returns the correct station/platform/stop. Move the train away and verify it returns `null`. Subscribe to events and drive a train through a station — verify "arrived" and "departed" fire.
