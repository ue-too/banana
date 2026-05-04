# Proximity-Based Automatic Coupling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a moving train approaches a stopped train at low speed with its leading endpoint aligned, auto-couple them on contact. Allow the moving train to actually reach contact distance by exempting the pair from `CollisionGuard` intervention while the approach is in progress.

**Architecture:** Add two new units (`CouplingApproachDetector`, `AutoCoupler`) and one extracted shared helper (`track-arc-utils`). `ProximityDetector` continues to drive the existing manual coupling UI unchanged. `CollisionGuard` consults the new detector and skips intervention for exempt pairs. `AutoCoupler` runs after the render system tick from `init-app.ts`.

**Tech Stack:** TypeScript, Bun test runner (`bun test`), `sonner` toasts, project i18n (`@/i18n`).

**Spec:** `docs/superpowers/specs/2026-05-04-proximity-based-coupling-design.md`

---

## File Structure

**New source files:**

- `src/trains/track-arc-utils.ts` — pure functions for closing speed and effective collision-relevant distance, extracted from `collision-guard.ts`. Used by both `CollisionGuard` and `CouplingApproachDetector`.
- `src/trains/coupling-approach-detector.ts` — per-frame classifier of colocated train pairs (`'in-range' | 'aligned-approach' | null`). Exposes `getInRangeMatches()` and `isExempt()`.
- `src/trains/auto-coupler.ts` — orchestrator: reads in-range matches, calls `trainManager.coupleTrains()`, toasts results, dedupes by per-frame merged-train set.

**New test files (in `test/` per project convention):**

- `test/track-arc-utils.test.ts`
- `test/coupling-approach-detector.test.ts`
- `test/auto-coupler.test.ts`

**Modified files:**

- `src/trains/collision-guard.ts` — replace inline closing-speed / effective-distance with imports from `track-arc-utils`; add early-return exemption in `_checkSameTrack`; add detector setter.
- `src/trains/train-render-system.ts` — own `CouplingApproachDetector`, update it in tick, expose getter, wire into `collisionGuard` setter so the guard sees the detector.
- `src/utils/init-app.ts` — construct `AutoCoupler`; invoke `autoCoupler.update()` from inside the existing `timeManager.subscribe` callback after `trainRenderSystem.update(deltaTime)`.
- `src/i18n/locales/en.ts`, `src/i18n/locales/zh-TW.ts`, `src/i18n/locales/ja.ts` — add `couplingAutoSuccess` key.
- `test/collision-guard.test.ts` — add exempt-pair regression tests.

**Untouched:** `proximity-detector.ts`, `train-manager.ts`, `formation.ts`, `formation-editor.tsx`, `icon-handoff-*.ts` locale files (they hold icon mappings, not text).

---

## Task 1: Extract `track-arc-utils` with tests

**Files:**

- Create: `src/trains/track-arc-utils.ts`
- Test: `test/track-arc-utils.test.ts`

This task only creates the extracted helpers and tests them. The next task swaps `CollisionGuard` over to using them.

- [ ] **Step 1: Write the failing test**

Create `test/track-arc-utils.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';

import type {
    ThrottleSteps,
    Train,
    TrainPosition,
} from '../src/trains/formation';
import { closingSpeed, effectiveDistance } from '../src/trains/track-arc-utils';

function pos(
    segment: number,
    tValue: number,
    direction: 'tangent' | 'reverseTangent' = 'tangent'
): TrainPosition {
    return { trackSegment: segment, tValue, direction, point: { x: 0, y: 0 } };
}

function mockTrain(opts: {
    headPosition: TrainPosition;
    bogiePositions: TrainPosition[];
    speed: number;
}): Train {
    let speed = opts.speed;
    let throttle: ThrottleSteps = 'N';
    return {
        position: opts.headPosition,
        getBogiePositions: () => opts.bogiePositions,
        get speed() {
            return speed;
        },
        get throttleStep() {
            return throttle;
        },
        get collisionLocked() {
            return false;
        },
        formation: { headCouplerLength: 0, tailCouplerLength: 0 },
        setThrottleStep(s: ThrottleSteps) {
            throttle = s;
        },
        emergencyStop() {
            speed = 0;
        },
        clearCollisionLock() {},
    } as unknown as Train;
}

const lengthAtT = (t: number) => t * 100; // 100-unit segment
const seg = { curve: { lengthAtT } };

describe('closingSpeed', () => {
    it('returns sum of speeds for head-on (opposite directions)', () => {
        const a = pos(1, 0.1, 'tangent');
        const b = pos(1, 0.5, 'reverseTangent');
        expect(closingSpeed(a, b, lengthAtT(0.1), lengthAtT(0.5), 3, 4)).toBe(
            7
        );
    });

    it('returns rear minus front when both move tangent and rear is faster', () => {
        const a = pos(1, 0.1, 'tangent');
        const b = pos(1, 0.5, 'tangent');
        // a is rear (lower arc), faster → closing
        expect(closingSpeed(a, b, lengthAtT(0.1), lengthAtT(0.5), 5, 2)).toBe(
            3
        );
    });

    it('returns 0 when both move tangent and front is faster (diverging)', () => {
        const a = pos(1, 0.1, 'tangent');
        const b = pos(1, 0.5, 'tangent');
        expect(closingSpeed(a, b, lengthAtT(0.1), lengthAtT(0.5), 1, 5)).toBe(
            0
        );
    });

    it('returns 0 for diverging head-to-head (lower reverseTangent, higher tangent)', () => {
        const a = pos(1, 0.1, 'reverseTangent');
        const b = pos(1, 0.5, 'tangent');
        expect(closingSpeed(a, b, lengthAtT(0.1), lengthAtT(0.5), 3, 4)).toBe(
            0
        );
    });
});

describe('effectiveDistance', () => {
    it('returns head-to-head arc distance for head-on', () => {
        const a = pos(1, 0.1, 'tangent');
        const b = pos(1, 0.5, 'reverseTangent');
        const trainA = mockTrain({
            headPosition: a,
            bogiePositions: [a],
            speed: 1,
        });
        const trainB = mockTrain({
            headPosition: b,
            bogiePositions: [b],
            speed: 1,
        });
        expect(
            effectiveDistance(
                a,
                b,
                trainA,
                trainB,
                lengthAtT(0.1),
                lengthAtT(0.5),
                seg
            )
        ).toBe(40);
    });

    it('returns rear-head to front-tail distance when following same direction', () => {
        // Both tangent. trainA at 0.1 (rear), trainB at 0.5 (front).
        // trainB has bogies at 0.5 (head) and 0.45 (tail). So tail arc = 45.
        // Gap = |arcA(=10) - frontTailArc(=45)| = 35.
        const headA = pos(1, 0.1, 'tangent');
        const headB = pos(1, 0.5, 'tangent');
        const trainA = mockTrain({
            headPosition: headA,
            bogiePositions: [headA],
            speed: 1,
        });
        const trainB = mockTrain({
            headPosition: headB,
            bogiePositions: [headB, pos(1, 0.45, 'tangent')],
            speed: 1,
        });
        expect(
            effectiveDistance(
                headA,
                headB,
                trainA,
                trainB,
                lengthAtT(0.1),
                lengthAtT(0.5),
                seg
            )
        ).toBe(35);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test test/track-arc-utils.test.ts
```

Expected: FAIL — `Cannot find module '../src/trains/track-arc-utils'`.

- [ ] **Step 3: Create `track-arc-utils.ts` with the helpers**

Create `src/trains/track-arc-utils.ts`:

```typescript
import type { TrainPosition } from './formation';

/**
 * Anything with a `getBogiePositions(): TrainPosition[] | null` method.
 * Lets util consumers stay decoupled from the full Train interface.
 */
type BogiePositionsProvider = {
    getBogiePositions(): readonly TrainPosition[] | null;
};

/**
 * Compute the rate at which the gap between two trains on the same segment
 * is closing. Returns a positive value if they are getting closer, or 0 if
 * the gap is steady or growing.
 *
 * Convention:
 * - `'tangent'` → moving toward higher t-value / arc-length.
 * - `'reverseTangent'` → moving toward lower t-value / arc-length.
 */
export function closingSpeed(
    posA: TrainPosition,
    posB: TrainPosition,
    arcA: number,
    arcB: number,
    speedA: number,
    speedB: number
): number {
    let lowerDir: 'tangent' | 'reverseTangent';
    let higherDir: 'tangent' | 'reverseTangent';
    let lowerSpeed: number;
    let higherSpeed: number;

    if (arcA <= arcB) {
        lowerDir = posA.direction;
        higherDir = posB.direction;
        lowerSpeed = speedA;
        higherSpeed = speedB;
    } else {
        lowerDir = posB.direction;
        higherDir = posA.direction;
        lowerSpeed = speedB;
        higherSpeed = speedA;
    }

    if (lowerDir === 'tangent' && higherDir === 'reverseTangent') {
        return lowerSpeed + higherSpeed;
    }
    if (lowerDir === 'tangent' && higherDir === 'tangent') {
        return Math.max(0, lowerSpeed - higherSpeed);
    }
    if (lowerDir === 'reverseTangent' && higherDir === 'reverseTangent') {
        return Math.max(0, higherSpeed - lowerSpeed);
    }
    return 0;
}

/**
 * Compute the effective collision-relevant distance between two trains.
 *
 * - **Head-on**: both heads approach each other → head-to-head distance.
 * - **Following**: the rear train's head approaches the front train's tail →
 *   distance from rear head to front train's last bogie on this segment.
 *   Returns 0 if already overlapping.
 */
export function effectiveDistance(
    posA: TrainPosition,
    posB: TrainPosition,
    trainA: BogiePositionsProvider,
    trainB: BogiePositionsProvider,
    arcA: number,
    arcB: number,
    seg: { curve: { lengthAtT(t: number): number } }
): number {
    if (posA.direction !== posB.direction) {
        return Math.abs(arcA - arcB);
    }

    let rearArc: number;
    let frontTrain: BogiePositionsProvider;

    if (posA.direction === 'tangent') {
        if (arcA <= arcB) {
            rearArc = arcA;
            frontTrain = trainB;
        } else {
            rearArc = arcB;
            frontTrain = trainA;
        }
    } else {
        if (arcA >= arcB) {
            rearArc = arcA;
            frontTrain = trainB;
        } else {
            rearArc = arcB;
            frontTrain = trainA;
        }
    }

    const frontTailArc = _tailArcOnSegment(frontTrain, posA.trackSegment, seg);
    if (frontTailArc === null) {
        return Math.abs(arcA - arcB);
    }

    return Math.abs(rearArc - frontTailArc);
}

function _tailArcOnSegment(
    train: BogiePositionsProvider,
    segmentNumber: number,
    seg: { curve: { lengthAtT(t: number): number } }
): number | null {
    const bogies = train.getBogiePositions();
    if (!bogies || bogies.length === 0) return null;

    for (let i = bogies.length - 1; i >= 0; i--) {
        if (bogies[i].trackSegment === segmentNumber) {
            return seg.curve.lengthAtT(bogies[i].tValue);
        }
    }
    return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test test/track-arc-utils.test.ts
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/trains/track-arc-utils.ts test/track-arc-utils.test.ts
git commit -m "$(
    cat << 'EOF'
refactor(trains): extract track-arc geometry helpers

Pulls closing-speed and effective-distance computations into a shared
util so a new CouplingApproachDetector can reuse the same geometry as
CollisionGuard without drift. CollisionGuard still uses its inline
copies for now; switched in the next commit.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Refactor `CollisionGuard` to use `track-arc-utils`

**Files:**

- Modify: `src/trains/collision-guard.ts:200-419`
- Verify: `test/collision-guard.test.ts` (existing tests must keep passing — no edits)

- [ ] **Step 1: Run existing collision tests to capture green baseline**

```bash
bun test test/collision-guard.test.ts
```

Expected: all existing tests PASS.

- [ ] **Step 2: Replace inline helpers with imports**

Edit `src/trains/collision-guard.ts`:

At the top of the file, add the import after the existing imports:

```typescript
import { closingSpeed, effectiveDistance } from './track-arc-utils';
```

In `_checkSameTrack` (around line 226), replace the call site. The existing code is:

```typescript
        const closingSpeed = this._closingSpeed(
            posA,
            posB,
            arcA,
            arcB,
            trainA.speed,
            trainB.speed
        );
        if (closingSpeed <= 0) return;
```

Replace it with (note the local variable is renamed to avoid shadowing the imported function):

```typescript
        const closingSpeedValue = closingSpeed(
            posA,
            posB,
            arcA,
            arcB,
            trainA.speed,
            trainB.speed
        );
        if (closingSpeedValue <= 0) return;
```

Around line 240, replace:

```typescript
const distance = this._effectiveDistance(
    posA,
    posB,
    trainA,
    trainB,
    arcA,
    arcB,
    seg
);
```

with:

```typescript
const distance = effectiveDistance(posA, posB, trainA, trainB, arcA, arcB, seg);
```

Then **delete** the now-unused private methods `_effectiveDistance`, `_tailArcOnSegment`, and `_closingSpeed` (currently at lines 271–419, ending just before `_checkCrossings`).

Note: rename the local var inside `_checkSameTrack` if needed — make sure the closing-speed variable doesn't shadow the imported `closingSpeed` symbol. The body using it should work as-is once the local is `closingSpeedValue`.

- [ ] **Step 3: Run all collision tests**

```bash
bun test test/collision-guard.test.ts
```

Expected: all existing tests still PASS — behavior unchanged.

- [ ] **Step 4: Run the full test suite to catch any incidental regression**

```bash
bun test
```

Expected: full suite passes.

- [ ] **Step 5: Commit**

```bash
git add src/trains/collision-guard.ts
git commit -m "$(
    cat << 'EOF'
refactor(trains): collision-guard uses shared track-arc helpers

Removes the now-duplicated _closingSpeed, _effectiveDistance, and
_tailArcOnSegment methods in favor of the shared exports from
track-arc-utils. Behavior unchanged; existing tests cover regression.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Build `CouplingApproachDetector` (TDD)

**Files:**

- Create: `src/trains/coupling-approach-detector.ts`
- Test: `test/coupling-approach-detector.test.ts`

This is the bulk of the new logic. Built test-first, one rule at a time. Tests use mocked Train objects (same pattern as `test/collision-guard.test.ts`).

- [ ] **Step 1: Write the first failing test (rule 1: both stopped → null)**

Create `test/coupling-approach-detector.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from 'bun:test';

import { CouplingApproachDetector } from '../src/trains/coupling-approach-detector';
import type {
    ThrottleSteps,
    Train,
    TrainPosition,
} from '../src/trains/formation';
import { OccupancyRegistry } from '../src/trains/occupancy-registry';
import type { TrackGraph } from '../src/trains/tracks/track';
import type { PlacedTrainEntry } from '../src/trains/train-manager';

// ---------------------------------------------------------------------------
// Helpers (mirror test/collision-guard.test.ts)
// ---------------------------------------------------------------------------

function pos(
    segment: number,
    tValue: number,
    direction: 'tangent' | 'reverseTangent' = 'tangent',
    point: { x: number; y: number } = { x: 0, y: 0 }
): TrainPosition {
    return { trackSegment: segment, tValue, direction, point };
}

function mockTrain(opts: {
    headPosition: TrainPosition | null;
    bogiePositions: TrainPosition[] | null;
    speed?: number;
    headCouplerLength?: number;
    tailCouplerLength?: number;
    occupiedSegments?: {
        trackNumber: number;
        inTrackDirection: 'tangent' | 'reverseTangent';
    }[];
    occupiedJoints?: {
        jointNumber: number;
        direction: 'tangent' | 'reverseTangent';
    }[];
}): Train {
    let speed = opts.speed ?? 0;
    let throttle: ThrottleSteps = 'N';
    return {
        position: opts.headPosition,
        getBogiePositions: () => opts.bogiePositions,
        get speed() {
            return speed;
        },
        get throttleStep() {
            return throttle;
        },
        get collisionLocked() {
            return false;
        },
        occupiedTrackSegments: opts.occupiedSegments ?? [],
        occupiedJointNumbers: opts.occupiedJoints ?? [],
        formation: {
            headCouplerLength: opts.headCouplerLength ?? 3,
            tailCouplerLength: opts.tailCouplerLength ?? 3,
        },
        setThrottleStep(s: ThrottleSteps) {
            throttle = s;
        },
        emergencyStop() {
            speed = 0;
        },
        clearCollisionLock() {},
    } as unknown as Train;
}

function entry(id: number, train: Train): PlacedTrainEntry {
    return { id, train };
}

function mockTrackGraph(segmentFullLength: number = 100): TrackGraph {
    return {
        getTrackSegmentWithJoints(_n: number) {
            return {
                curve: {
                    lengthAtT: (t: number) => t * segmentFullLength,
                    fullLength: segmentFullLength,
                },
            };
        },
    } as unknown as TrackGraph;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CouplingApproachDetector', () => {
    let registry: OccupancyRegistry;

    beforeEach(() => {
        registry = new OccupancyRegistry();
    });

    it('returns no in-range matches when both trains are stopped', () => {
        const trackGraph = mockTrackGraph(100);
        const detector = new CouplingApproachDetector(trackGraph);

        // Two stopped trains within coupling proximity (~8 units) at t=0.10 and t=0.18.
        // arc distance = 8.
        const trainA = mockTrain({
            headPosition: pos(1, 0.1, 'tangent', { x: 10, y: 0 }),
            bogiePositions: [pos(1, 0.1, 'tangent', { x: 10, y: 0 })],
            speed: 0,
            occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
        });
        const trainB = mockTrain({
            headPosition: pos(1, 0.18, 'reverseTangent', { x: 18, y: 0 }),
            bogiePositions: [pos(1, 0.18, 'reverseTangent', { x: 18, y: 0 })],
            speed: 0,
            occupiedSegments: [
                { trackNumber: 1, inTrackDirection: 'reverseTangent' },
            ],
        });

        const entries = [entry(1, trainA), entry(2, trainB)];
        registry.updateFromTrains(entries);
        detector.update(entries, registry);

        expect(detector.getInRangeMatches()).toHaveLength(0);
        expect(detector.isExempt(1, 2)).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test test/coupling-approach-detector.test.ts
```

Expected: FAIL — module does not exist yet.

- [ ] **Step 3: Create the minimal `CouplingApproachDetector`**

Create `src/trains/coupling-approach-detector.ts`:

```typescript
import type { Train, TrainPosition } from './formation';
import type { OccupancyRegistry } from './occupancy-registry';
import type { ProximityMatch } from './proximity-detector';
import { closingSpeed } from './track-arc-utils';
import type { TrackGraph } from './tracks/track';
import type { PlacedTrainEntry } from './train-manager';

/**
 * Maximum speed (world units / sec) at which a moving train can still be
 * considered "approaching for coupling" rather than colliding.
 */
const SHUNT_SPEED_THRESHOLD = 2;

/**
 * Approach envelope multiplier. The aligned-approach exemption activates
 * only when endpoint distance is within `MULTIPLIER × couplingProximityThreshold`.
 */
const APPROACH_ENVELOPE_MULTIPLIER = 2;

/**
 * Gap tolerance (world units) added on top of the two coupler lengths to
 * form the coupling proximity threshold. Mirrors the constant in
 * proximity-detector.ts so the two systems share the same physical
 * "endpoints touching" definition.
 */
const COUPLING_GAP_TOLERANCE = 2;

/**
 * Per-frame classifier of train pairs that are aligned for coupling.
 *
 * Reads colocated pairs from {@link OccupancyRegistry} (broad-phase) and
 * classifies each pair as `'in-range'` (auto-coupling fires),
 * `'aligned-approach'` (collision-guard exemption only), or `null`.
 *
 * @group Train System
 */
export class CouplingApproachDetector {
    private _trackGraph: TrackGraph;
    private _inRangeMatches: ProximityMatch[] = [];
    private _exemptPairs: Set<string> = new Set();
    private _trainMap: Map<number, PlacedTrainEntry> = new Map();

    constructor(trackGraph: TrackGraph) {
        this._trackGraph = trackGraph;
    }

    /**
     * Re-evaluate all colocated pairs for coupling-approach status.
     * Call once per frame after `OccupancyRegistry.updateFromTrains()`.
     */
    update(
        trains: readonly PlacedTrainEntry[],
        registry: OccupancyRegistry
    ): void {
        this._inRangeMatches.length = 0;
        this._exemptPairs.clear();

        const colocated = registry.getColocatedPairs();
        if (colocated.size === 0) return;

        this._trainMap.clear();
        for (const e of trains) this._trainMap.set(e.id, e);

        for (const pairKey of colocated) {
            const colon = pairKey.indexOf(':');
            const idA = parseInt(pairKey.slice(0, colon), 10);
            const idB = parseInt(pairKey.slice(colon + 1), 10);

            const eA = this._trainMap.get(idA);
            const eB = this._trainMap.get(idB);
            if (!eA || !eB) continue;

            this._classifyPair(idA, eA.train, idB, eB.train);
        }

        // Closest first → AutoCoupler iterates and skips merged trains naturally.
        this._inRangeMatches.sort((a, b) => a.distance - b.distance);
    }

    /**
     * In-range matches sorted by endpoint distance ascending.
     * AutoCoupler should consume these.
     */
    getInRangeMatches(): readonly ProximityMatch[] {
        return this._inRangeMatches;
    }

    /**
     * True when the pair is aligned for coupling — used by CollisionGuard
     * to skip Tier 1/2 intervention for the pair this frame.
     */
    isExempt(idA: number, idB: number): boolean {
        const lo = Math.min(idA, idB);
        const hi = Math.max(idA, idB);
        return this._exemptPairs.has(`${lo}:${hi}`);
    }

    private _classifyPair(
        idA: number,
        trainA: Train,
        idB: number,
        trainB: Train
    ): void {
        // Rule 1: exactly one moving.
        const aMoving = trainA.speed > 0;
        const bMoving = trainB.speed > 0;
        if (aMoving === bMoving) return;

        const moving = aMoving ? trainA : trainB;
        const stopped = aMoving ? trainB : trainA;
        const movingId = aMoving ? idA : idB;
        const stoppedId = aMoving ? idB : idA;

        // Rule 2: moving train must be at or below shunt speed.
        if (moving.speed > SHUNT_SPEED_THRESHOLD) return;

        const movingPos = moving.position;
        const stoppedPos = stopped.position;
        if (!movingPos || !stoppedPos) return;

        // Rule 3: leading endpoint determined by direction of travel.
        const movingBogies = moving.getBogiePositions();
        if (!movingBogies || movingBogies.length === 0) return;
        const movingLeadingEnd: 'head' | 'tail' =
            movingPos.direction === 'tangent' ? 'head' : 'tail';
        const movingLeadingPos =
            movingLeadingEnd === 'head'
                ? movingPos
                : movingBogies[movingBogies.length - 1];
        const movingLeadingPoint =
            movingLeadingEnd === 'head'
                ? movingPos.point
                : movingBogies[movingBogies.length - 1].point;

        const stoppedBogies = stopped.getBogiePositions();
        if (!stoppedBogies || stoppedBogies.length === 0) return;

        // Rule 4: pair the moving leading endpoint with stopped head OR tail,
        // whichever is on the same segment AND closer.
        const stoppedHeadPos = stoppedPos;
        const stoppedTailPos = stoppedBogies[stoppedBogies.length - 1];

        const candidates: {
            stoppedEnd: 'head' | 'tail';
            stoppedEndPos: TrainPosition;
            stoppedEndPoint: { x: number; y: number };
        }[] = [];
        if (stoppedHeadPos.trackSegment === movingLeadingPos.trackSegment) {
            candidates.push({
                stoppedEnd: 'head',
                stoppedEndPos: stoppedHeadPos,
                stoppedEndPoint: stoppedHeadPos.point,
            });
        }
        if (stoppedTailPos.trackSegment === movingLeadingPos.trackSegment) {
            candidates.push({
                stoppedEnd: 'tail',
                stoppedEndPos: stoppedTailPos,
                stoppedEndPoint: stoppedTailPos.point,
            });
        }
        if (candidates.length === 0) return;

        const seg = this._trackGraph.getTrackSegmentWithJoints(
            movingLeadingPos.trackSegment
        );
        if (!seg) return;

        const movingArc = seg.curve.lengthAtT(movingLeadingPos.tValue);

        // Pick the candidate with the smaller endpoint distance.
        let best: {
            stoppedEnd: 'head' | 'tail';
            stoppedEndPos: TrainPosition;
            distance: number;
        } | null = null;
        for (const c of candidates) {
            const dx = movingLeadingPoint.x - c.stoppedEndPoint.x;
            const dy = movingLeadingPoint.y - c.stoppedEndPoint.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (best === null || d < best.distance) {
                best = {
                    stoppedEnd: c.stoppedEnd,
                    stoppedEndPos: c.stoppedEndPos,
                    distance: d,
                };
            }
        }
        if (best === null) return;

        // Rule 5: leading endpoint must be closing on the chosen stopped endpoint.
        // For closing-speed math, treat the stopped endpoint as a stationary "train"
        // whose direction makes its endpoint the head approaching us.
        const stoppedArc = seg.curve.lengthAtT(best.stoppedEndPos.tValue);
        const close = closingSpeed(
            movingLeadingPos,
            best.stoppedEndPos,
            movingArc,
            stoppedArc,
            moving.speed,
            0
        );
        if (close <= 0) return;

        // Rule 6: within approach envelope.
        const couplingThreshold =
            (movingLeadingEnd === 'head'
                ? moving.formation.headCouplerLength
                : moving.formation.tailCouplerLength) +
            (best.stoppedEnd === 'head'
                ? stopped.formation.headCouplerLength
                : stopped.formation.tailCouplerLength) +
            COUPLING_GAP_TOLERANCE;

        const envelope = couplingThreshold * APPROACH_ENVELOPE_MULTIPLIER;
        if (best.distance > envelope) return;

        // Pair qualifies for exemption.
        const lo = Math.min(movingId, stoppedId);
        const hi = Math.max(movingId, stoppedId);
        this._exemptPairs.add(`${lo}:${hi}`);

        if (best.distance <= couplingThreshold) {
            this._inRangeMatches.push({
                trainA: { id: movingId, end: movingLeadingEnd },
                trainB: { id: stoppedId, end: best.stoppedEnd },
                distance: best.distance,
            });
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test test/coupling-approach-detector.test.ts
```

Expected: PASS — both-stopped case returns no matches.

- [ ] **Step 5: Add the rest of the rule tests**

Append to `test/coupling-approach-detector.test.ts`, inside the same `describe('CouplingApproachDetector', ...)`:

```typescript
    it('returns an in-range match for stopped + slow-moving with leading head aligned', () => {
        // Moving train (id 1) head at t=0.05 (point x=5), tangent direction → leading=head.
        // Stopped train (id 2) head at t=0.10 (point x=10), reverseTangent (so its head faces lower arc).
        // Endpoint Euclidean distance = 5. Default coupler 3+3+2 = 8. 5 <= 8 → in-range.
        const trackGraph = mockTrackGraph(100);
        const detector = new CouplingApproachDetector(trackGraph);

        const moving = mockTrain({
            headPosition: pos(1, 0.05, 'tangent', { x: 5, y: 0 }),
            bogiePositions: [pos(1, 0.05, 'tangent', { x: 5, y: 0 })],
            speed: 1,
            occupiedSegments: [
                { trackNumber: 1, inTrackDirection: 'tangent' },
            ],
        });
        const stopped = mockTrain({
            headPosition: pos(1, 0.1, 'reverseTangent', { x: 10, y: 0 }),
            bogiePositions: [pos(1, 0.1, 'reverseTangent', { x: 10, y: 0 })],
            speed: 0,
            occupiedSegments: [
                { trackNumber: 1, inTrackDirection: 'reverseTangent' },
            ],
        });

        const entries = [entry(1, moving), entry(2, stopped)];
        registry.updateFromTrains(entries);
        detector.update(entries, registry);

        const matches = detector.getInRangeMatches();
        expect(matches).toHaveLength(1);
        expect(matches[0]).toMatchObject({
            trainA: { id: 1, end: 'head' },
            trainB: { id: 2, end: 'head' },
        });
        expect(detector.isExempt(1, 2)).toBe(true);
    });

    it('marks pair exempt but not in-range when distance exceeds coupling threshold but is within envelope', () => {
        // Endpoint distance = 12. Threshold = 8. Envelope = 16. 8 < 12 <= 16 → aligned-approach.
        const trackGraph = mockTrackGraph(100);
        const detector = new CouplingApproachDetector(trackGraph);

        const moving = mockTrain({
            headPosition: pos(1, 0.05, 'tangent', { x: 5, y: 0 }),
            bogiePositions: [pos(1, 0.05, 'tangent', { x: 5, y: 0 })],
            speed: 1,
            occupiedSegments: [
                { trackNumber: 1, inTrackDirection: 'tangent' },
            ],
        });
        const stopped = mockTrain({
            headPosition: pos(1, 0.17, 'reverseTangent', { x: 17, y: 0 }),
            bogiePositions: [pos(1, 0.17, 'reverseTangent', { x: 17, y: 0 })],
            speed: 0,
            occupiedSegments: [
                { trackNumber: 1, inTrackDirection: 'reverseTangent' },
            ],
        });

        const entries = [entry(1, moving), entry(2, stopped)];
        registry.updateFromTrains(entries);
        detector.update(entries, registry);

        expect(detector.getInRangeMatches()).toHaveLength(0);
        expect(detector.isExempt(1, 2)).toBe(true);
    });

    it('returns no exemption when distance exceeds approach envelope', () => {
        // Endpoint distance = 20. Envelope = 16. 20 > 16 → null.
        const trackGraph = mockTrackGraph(100);
        const detector = new CouplingApproachDetector(trackGraph);

        const moving = mockTrain({
            headPosition: pos(1, 0.05, 'tangent', { x: 5, y: 0 }),
            bogiePositions: [pos(1, 0.05, 'tangent', { x: 5, y: 0 })],
            speed: 1,
            occupiedSegments: [
                { trackNumber: 1, inTrackDirection: 'tangent' },
            ],
        });
        const stopped = mockTrain({
            headPosition: pos(1, 0.25, 'reverseTangent', { x: 25, y: 0 }),
            bogiePositions: [pos(1, 0.25, 'reverseTangent', { x: 25, y: 0 })],
            speed: 0,
            occupiedSegments: [
                { trackNumber: 1, inTrackDirection: 'reverseTangent' },
            ],
        });

        const entries = [entry(1, moving), entry(2, stopped)];
        registry.updateFromTrains(entries);
        detector.update(entries, registry);

        expect(detector.getInRangeMatches()).toHaveLength(0);
        expect(detector.isExempt(1, 2)).toBe(false);
    });

    it('returns no exemption when moving train exceeds shunt speed threshold', () => {
        const trackGraph = mockTrackGraph(100);
        const detector = new CouplingApproachDetector(trackGraph);

        const moving = mockTrain({
            headPosition: pos(1, 0.05, 'tangent', { x: 5, y: 0 }),
            bogiePositions: [pos(1, 0.05, 'tangent', { x: 5, y: 0 })],
            speed: 5, // > 2 (SHUNT_SPEED_THRESHOLD)
            occupiedSegments: [
                { trackNumber: 1, inTrackDirection: 'tangent' },
            ],
        });
        const stopped = mockTrain({
            headPosition: pos(1, 0.1, 'reverseTangent', { x: 10, y: 0 }),
            bogiePositions: [pos(1, 0.1, 'reverseTangent', { x: 10, y: 0 })],
            speed: 0,
            occupiedSegments: [
                { trackNumber: 1, inTrackDirection: 'reverseTangent' },
            ],
        });

        const entries = [entry(1, moving), entry(2, stopped)];
        registry.updateFromTrains(entries);
        detector.update(entries, registry);

        expect(detector.getInRangeMatches()).toHaveLength(0);
        expect(detector.isExempt(1, 2)).toBe(false);
    });

    it('returns no exemption when both trains are moving', () => {
        const trackGraph = mockTrackGraph(100);
        const detector = new CouplingApproachDetector(trackGraph);

        const a = mockTrain({
            headPosition: pos(1, 0.05, 'tangent', { x: 5, y: 0 }),
            bogiePositions: [pos(1, 0.05, 'tangent', { x: 5, y: 0 })],
            speed: 1,
            occupiedSegments: [
                { trackNumber: 1, inTrackDirection: 'tangent' },
            ],
        });
        const b = mockTrain({
            headPosition: pos(1, 0.1, 'reverseTangent', { x: 10, y: 0 }),
            bogiePositions: [pos(1, 0.1, 'reverseTangent', { x: 10, y: 0 })],
            speed: 1,
            occupiedSegments: [
                { trackNumber: 1, inTrackDirection: 'reverseTangent' },
            ],
        });

        const entries = [entry(1, a), entry(2, b)];
        registry.updateFromTrains(entries);
        detector.update(entries, registry);

        expect(detector.getInRangeMatches()).toHaveLength(0);
        expect(detector.isExempt(1, 2)).toBe(false);
    });

    it('returns no exemption when moving train approaches with its trailing end', () => {
        // Moving (tangent) → leading end is head at t=0.20.
        // Stopped train sits *behind* the moving train at t=0.10.
        // Moving train's tail (last bogie at t=0.18) is closer to stopped, but
        // tail is not the leading end → rule fails.
        const trackGraph = mockTrackGraph(100);
        const detector = new CouplingApproachDetector(trackGraph);

        const moving = mockTrain({
            headPosition: pos(1, 0.2, 'tangent', { x: 20, y: 0 }),
            bogiePositions: [
                pos(1, 0.2, 'tangent', { x: 20, y: 0 }),
                pos(1, 0.18, 'tangent', { x: 18, y: 0 }),
            ],
            speed: 1,
            occupiedSegments: [
                { trackNumber: 1, inTrackDirection: 'tangent' },
            ],
        });
        const stopped = mockTrain({
            headPosition: pos(1, 0.1, 'tangent', { x: 10, y: 0 }),
            bogiePositions: [pos(1, 0.1, 'tangent', { x: 10, y: 0 })],
            speed: 0,
            occupiedSegments: [
                { trackNumber: 1, inTrackDirection: 'tangent' },
            ],
        });

        const entries = [entry(1, moving), entry(2, stopped)];
        registry.updateFromTrains(entries);
        detector.update(entries, registry);

        // Moving leading endpoint is head (x=20). Stopped is at x=10. Closing speed
        // for tangent-leading-head moving away from a behind-it stopped point → 0.
        expect(detector.getInRangeMatches()).toHaveLength(0);
        expect(detector.isExempt(1, 2)).toBe(false);
    });

    it('returns no exemption when trains are diverging', () => {
        // Both tangent. Moving at higher arc than stopped → moving away from stopped.
        const trackGraph = mockTrackGraph(100);
        const detector = new CouplingApproachDetector(trackGraph);

        const moving = mockTrain({
            headPosition: pos(1, 0.2, 'tangent', { x: 20, y: 0 }),
            bogiePositions: [pos(1, 0.2, 'tangent', { x: 20, y: 0 })],
            speed: 1,
            occupiedSegments: [
                { trackNumber: 1, inTrackDirection: 'tangent' },
            ],
        });
        const stopped = mockTrain({
            headPosition: pos(1, 0.15, 'tangent', { x: 15, y: 0 }),
            bogiePositions: [pos(1, 0.15, 'tangent', { x: 15, y: 0 })],
            speed: 0,
            occupiedSegments: [
                { trackNumber: 1, inTrackDirection: 'tangent' },
            ],
        });

        const entries = [entry(1, moving), entry(2, stopped)];
        registry.updateFromTrains(entries);
        detector.update(entries, registry);

        expect(detector.getInRangeMatches()).toHaveLength(0);
        expect(detector.isExempt(1, 2)).toBe(false);
    });

    it('returns no exemption when endpoints are on different track segments', () => {
        // Trains share a joint (so they appear in colocated pairs) but their head
        // positions are on different segments → rule 4 fails.
        const trackGraph = mockTrackGraph(100);
        const detector = new CouplingApproachDetector(trackGraph);

        const moving = mockTrain({
            headPosition: pos(1, 0.05, 'tangent', { x: 5, y: 0 }),
            bogiePositions: [pos(1, 0.05, 'tangent', { x: 5, y: 0 })],
            speed: 1,
            occupiedJoints: [{ jointNumber: 99, direction: 'tangent' }],
            occupiedSegments: [
                { trackNumber: 1, inTrackDirection: 'tangent' },
            ],
        });
        const stopped = mockTrain({
            headPosition: pos(2, 0.5, 'tangent', { x: 50, y: 0 }),
            bogiePositions: [pos(2, 0.5, 'tangent', { x: 50, y: 0 })],
            speed: 0,
            occupiedJoints: [{ jointNumber: 99, direction: 'tangent' }],
            occupiedSegments: [
                { trackNumber: 2, inTrackDirection: 'tangent' },
            ],
        });

        const entries = [entry(1, moving), entry(2, stopped)];
        registry.updateFromTrains(entries);
        detector.update(entries, registry);

        expect(detector.getInRangeMatches()).toHaveLength(0);
        expect(detector.isExempt(1, 2)).toBe(false);
    });

    it('sorts in-range matches by distance ascending', () => {
        // Moving train has two stopped neighbors in proximity.
        // We construct the scenario carefully: moving at x=0 head, two stopped
        // trains on the same segment with heads at x=4 and x=7 (both ≤ 8 threshold).
        const trackGraph = mockTrackGraph(100);
        const detector = new CouplingApproachDetector(trackGraph);

        const moving = mockTrain({
            headPosition: pos(1, 0.0, 'tangent', { x: 0, y: 0 }),
            bogiePositions: [pos(1, 0.0, 'tangent', { x: 0, y: 0 })],
            speed: 1,
            occupiedSegments: [
                { trackNumber: 1, inTrackDirection: 'tangent' },
            ],
        });
        const stoppedNear = mockTrain({
            headPosition: pos(1, 0.04, 'reverseTangent', { x: 4, y: 0 }),
            bogiePositions: [pos(1, 0.04, 'reverseTangent', { x: 4, y: 0 })],
            speed: 0,
            occupiedSegments: [
                { trackNumber: 1, inTrackDirection: 'reverseTangent' },
            ],
        });
        const stoppedFar = mockTrain({
            headPosition: pos(1, 0.07, 'reverseTangent', { x: 7, y: 0 }),
            bogiePositions: [pos(1, 0.07, 'reverseTangent', { x: 7, y: 0 })],
            speed: 0,
            occupiedSegments: [
                { trackNumber: 1, inTrackDirection: 'reverseTangent' },
            ],
        });

        const entries = [
            entry(1, moving),
            entry(2, stoppedNear),
            entry(3, stoppedFar),
        ];
        registry.updateFromTrains(entries);
        detector.update(entries, registry);

        const matches = detector.getInRangeMatches();
        expect(matches.length).toBeGreaterThanOrEqual(2);
        // Closer one first.
        expect(matches[0].distance).toBeLessThanOrEqual(matches[1].distance);
    });
});
```

- [ ] **Step 6: Run all detector tests**

```bash
bun test test/coupling-approach-detector.test.ts
```

Expected: all tests PASS. If any fail (e.g. the trailing-end test logic), inspect the failure and fix the detector — _do not_ loosen the test. Common gotchas:

- The trailing-end case may pass for the wrong reason (no candidate on segment); confirm by reading the failure.
- Different-segment test: only triggers if `OccupancyRegistry.getColocatedPairs()` returns the pair. If that returns empty for joint-only colocation, the test passes trivially — that's fine, we want no exemption either way.

- [ ] **Step 7: Commit**

```bash
git add src/trains/coupling-approach-detector.ts test/coupling-approach-detector.test.ts
git commit -m "$(
    cat << 'EOF'
feat(trains): add CouplingApproachDetector

Per-frame classifier that flags train pairs where one is stopped and
the other is approaching at low speed with its leading endpoint
aligned. Exposes in-range matches for AutoCoupler and an isExempt
query for CollisionGuard. Geometry helpers shared via track-arc-utils.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire `CouplingApproachDetector` into `TrainRenderSystem`

**Files:**

- Modify: `src/trains/train-render-system.ts:405-466, 525-532`

The detector lives next to `ProximityDetector`, ticks in the same place, and is exposed via getter so `init-app.ts` can pass it to `CollisionGuard`.

- [ ] **Step 1: Add the import**

In `src/trains/train-render-system.ts`, near the existing import of `ProximityDetector`, add:

```typescript
import { CouplingApproachDetector } from './coupling-approach-detector';
```

- [ ] **Step 2: Add the field next to `_proximityDetector`**

Around line 406, after:

```typescript
    private _proximityDetector: ProximityDetector = new ProximityDetector();
```

add:

```typescript
    private _couplingApproachDetector: CouplingApproachDetector;
```

- [ ] **Step 3: Construct it in the constructor**

In the constructor body (around line 444, after `this._carImageRegistry = ...`), add:

```typescript
this._couplingApproachDetector = new CouplingApproachDetector(trackGraph);
```

- [ ] **Step 4: Tick it in `update`**

In `update(deltaTime)` (around line 465, between the proximity update and the collision update):

```typescript
this._occupancyRegistry.updateFromTrains(placed);
this._proximityDetector.update(placed, this._occupancyRegistry);
this._couplingApproachDetector.update(placed, this._occupancyRegistry);
this._collisionGuard?.update(placed, this._occupancyRegistry);
```

- [ ] **Step 5: Expose getter**

Around line 526 (after `proximityDetector` getter), add:

```typescript
    /** The coupling-approach detector, updated each frame. */
    get couplingApproachDetector(): CouplingApproachDetector {
        return this._couplingApproachDetector;
    }
```

- [ ] **Step 6: Type-check by running tests**

```bash
bun test
```

Expected: all tests pass; no compile errors.

- [ ] **Step 7: Commit**

```bash
git add src/trains/train-render-system.ts
git commit -m "$(
    cat << 'EOF'
feat(trains): wire CouplingApproachDetector into TrainRenderSystem

Owned alongside ProximityDetector, ticked in the same update phase
between proximity and collision checks. Exposed via getter so
init-app can pass it to CollisionGuard.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add exemption check in `CollisionGuard`

**Files:**

- Modify: `src/trains/collision-guard.ts`
- Modify: `test/collision-guard.test.ts` (add regression coverage)

- [ ] **Step 1: Write failing test for the exemption**

Append a new `describe` block to `test/collision-guard.test.ts`:

```typescript
describe('CouplingApproachDetector exemption', () => {
    it('skips Tier 2 intervention for an exempt pair', () => {
        const trackGraph = mockTrackGraph(100);
        const guard = new CollisionGuard(trackGraph, crossingMap);

        // Stub detector that flags the (1, 2) pair as exempt.
        guard.setCouplingApproachDetector({
            isExempt: (a: number, b: number) =>
                (a === 1 && b === 2) || (a === 2 && b === 1),
        });

        // Geometry that would normally hit Tier 2 (distance 3 ≤ 5).
        const trainA = mockTrain({
            headPosition: makePosition(1, 0.04, 'tangent'),
            bogiePositions: [makePosition(1, 0.04, 'tangent')],
            speed: 1,
            occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
        });
        const trainB = mockTrain({
            headPosition: makePosition(1, 0.07, 'reverseTangent'),
            bogiePositions: [makePosition(1, 0.07, 'reverseTangent')],
            speed: 0,
            occupiedSegments: [
                { trackNumber: 1, inTrackDirection: 'reverseTangent' },
            ],
        });

        const entries = [entry(1, trainA), entry(2, trainB)];
        registry.updateFromTrains(entries);
        guard.update(entries, registry);

        // No emergencyStop, no throttle change.
        expect(trainA.collisionLocked).toBe(false);
        expect(trainA.throttleStep).toBe('N');
        expect(trainB.collisionLocked).toBe(false);
        expect(trainB.throttleStep).toBe('N');
    });

    it('still applies Tier 2 when the pair is not exempt', () => {
        const trackGraph = mockTrackGraph(100);
        const guard = new CollisionGuard(trackGraph, crossingMap);

        guard.setCouplingApproachDetector({
            isExempt: () => false,
        });

        const trainA = mockTrain({
            headPosition: makePosition(1, 0.04, 'tangent'),
            bogiePositions: [makePosition(1, 0.04, 'tangent')],
            speed: 5,
            occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
        });
        const trainB = mockTrain({
            headPosition: makePosition(1, 0.07, 'reverseTangent'),
            bogiePositions: [makePosition(1, 0.07, 'reverseTangent')],
            speed: 5,
            occupiedSegments: [
                { trackNumber: 1, inTrackDirection: 'reverseTangent' },
            ],
        });

        const entries = [entry(1, trainA), entry(2, trainB)];
        registry.updateFromTrains(entries);
        guard.update(entries, registry);

        expect(trainA.collisionLocked).toBe(true);
        expect(trainB.collisionLocked).toBe(true);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test test/collision-guard.test.ts
```

Expected: FAIL — `setCouplingApproachDetector is not a function`.

- [ ] **Step 3: Add the field, setter, and exemption check in `CollisionGuard`**

In `src/trains/collision-guard.ts`:

Add a small interface near the top of the file (after the `EMPTY_CROSSINGS` constant or near the `CollisionGuard` class declaration):

```typescript
/**
 * Minimal contract that CollisionGuard needs from a coupling-approach
 * detector — kept narrow so the guard isn't coupled to the detector's
 * full surface area.
 */
export interface CouplingApproachExemption {
    isExempt(idA: number, idB: number): boolean;
}
```

Add the field to the class (near the other private fields around line 132):

```typescript
    private _couplingApproachDetector: CouplingApproachExemption | null = null;
```

Add the setter (place it near the constructor, e.g. after the existing constructor):

```typescript
    /** Inject the coupling-approach detector for the per-pair exemption. */
    setCouplingApproachDetector(detector: CouplingApproachExemption): void {
        this._couplingApproachDetector = detector;
    }
```

In `_checkSameTrack` (around line 200), at the very top of the method body — _before_ the `posA` / `posB` null-check — add:

```typescript
        if (
            this._couplingApproachDetector?.isExempt(idA, idB) === true
        ) {
            return;
        }
```

- [ ] **Step 4: Run all collision tests**

```bash
bun test test/collision-guard.test.ts
```

Expected: existing tests still pass; new exemption tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/trains/collision-guard.ts test/collision-guard.test.ts
git commit -m "$(
    cat << 'EOF'
feat(collision-guard): exempt coupling-approach pairs from intervention

Adds a setCouplingApproachDetector() injection point and an early-return
in _checkSameTrack when the detector flags a pair as aligned for
coupling. Crossing detection is unaffected.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Build `AutoCoupler` (TDD)

**Files:**

- Create: `src/trains/auto-coupler.ts`
- Test: `test/auto-coupler.test.ts`

`AutoCoupler` is intentionally thin: it iterates closest-first matches, calls `coupleTrains`, dedupes by per-frame merged-train set, and routes results to two callbacks (success / failure) so the `init-app` layer owns the i18n/toast wiring.

- [ ] **Step 1: Write the failing test**

Create `test/auto-coupler.test.ts`:

```typescript
import { describe, expect, it, mock } from 'bun:test';

import { AutoCoupler } from '../src/trains/auto-coupler';
import type { ProximityMatch } from '../src/trains/proximity-detector';
import type { CoupleResult } from '../src/trains/train-manager';

type StubDetector = {
    getInRangeMatches: () => readonly ProximityMatch[];
};
type StubManager = {
    coupleTrains: (m: ProximityMatch) => CoupleResult;
};

function match(
    aId: number,
    aEnd: 'head' | 'tail',
    bId: number,
    bEnd: 'head' | 'tail',
    distance: number
): ProximityMatch {
    return {
        trainA: { id: aId, end: aEnd },
        trainB: { id: bId, end: bEnd },
        distance,
    };
}

describe('AutoCoupler', () => {
    it('does nothing when there are no in-range matches', () => {
        const detector: StubDetector = { getInRangeMatches: () => [] };
        const onSuccess = mock(() => {});
        const onFailure = mock(() => {});
        const manager: StubManager = {
            coupleTrains: mock(() => ({
                success: true as const,
                keepTrainId: 1,
            })),
        };

        const coupler = new AutoCoupler(detector, manager, {
            onSuccess,
            onFailure,
        });
        coupler.update();

        expect(manager.coupleTrains).not.toHaveBeenCalled();
        expect(onSuccess).not.toHaveBeenCalled();
        expect(onFailure).not.toHaveBeenCalled();
    });

    it('calls coupleTrains and onSuccess for a single in-range match', () => {
        const m = match(1, 'head', 2, 'head', 4);
        const detector: StubDetector = { getInRangeMatches: () => [m] };
        const onSuccess = mock(() => {});
        const onFailure = mock(() => {});
        const manager: StubManager = {
            coupleTrains: mock(() => ({
                success: true as const,
                keepTrainId: 1,
            })),
        };

        const coupler = new AutoCoupler(detector, manager, {
            onSuccess,
            onFailure,
        });
        coupler.update();

        expect(manager.coupleTrains).toHaveBeenCalledTimes(1);
        expect(manager.coupleTrains).toHaveBeenCalledWith(m);
        expect(onSuccess).toHaveBeenCalledTimes(1);
        expect(onFailure).not.toHaveBeenCalled();
    });

    it('skips a match that involves an already-merged train', () => {
        const closest = match(1, 'head', 2, 'head', 3);
        const further = match(2, 'tail', 3, 'head', 6); // shares train 2
        const detector: StubDetector = {
            getInRangeMatches: () => [closest, further],
        };
        const onSuccess = mock(() => {});
        const onFailure = mock(() => {});
        const manager: StubManager = {
            coupleTrains: mock(() => ({
                success: true as const,
                keepTrainId: 1,
            })),
        };

        const coupler = new AutoCoupler(detector, manager, {
            onSuccess,
            onFailure,
        });
        coupler.update();

        // Only the closer match couples; the second is skipped.
        expect(manager.coupleTrains).toHaveBeenCalledTimes(1);
        expect(manager.coupleTrains).toHaveBeenCalledWith(closest);
    });

    it('calls onFailure for depth_exceeded result', () => {
        const m = match(1, 'head', 2, 'head', 4);
        const detector: StubDetector = { getInRangeMatches: () => [m] };
        const onSuccess = mock(() => {});
        const onFailure = mock(() => {});
        const manager: StubManager = {
            coupleTrains: mock(() => ({
                success: false as const,
                reason: 'depth_exceeded' as const,
            })),
        };

        const coupler = new AutoCoupler(detector, manager, {
            onSuccess,
            onFailure,
        });
        coupler.update();

        expect(manager.coupleTrains).toHaveBeenCalledTimes(1);
        expect(onFailure).toHaveBeenCalledTimes(1);
        expect(onFailure).toHaveBeenCalledWith('depth_exceeded');
        expect(onSuccess).not.toHaveBeenCalled();
    });

    it('does not toast for the transient invalid result', () => {
        const m = match(1, 'head', 2, 'head', 4);
        const detector: StubDetector = { getInRangeMatches: () => [m] };
        const onSuccess = mock(() => {});
        const onFailure = mock(() => {});
        const manager: StubManager = {
            coupleTrains: mock(() => ({
                success: false as const,
                reason: 'invalid' as const,
            })),
        };

        const coupler = new AutoCoupler(detector, manager, {
            onSuccess,
            onFailure,
        });
        coupler.update();

        expect(onSuccess).not.toHaveBeenCalled();
        expect(onFailure).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test test/auto-coupler.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create the `AutoCoupler`**

Create `src/trains/auto-coupler.ts`:

```typescript
import type { ProximityMatch } from './proximity-detector';
import type { CoupleResult } from './train-manager';

interface MatchSource {
    getInRangeMatches(): readonly ProximityMatch[];
}

interface CouplerTarget {
    coupleTrains(match: ProximityMatch): CoupleResult;
}

interface AutoCouplerCallbacks {
    onSuccess: () => void;
    onFailure: (reason: 'depth_exceeded') => void;
}

/**
 * Per-frame orchestrator that consumes in-range coupling-approach matches
 * and triggers `coupleTrains()` on the train manager. Matches are processed
 * closest-first; any subsequent match involving a train that has already
 * been merged this frame is skipped.
 *
 * Toast / i18n routing is delegated to `onSuccess` / `onFailure` callbacks
 * so this class stays UI-agnostic and easy to unit-test.
 *
 * @group Train System
 */
export class AutoCoupler {
    private _matchSource: MatchSource;
    private _coupler: CouplerTarget;
    private _callbacks: AutoCouplerCallbacks;

    constructor(
        matchSource: MatchSource,
        coupler: CouplerTarget,
        callbacks: AutoCouplerCallbacks
    ) {
        this._matchSource = matchSource;
        this._coupler = coupler;
        this._callbacks = callbacks;
    }

    /**
     * Process in-range matches for the current frame.
     * Call once per frame, after the detector has been updated and after
     * collision-guard has run.
     */
    update(): void {
        const matches = this._matchSource.getInRangeMatches();
        if (matches.length === 0) return;

        const merged: Set<number> = new Set();
        for (const match of matches) {
            if (merged.has(match.trainA.id) || merged.has(match.trainB.id)) {
                continue;
            }
            const result = this._coupler.coupleTrains(match);
            if (result.success) {
                merged.add(match.trainA.id);
                merged.add(match.trainB.id);
                this._callbacks.onSuccess();
            } else if (result.reason === 'depth_exceeded') {
                this._callbacks.onFailure('depth_exceeded');
            }
            // 'invalid' is a transient race state — ignore silently.
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test test/auto-coupler.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/trains/auto-coupler.ts test/auto-coupler.test.ts
git commit -m "$(
    cat << 'EOF'
feat(trains): add AutoCoupler

Closest-first orchestrator that drains in-range coupling matches each
frame, calls TrainManager.coupleTrains(), and routes success/failure
to UI callbacks. Skips matches touching trains already merged this
frame. UI/i18n stays at the init-app layer.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Add `couplingAutoSuccess` i18n strings

**Files:**

- Modify: `src/i18n/locales/en.ts:385`
- Modify: `src/i18n/locales/zh-TW.ts:366`
- Modify: `src/i18n/locales/ja.ts:303`

- [ ] **Step 1: Add the English string**

In `src/i18n/locales/en.ts`, after the existing `couplingDepthExceeded` entry (around line 386), add:

```typescript
        couplingAutoSuccess: 'Trains coupled',
```

- [ ] **Step 2: Add the Traditional Chinese string**

In `src/i18n/locales/zh-TW.ts`, after the existing `couplingDepthExceeded` entry, add:

```typescript
        couplingAutoSuccess: '列車已連結',
```

- [ ] **Step 3: Add the Japanese string**

In `src/i18n/locales/ja.ts`, after the existing `couplingDepthExceeded` entry (around line 304), add:

```typescript
        couplingAutoSuccess: '列車を連結しました',
```

- [ ] **Step 4: Type-check via test run**

```bash
bun test
```

Expected: full suite still passes (no test consumes these strings yet, but if the locale type uses literal keys, the new key must be present in all locales).

- [ ] **Step 5: Commit**

```bash
git add src/i18n/locales/en.ts src/i18n/locales/zh-TW.ts src/i18n/locales/ja.ts
git commit -m "$(
    cat << 'EOF'
i18n: add couplingAutoSuccess for auto-coupling toast

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Wire it all together in `init-app.ts`

**Files:**

- Modify: `src/utils/init-app.ts:13-17` (imports), `:906-907` (collision wiring), `:1004-1018` (tick callback)

- [ ] **Step 1: Add imports**

Near the existing `import { CollisionGuard, CrossingMap } from '@/trains/collision-guard';` (line 53), add:

```typescript
import { AutoCoupler } from '@/trains/auto-coupler';
```

(`toast` from `sonner` and `i18n` from `@/i18n` are already imported.)

- [ ] **Step 2: Wire the detector into the collision guard**

After the existing `trainRenderSystem.collisionGuard = collisionGuard;` (around line 907), add:

```typescript
collisionGuard.setCouplingApproachDetector(
    trainRenderSystem.couplingApproachDetector
);
```

- [ ] **Step 3: Construct the `AutoCoupler`**

Immediately after the line added in Step 2, add:

```typescript
const autoCoupler = new AutoCoupler(
    trainRenderSystem.couplingApproachDetector,
    trainManager,
    {
        onSuccess: () => {
            toast.success(i18n.t('couplingAutoSuccess'));
        },
        onFailure: reason => {
            if (reason === 'depth_exceeded') {
                toast.warning(i18n.t('couplingDepthExceeded'));
            }
        },
    }
);
```

- [ ] **Step 4: Tick `AutoCoupler` after the render system update**

In the existing `timeManager.subscribe` callback (around line 1005-1017), add the autoCoupler.update() call immediately after `trainRenderSystem.update(deltaTime);`:

```typescript
const unsubTimeManager = timeManager.subscribe(
    (currentTime: number, deltaTime: number) => {
        // Timetable auto-drivers set throttle before physics update
        timetableRef.current.update(currentTime, deltaTime);
        trainRenderSystem.update(deltaTime);
        // Run auto-coupler after physics + detectors + collision-guard.
        // Order matters: detector and collision-guard run inside
        // trainRenderSystem.update(); auto-coupler must run after both.
        autoCoupler.update();
        // Recompute signal aspects from fresh occupancy, then update visuals
        signalStateEngine.update(
            trainRenderSystem.occupancyRegistry,
            trainManager.getPlacedTrains()
        );
        signalRenderSystem.update();
        debugOverlayRenderSystem.updateFormationLabels();
        debugOverlayRenderSystem.updateProximityLines();
    }
);
```

- [ ] **Step 5: Type-check + run all tests**

```bash
bun test
```

Expected: full suite passes.

- [ ] **Step 6: Build to confirm no production-only typing errors**

```bash
bun run build
```

Expected: build completes without errors.

- [ ] **Step 7: Commit**

```bash
git add src/utils/init-app.ts
git commit -m "$(
    cat << 'EOF'
feat(app): wire AutoCoupler and exempt coupling pairs from collision

Constructs AutoCoupler at startup with success/failure toast callbacks
backed by sonner + i18n, ticks it from the timeManager loop after
trainRenderSystem.update() so detector + collision-guard run first.
Also injects the coupling-approach detector into CollisionGuard so
aligned approaches are exempt from Tier 1/2 intervention.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Manual in-browser verification

**Files:** none — exploratory testing only.

This task is not optional. The unit tests cover detector / coupler logic in isolation; only the dev server exercises the integrated tick + collision-guard interaction with real geometry.

- [ ] **Step 1: Start the dev server**

```bash
bun run dev
```

Open the URL printed by Vite in a browser.

- [ ] **Step 2: Place two trains on the same straight track, several segments apart, both stopped facing each other (head-to-head)**

Verify baseline: no auto-couple toast, no collision intervention.

- [ ] **Step 3: Drive one train at low throttle (≤ shunt speed ~2 units/s) toward the other, leading head first**

Expected:

- No emergency-brake intervention as it approaches.
- On contact, the success toast `Trains coupled` appears.
- The two formations merge into one selectable train.
- The merged train has zero speed and can be throttled forward to drive away cleanly.

- [ ] **Step 4: Place fresh trains and try the same approach at full throttle**

Expected:

- Tier 1 emergency brake engages well before contact, train slows.
- If the train is still faster than shunt speed when it would otherwise enter coupling range, Tier 2 fires at ~5 units gap → emergency stop. No couple.
- Wait one frame for lock to clear; the manual "Couple" button appears in the formation editor (existing behavior, unaffected).

- [ ] **Step 5: Decouple a long formation**

Expected:

- Decouple splits into two stopped trains touching at endpoints.
- No auto-couple toast.
- Manual "Couple" button is available (driven by existing `ProximityDetector`).

- [ ] **Step 6: Drive a train toward another with the wrong endpoint orientation**

Drive in reverse so the trailing end approaches the stopped train.

Expected:

- No exemption applies (leading endpoint check fails).
- Collision-guard intervenes normally → emergency stop short of contact. No couple.

- [ ] **Step 7: Drive into a stopped formation that would exceed `MAX_FORMATION_DEPTH` if coupled**

You may need to construct this via the formation editor — couple several formations together first to push depth high.

Expected:

- Failure toast `Cannot couple: formation nesting too deep…` appears once.
- Train continues briefly, collision-guard Tier 2 stops it ~5 units past the contact point.
- No toast spam (toast does not refire on subsequent frames because the moving train is now stopped → rule 1 fails).

- [ ] **Step 8: (Optional) place 2+ stopped trains close together at a junction; drive into them**

Expected:

- Auto-couple fires for the closest match (distance-ascending order).
- Single success toast.
- Other potential match is skipped (target trains involved in the merge).

- [ ] **Step 9: Format check**

```bash
bun run format:check
```

Expected: clean, or run `bun run format` and re-commit if formatting changed.

- [ ] **Step 10: If verification revealed bugs**

Add a regression test in the appropriate `test/*.test.ts` file, fix the underlying code, and commit. **Do not** mark verification complete with known bugs.

- [ ] **Step 11: Final commit (only if formatting changes were made)**

```bash
git add -u
git commit -m "$(
    cat << 'EOF'
chore: format pass

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```
