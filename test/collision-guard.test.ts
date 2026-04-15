import { describe, it, expect, beforeEach } from 'bun:test';
import { CrossingMap, CollisionGuard } from '../src/trains/collision-guard';
import { OccupancyRegistry } from '../src/trains/occupancy-registry';
import type { PlacedTrainEntry } from '../src/trains/train-manager';
import type { Train, TrainPosition, ThrottleSteps } from '../src/trains/formation';
import type { TrackGraph } from '../src/trains/tracks/track';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePosition(
    segment: number,
    tValue: number,
    direction: 'tangent' | 'reverseTangent' = 'tangent',
): TrainPosition {
    return { trackSegment: segment, tValue, direction, point: { x: 0, y: 0 } };
}

function mockTrain(opts: {
    headPosition: TrainPosition | null;
    bogiePositions: TrainPosition[] | null;
    speed?: number;
    occupiedSegments?: { trackNumber: number; inTrackDirection: 'tangent' | 'reverseTangent' }[];
    occupiedJoints?: { jointNumber: number; direction: 'tangent' | 'reverseTangent' }[];
}): Train {
    let speed = opts.speed ?? 0;
    let throttle: ThrottleSteps = 'N';
    let collisionLocked = false;

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
            return collisionLocked;
        },
        occupiedTrackSegments: opts.occupiedSegments ?? [],
        occupiedJointNumbers: opts.occupiedJoints ?? [],
        formation: {
            headCouplerLength: 0,
            tailCouplerLength: 0,
        },
        setThrottleStep(step: ThrottleSteps) {
            if (collisionLocked) return;
            throttle = step;
        },
        emergencyStop() {
            speed = 0;
            throttle = 'er';
            collisionLocked = true;
        },
        clearCollisionLock() {
            collisionLocked = false;
        },
    } as unknown as Train;
}

function entry(id: number, train: Train): PlacedTrainEntry {
    return { id, train };
}

/**
 * Build a mock TrackGraph whose getTrackSegmentWithJoints returns a segment
 * with a curve that maps tValue linearly to arc-length via fullLength.
 *
 * lengthAtT(t) = t * fullLength
 */
function mockTrackGraph(segmentFullLength: number = 100): TrackGraph {
    return {
        getTrackSegmentWithJoints(_segNum: number) {
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
// CrossingMap tests
// ---------------------------------------------------------------------------

describe('CrossingMap', () => {

    let map: CrossingMap;

    beforeEach(() => {
        map = new CrossingMap();
    });

    describe('addCrossing — bidirectional entries', () => {

        it('creates an entry for A referencing B', () => {
            map.addCrossing(1, 0.3, 2, 0.7);
            const crossings = map.getCrossings(1);
            expect(crossings).toHaveLength(1);
            expect(crossings[0]).toMatchObject({ crossingSegment: 2, selfT: 0.3, otherT: 0.7 });
        });

        it('creates a mirrored entry for B referencing A', () => {
            map.addCrossing(1, 0.3, 2, 0.7);
            const crossings = map.getCrossings(2);
            expect(crossings).toHaveLength(1);
            expect(crossings[0]).toMatchObject({ crossingSegment: 1, selfT: 0.7, otherT: 0.3 });
        });

        it('accumulates multiple crossings for the same segment', () => {
            map.addCrossing(1, 0.2, 2, 0.5);
            map.addCrossing(1, 0.8, 3, 0.4);
            expect(map.getCrossings(1)).toHaveLength(2);
            expect(map.getCrossings(2)).toHaveLength(1);
            expect(map.getCrossings(3)).toHaveLength(1);
        });
    });

    describe('getCrossings — unknown segment returns empty array', () => {

        it('returns empty array for a segment with no crossings', () => {
            expect(map.getCrossings(99)).toHaveLength(0);
        });

        it('returns empty readonly array (not undefined)', () => {
            const result = map.getCrossings(42);
            expect(Array.isArray(result)).toBe(true);
            expect(result).toHaveLength(0);
        });
    });

    describe('removeSegment — cleans up both sides', () => {

        it('removes the segment itself', () => {
            map.addCrossing(1, 0.3, 2, 0.7);
            map.removeSegment(1);
            expect(map.getCrossings(1)).toHaveLength(0);
        });

        it('removes back-references from partner segments', () => {
            map.addCrossing(1, 0.3, 2, 0.7);
            map.removeSegment(1);
            expect(map.getCrossings(2)).toHaveLength(0);
        });

        it('removing one segment does not affect unrelated crossings', () => {
            map.addCrossing(10, 0.1, 20, 0.9);
            map.addCrossing(30, 0.5, 40, 0.5);
            map.removeSegment(10);
            expect(map.getCrossings(30)).toHaveLength(1);
            expect(map.getCrossings(40)).toHaveLength(1);
        });

        it('removing a segment with multiple crossings cleans all partners', () => {
            map.addCrossing(1, 0.2, 2, 0.5);
            map.addCrossing(1, 0.8, 3, 0.4);
            map.removeSegment(1);
            expect(map.getCrossings(1)).toHaveLength(0);
            expect(map.getCrossings(2)).toHaveLength(0);
            expect(map.getCrossings(3)).toHaveLength(0);
        });

        it('removeSegment on unknown segment is a no-op', () => {
            expect(() => map.removeSegment(999)).not.toThrow();
        });
    });
});

// ---------------------------------------------------------------------------
// CollisionGuard — same-track detection tests
// ---------------------------------------------------------------------------

describe('CollisionGuard', () => {

    let registry: OccupancyRegistry;
    let crossingMap: CrossingMap;

    beforeEach(() => {
        registry = new OccupancyRegistry();
        crossingMap = new CrossingMap();
    });

    describe('Tier 2 hard stop (distance <= 5)', () => {

        it('calls emergencyStop on both trains when approaching within critical distance', () => {
            // Segment 100 units long. trainA at t=0.04 (arc=4), trainB at t=0.07 (arc=7).
            // Distance = |4-7| = 3 <= 5. trainA tangent (moving up), trainB reverseTangent (moving down) → approaching.
            const trackGraph = mockTrackGraph(100);
            const guard = new CollisionGuard(trackGraph, crossingMap);

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
                occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'reverseTangent' }],
            });

            const entries = [entry(1, trainA), entry(2, trainB)];
            registry.updateFromTrains(entries);
            guard.update(entries, registry);

            expect(trainA.collisionLocked).toBe(true);
            expect(trainA.speed).toBe(0);
            expect(trainA.throttleStep).toBe('er');
            expect(trainB.collisionLocked).toBe(true);
            expect(trainB.speed).toBe(0);
            expect(trainB.throttleStep).toBe('er');
        });
    });

    describe('Tier 1 emergency brake (distance <= brakingDistance * 1.8)', () => {

        it('sets throttle to er on both trains within braking distance', () => {
            // Segment 1000 units long. speed=10. brakingDistance = 10² / (2*1.3) ≈ 38.46.
            // threshold = 38.46 * 1.8 ≈ 69.23 units.
            // trainA at t=0.10 (arc=100), trainB at t=0.15 (arc=150). Distance=50.
            // 50 <= 69.23 but > 5 → Tier 1.
            const trackGraph = mockTrackGraph(1000);
            const guard = new CollisionGuard(trackGraph, crossingMap);

            const trainA = mockTrain({
                headPosition: makePosition(1, 0.10, 'tangent'),
                bogiePositions: [makePosition(1, 0.10, 'tangent')],
                speed: 10,
                occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
            });
            const trainB = mockTrain({
                headPosition: makePosition(1, 0.15, 'reverseTangent'),
                bogiePositions: [makePosition(1, 0.15, 'reverseTangent')],
                speed: 10,
                occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'reverseTangent' }],
            });

            const entries = [entry(1, trainA), entry(2, trainB)];
            registry.updateFromTrains(entries);
            guard.update(entries, registry);

            // Not collision-locked (Tier 1 does NOT call emergencyStop)
            expect(trainA.collisionLocked).toBe(false);
            expect(trainB.collisionLocked).toBe(false);
            // But throttle should be set to 'er'
            expect(trainA.throttleStep).toBe('er');
            expect(trainB.throttleStep).toBe('er');
        });
    });

    describe('No trigger — trains moving apart', () => {

        it('does not intervene when trains are moving away from each other', () => {
            // trainA at t=0.04 moving reverseTangent (away from trainB above it)
            // trainB at t=0.07 moving tangent (away from trainA below it)
            // Distance = 3 <= 5 but NOT approaching → no trigger
            const trackGraph = mockTrackGraph(100);
            const guard = new CollisionGuard(trackGraph, crossingMap);

            const trainA = mockTrain({
                headPosition: makePosition(1, 0.04, 'reverseTangent'),
                bogiePositions: [makePosition(1, 0.04, 'reverseTangent')],
                speed: 5,
                occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'reverseTangent' }],
            });
            const trainB = mockTrain({
                headPosition: makePosition(1, 0.07, 'tangent'),
                bogiePositions: [makePosition(1, 0.07, 'tangent')],
                speed: 5,
                occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
            });

            const entries = [entry(1, trainA), entry(2, trainB)];
            registry.updateFromTrains(entries);
            guard.update(entries, registry);

            expect(trainA.collisionLocked).toBe(false);
            expect(trainB.collisionLocked).toBe(false);
            expect(trainA.throttleStep).toBe('N');
            expect(trainB.throttleStep).toBe('N');
        });
    });

    describe('No trigger — both trains stopped', () => {

        it('skips collision check when both trains have speed === 0', () => {
            const trackGraph = mockTrackGraph(100);
            const guard = new CollisionGuard(trackGraph, crossingMap);

            const trainA = mockTrain({
                headPosition: makePosition(1, 0.04, 'tangent'),
                bogiePositions: [makePosition(1, 0.04, 'tangent')],
                speed: 0,
                occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
            });
            const trainB = mockTrain({
                headPosition: makePosition(1, 0.07, 'reverseTangent'),
                bogiePositions: [makePosition(1, 0.07, 'reverseTangent')],
                speed: 0,
                occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'reverseTangent' }],
            });

            const entries = [entry(1, trainA), entry(2, trainB)];
            registry.updateFromTrains(entries);
            guard.update(entries, registry);

            expect(trainA.collisionLocked).toBe(false);
            expect(trainB.collisionLocked).toBe(false);
        });
    });

    describe('No trigger — trains on different segments', () => {

        it('does not intervene when trains are on different segments (not colocated)', () => {
            const trackGraph = mockTrackGraph(100);
            const guard = new CollisionGuard(trackGraph, crossingMap);

            const trainA = mockTrain({
                headPosition: makePosition(1, 0.04, 'tangent'),
                bogiePositions: [makePosition(1, 0.04, 'tangent')],
                speed: 5,
                occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
            });
            const trainB = mockTrain({
                headPosition: makePosition(2, 0.07, 'reverseTangent'),
                bogiePositions: [makePosition(2, 0.07, 'reverseTangent')],
                speed: 5,
                occupiedSegments: [{ trackNumber: 2, inTrackDirection: 'reverseTangent' }],
            });

            const entries = [entry(1, trainA), entry(2, trainB)];
            registry.updateFromTrains(entries);
            guard.update(entries, registry);

            expect(trainA.collisionLocked).toBe(false);
            expect(trainB.collisionLocked).toBe(false);
        });
    });

    describe('Same-direction following collision', () => {

        it('Tier 2: rear train catches front train within critical distance (both tangent)', () => {
            // Segment 100 units. trainA at t=0.04 (arc=4), trainB at t=0.07 (arc=7).
            // Both tangent. Distance = 3 <= 5. Rear (A) speed=10, front (B) speed=2 → closing.
            const trackGraph = mockTrackGraph(100);
            const guard = new CollisionGuard(trackGraph, crossingMap);

            const trainA = mockTrain({
                headPosition: makePosition(1, 0.04, 'tangent'),
                bogiePositions: [makePosition(1, 0.04, 'tangent')],
                speed: 10,
                occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
            });
            const trainB = mockTrain({
                headPosition: makePosition(1, 0.07, 'tangent'),
                bogiePositions: [makePosition(1, 0.07, 'tangent')],
                speed: 2,
                occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
            });

            const entries = [entry(1, trainA), entry(2, trainB)];
            registry.updateFromTrains(entries);
            guard.update(entries, registry);

            expect(trainA.collisionLocked).toBe(true);
            expect(trainA.speed).toBe(0);
            expect(trainA.throttleStep).toBe('er');
            expect(trainB.collisionLocked).toBe(true);
            expect(trainB.speed).toBe(0);
            expect(trainB.throttleStep).toBe('er');
        });

        it('Tier 2: rear train catches front train within critical distance (both reverseTangent)', () => {
            // Both reverseTangent → moving toward lower arc. trainA at t=0.07 (arc=7), trainB at t=0.04 (arc=4).
            // trainA (higher arc) is behind. Distance = 3 <= 5. A speed=10, B speed=2 → closing.
            const trackGraph = mockTrackGraph(100);
            const guard = new CollisionGuard(trackGraph, crossingMap);

            const trainA = mockTrain({
                headPosition: makePosition(1, 0.07, 'reverseTangent'),
                bogiePositions: [makePosition(1, 0.07, 'reverseTangent')],
                speed: 10,
                occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'reverseTangent' }],
            });
            const trainB = mockTrain({
                headPosition: makePosition(1, 0.04, 'reverseTangent'),
                bogiePositions: [makePosition(1, 0.04, 'reverseTangent')],
                speed: 2,
                occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'reverseTangent' }],
            });

            const entries = [entry(1, trainA), entry(2, trainB)];
            registry.updateFromTrains(entries);
            guard.update(entries, registry);

            expect(trainA.collisionLocked).toBe(true);
            expect(trainA.speed).toBe(0);
            expect(trainB.collisionLocked).toBe(true);
            expect(trainB.speed).toBe(0);
        });

        it('Tier 1: rear train approaching front train within braking distance', () => {
            // Segment 1000 units. Both tangent. trainA at t=0.10 (arc=100), trainB at t=0.15 (arc=150).
            // Distance = 50. Rear speed=10, front speed=2 → closingSpeed=8.
            // brakingDistance = 8² / (2*1.3) ≈ 24.6. threshold = 24.6 * 1.8 ≈ 44.3.
            // 50 > 44.3 → no trigger at these speeds.
            // Use higher speed difference: rear=20, front=2 → closingSpeed=18.
            // brakingDistance = 18² / (2*1.3) ≈ 124.6. threshold ≈ 224.3. 50 <= 224.3 → Tier 1.
            const trackGraph = mockTrackGraph(1000);
            const guard = new CollisionGuard(trackGraph, crossingMap);

            const trainA = mockTrain({
                headPosition: makePosition(1, 0.10, 'tangent'),
                bogiePositions: [makePosition(1, 0.10, 'tangent')],
                speed: 20,
                occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
            });
            const trainB = mockTrain({
                headPosition: makePosition(1, 0.15, 'tangent'),
                bogiePositions: [makePosition(1, 0.15, 'tangent')],
                speed: 2,
                occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
            });

            const entries = [entry(1, trainA), entry(2, trainB)];
            registry.updateFromTrains(entries);
            guard.update(entries, registry);

            expect(trainA.collisionLocked).toBe(false);
            expect(trainB.collisionLocked).toBe(false);
            expect(trainA.throttleStep).toBe('er');
            expect(trainB.throttleStep).toBe('er');
        });

        it('No trigger: front train is faster than rear train (gap growing)', () => {
            // Both tangent. trainA at t=0.04, trainB at t=0.07. Distance=3 <= 5.
            // But rear (A) speed=2, front (B) speed=10 → gap growing, not closing.
            const trackGraph = mockTrackGraph(100);
            const guard = new CollisionGuard(trackGraph, crossingMap);

            const trainA = mockTrain({
                headPosition: makePosition(1, 0.04, 'tangent'),
                bogiePositions: [makePosition(1, 0.04, 'tangent')],
                speed: 2,
                occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
            });
            const trainB = mockTrain({
                headPosition: makePosition(1, 0.07, 'tangent'),
                bogiePositions: [makePosition(1, 0.07, 'tangent')],
                speed: 10,
                occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
            });

            const entries = [entry(1, trainA), entry(2, trainB)];
            registry.updateFromTrains(entries);
            guard.update(entries, registry);

            expect(trainA.collisionLocked).toBe(false);
            expect(trainB.collisionLocked).toBe(false);
            expect(trainA.throttleStep).toBe('N');
            expect(trainB.throttleStep).toBe('N');
        });

        it('No trigger: same speed means gap is constant', () => {
            const trackGraph = mockTrackGraph(100);
            const guard = new CollisionGuard(trackGraph, crossingMap);

            const trainA = mockTrain({
                headPosition: makePosition(1, 0.04, 'tangent'),
                bogiePositions: [makePosition(1, 0.04, 'tangent')],
                speed: 5,
                occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
            });
            const trainB = mockTrain({
                headPosition: makePosition(1, 0.07, 'tangent'),
                bogiePositions: [makePosition(1, 0.07, 'tangent')],
                speed: 5,
                occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
            });

            const entries = [entry(1, trainA), entry(2, trainB)];
            registry.updateFromTrains(entries);
            guard.update(entries, registry);

            expect(trainA.collisionLocked).toBe(false);
            expect(trainB.collisionLocked).toBe(false);
            expect(trainA.throttleStep).toBe('N');
            expect(trainB.throttleStep).toBe('N');
        });

        it('Tier 2: rear train catches stopped front train', () => {
            // Both tangent. trainA at t=0.04 (speed=5), trainB at t=0.07 (speed=0, stopped).
            // Distance = 3 <= 5. closingSpeed = 5-0 = 5 > 0 → Tier 2.
            const trackGraph = mockTrackGraph(100);
            const guard = new CollisionGuard(trackGraph, crossingMap);

            const trainA = mockTrain({
                headPosition: makePosition(1, 0.04, 'tangent'),
                bogiePositions: [makePosition(1, 0.04, 'tangent')],
                speed: 5,
                occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
            });
            const trainB = mockTrain({
                headPosition: makePosition(1, 0.07, 'tangent'),
                bogiePositions: [makePosition(1, 0.07, 'tangent')],
                speed: 0,
                occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
            });

            const entries = [entry(1, trainA), entry(2, trainB)];
            registry.updateFromTrains(entries);
            guard.update(entries, registry);

            expect(trainA.collisionLocked).toBe(true);
            expect(trainA.speed).toBe(0);
            expect(trainB.collisionLocked).toBe(true);
            expect(trainB.speed).toBe(0);
        });
    });

    describe('Following collision with multi-car formations', () => {

        it('Tier 2: rear head is close to front tail despite large head-to-head distance', () => {
            // Segment 1000 units long. Both trains tangent.
            // Front train (B): head at t=0.60 (arc=600), last bogie at t=0.20 (arc=200).
            // Rear train (A): head at t=0.22 (arc=220).
            // Head-to-head distance = 380 (would NOT trigger on its own).
            // But actual gap = rear head (220) to front tail bogie (200) = 20 → well within Tier 1.
            // With closing speed 8 (A=10, B=2): brakingDist = 64/2.6 ≈ 24.6, threshold ≈ 44.3.
            // 20 <= 44.3 → Tier 1 triggers.
            const trackGraph = mockTrackGraph(1000);
            const guard = new CollisionGuard(trackGraph, crossingMap);

            const trainA = mockTrain({
                headPosition: makePosition(1, 0.22, 'tangent'),
                bogiePositions: [makePosition(1, 0.22, 'tangent')],
                speed: 10,
                occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
            });
            const trainB = mockTrain({
                headPosition: makePosition(1, 0.60, 'tangent'),
                bogiePositions: [
                    makePosition(1, 0.60, 'tangent'),
                    makePosition(1, 0.50, 'tangent'),
                    makePosition(1, 0.40, 'tangent'),
                    makePosition(1, 0.20, 'tangent'), // tail bogie
                ],
                speed: 2,
                occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
            });

            const entries = [entry(1, trainA), entry(2, trainB)];
            registry.updateFromTrains(entries);
            guard.update(entries, registry);

            expect(trainA.throttleStep).toBe('er');
            expect(trainB.throttleStep).toBe('er');
        });

        it('Tier 2: rear head already overlapping front body → emergency stop', () => {
            // Front train (B): head at t=0.60 (arc=600), tail bogie at t=0.25 (arc=250).
            // Rear train (A): head at t=0.252 (arc=252).
            // Gap = |252 - 250| = 2 ≤ 5 → Tier 2.
            const trackGraph = mockTrackGraph(1000);
            const guard = new CollisionGuard(trackGraph, crossingMap);

            const trainA = mockTrain({
                headPosition: makePosition(1, 0.252, 'tangent'),
                bogiePositions: [makePosition(1, 0.252, 'tangent')],
                speed: 5,
                occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
            });
            const trainB = mockTrain({
                headPosition: makePosition(1, 0.60, 'tangent'),
                bogiePositions: [
                    makePosition(1, 0.60, 'tangent'),
                    makePosition(1, 0.45, 'tangent'),
                    makePosition(1, 0.25, 'tangent'), // tail bogie
                ],
                speed: 2,
                occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
            });

            const entries = [entry(1, trainA), entry(2, trainB)];
            registry.updateFromTrains(entries);
            guard.update(entries, registry);

            expect(trainA.collisionLocked).toBe(true);
            expect(trainA.speed).toBe(0);
            expect(trainB.collisionLocked).toBe(true);
            expect(trainB.speed).toBe(0);
        });

        it('No trigger for multi-car formation when gap is large enough', () => {
            // Front train (B): head at t=0.80 (arc=800), tail bogie at t=0.45 (arc=450).
            // Rear train (A): head at t=0.10 (arc=100).
            // Gap = |100 - 450| = 350. Closing speed = 8. Threshold ≈ 44.3.
            // 350 > 44.3 → no trigger.
            const trackGraph = mockTrackGraph(1000);
            const guard = new CollisionGuard(trackGraph, crossingMap);

            const trainA = mockTrain({
                headPosition: makePosition(1, 0.10, 'tangent'),
                bogiePositions: [makePosition(1, 0.10, 'tangent')],
                speed: 10,
                occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
            });
            const trainB = mockTrain({
                headPosition: makePosition(1, 0.80, 'tangent'),
                bogiePositions: [
                    makePosition(1, 0.80, 'tangent'),
                    makePosition(1, 0.60, 'tangent'),
                    makePosition(1, 0.45, 'tangent'), // tail bogie
                ],
                speed: 2,
                occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
            });

            const entries = [entry(1, trainA), entry(2, trainB)];
            registry.updateFromTrains(entries);
            guard.update(entries, registry);

            expect(trainA.collisionLocked).toBe(false);
            expect(trainB.collisionLocked).toBe(false);
            expect(trainA.throttleStep).toBe('N');
            expect(trainB.throttleStep).toBe('N');
        });

        it('reverseTangent following: uses front tail for distance', () => {
            // Both reverseTangent. Higher arc = rear.
            // Rear (A): head at t=0.80 (arc=800). Front (B): head at t=0.30 (arc=300), tail bogie at t=0.78 (arc=780).
            // Gap = |800 - 780| = 20. Closing speed = 8. Threshold ≈ 44.3.
            // 20 ≤ 44.3 → Tier 1.
            const trackGraph = mockTrackGraph(1000);
            const guard = new CollisionGuard(trackGraph, crossingMap);

            const trainA = mockTrain({
                headPosition: makePosition(1, 0.80, 'reverseTangent'),
                bogiePositions: [makePosition(1, 0.80, 'reverseTangent')],
                speed: 10,
                occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'reverseTangent' }],
            });
            const trainB = mockTrain({
                headPosition: makePosition(1, 0.30, 'reverseTangent'),
                bogiePositions: [
                    makePosition(1, 0.30, 'reverseTangent'),
                    makePosition(1, 0.50, 'reverseTangent'),
                    makePosition(1, 0.78, 'reverseTangent'), // tail bogie (higher arc, closer to rear)
                ],
                speed: 2,
                occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'reverseTangent' }],
            });

            const entries = [entry(1, trainA), entry(2, trainB)];
            registry.updateFromTrains(entries);
            guard.update(entries, registry);

            expect(trainA.throttleStep).toBe('er');
            expect(trainB.throttleStep).toBe('er');
        });
    });

    describe('Lock clearing', () => {

        it('clears lock for a train that is no longer in danger', () => {
            const trackGraph = mockTrackGraph(100);
            const guard = new CollisionGuard(trackGraph, crossingMap);

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
                occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'reverseTangent' }],
            });

            let entries = [entry(1, trainA), entry(2, trainB)];
            registry.updateFromTrains(entries);
            guard.update(entries, registry);

            // Both should be locked after Tier 2 trigger
            expect(trainA.collisionLocked).toBe(true);
            expect(trainB.collisionLocked).toBe(true);

            // Next frame: remove trainB, only trainA remains
            entries = [entry(1, trainA)];
            registry.updateFromTrains(entries);
            guard.update(entries, registry);

            // TrainA's lock should be cleared since it's no longer in danger
            expect(trainA.collisionLocked).toBe(false);
        });
    });
});

// ---------------------------------------------------------------------------
// CollisionGuard — crossing detection tests
// ---------------------------------------------------------------------------

describe('CollisionGuard — crossing detection', () => {

    let registry: OccupancyRegistry;
    let crossingMap: CrossingMap;

    beforeEach(() => {
        registry = new OccupancyRegistry();
        crossingMap = new CrossingMap();
    });

    it('Tier 1: both trains approach crossing simultaneously within time window → er', () => {
        // Segment 100 units long. Crossing at t=0.5 (arc=50) on both segments.
        // t1 on seg 1 at t=0.3 (arc=30), tangent → dist to crossing = 50-30 = 20, speed=10 → time=2s
        // t2 on seg 2 at t=0.3 (arc=30), tangent → dist to crossing = 50-30 = 20, speed=10 → time=2s
        // |2 - 2| = 0 < 3s window → Tier 1 trigger
        crossingMap.addCrossing(1, 0.5, 2, 0.5);
        const trackGraph = mockTrackGraph(100);
        const guard = new CollisionGuard(trackGraph, crossingMap);

        const t1 = mockTrain({
            headPosition: makePosition(1, 0.3, 'tangent'),
            bogiePositions: [makePosition(1, 0.3, 'tangent')],
            speed: 10,
            occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
        });
        const t2 = mockTrain({
            headPosition: makePosition(2, 0.3, 'tangent'),
            bogiePositions: [makePosition(2, 0.3, 'tangent')],
            speed: 10,
            occupiedSegments: [{ trackNumber: 2, inTrackDirection: 'tangent' }],
        });

        const entries = [entry(1, t1), entry(2, t2)];
        registry.updateFromTrains(entries);
        guard.update(entries, registry);

        expect(t1.throttleStep).toBe('er');
        expect(t2.throttleStep).toBe('er');
        // Tier 1 does NOT collision-lock
        expect(t1.collisionLocked).toBe(false);
        expect(t2.collisionLocked).toBe(false);
    });

    it('No trigger: trains approach crossing at very different times (> 3s window)', () => {
        // t1 on seg 1 at t=0.45 (arc=45), tangent → dist = 50-45 = 5, speed=10 → time=0.5s
        // t2 on seg 2 at t=0.05 (arc=5), tangent → dist = 50-5 = 45, speed=10 → time=4.5s
        // |0.5 - 4.5| = 4 > 3s → no trigger
        crossingMap.addCrossing(1, 0.5, 2, 0.5);
        const trackGraph = mockTrackGraph(100);
        const guard = new CollisionGuard(trackGraph, crossingMap);

        const t1 = mockTrain({
            headPosition: makePosition(1, 0.45, 'tangent'),
            bogiePositions: [makePosition(1, 0.45, 'tangent')],
            speed: 10,
            occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
        });
        const t2 = mockTrain({
            headPosition: makePosition(2, 0.05, 'tangent'),
            bogiePositions: [makePosition(2, 0.05, 'tangent')],
            speed: 10,
            occupiedSegments: [{ trackNumber: 2, inTrackDirection: 'tangent' }],
        });

        const entries = [entry(1, t1), entry(2, t2)];
        registry.updateFromTrains(entries);
        guard.update(entries, registry);

        expect(t1.throttleStep).toBe('N');
        expect(t2.throttleStep).toBe('N');
    });

    it('No trigger: one train moving away from crossing (past it)', () => {
        // t1 on seg 1 at t=0.6, tangent → crossing at 0.5, diff = 50-60 = -10 → null (past crossing)
        // t2 on seg 2 at t=0.3, tangent → approaching, but t1 skips → no trigger
        crossingMap.addCrossing(1, 0.5, 2, 0.5);
        const trackGraph = mockTrackGraph(100);
        const guard = new CollisionGuard(trackGraph, crossingMap);

        const t1 = mockTrain({
            headPosition: makePosition(1, 0.6, 'tangent'),
            bogiePositions: [makePosition(1, 0.6, 'tangent')],
            speed: 10,
            occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
        });
        const t2 = mockTrain({
            headPosition: makePosition(2, 0.3, 'tangent'),
            bogiePositions: [makePosition(2, 0.3, 'tangent')],
            speed: 10,
            occupiedSegments: [{ trackNumber: 2, inTrackDirection: 'tangent' }],
        });

        const entries = [entry(1, t1), entry(2, t2)];
        registry.updateFromTrains(entries);
        guard.update(entries, registry);

        expect(t1.throttleStep).toBe('N');
        expect(t2.throttleStep).toBe('N');
    });

    it('Tier 2: both trains very close to crossing → emergencyStop', () => {
        // Crossing at t=0.5 (arc=50).
        // t1 on seg 1 at t=0.5 (arc=50), tangent → dist = 50-50 = 0 < 5 → critical
        // t2 on seg 2 at t=0.48 (arc=48), tangent → dist = 50-48 = 2 < 5 → critical
        // Both within CRITICAL_DISTANCE → emergencyStop
        crossingMap.addCrossing(1, 0.5, 2, 0.5);
        const trackGraph = mockTrackGraph(100);
        const guard = new CollisionGuard(trackGraph, crossingMap);

        const t1 = mockTrain({
            headPosition: makePosition(1, 0.5, 'tangent'),
            bogiePositions: [makePosition(1, 0.5, 'tangent')],
            speed: 2,
            occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
        });
        const t2 = mockTrain({
            headPosition: makePosition(2, 0.48, 'tangent'),
            bogiePositions: [makePosition(2, 0.48, 'tangent')],
            speed: 2,
            occupiedSegments: [{ trackNumber: 2, inTrackDirection: 'tangent' }],
        });

        const entries = [entry(1, t1), entry(2, t2)];
        registry.updateFromTrains(entries);
        guard.update(entries, registry);

        expect(t1.collisionLocked).toBe(true);
        expect(t1.speed).toBe(0);
        expect(t2.collisionLocked).toBe(true);
        expect(t2.speed).toBe(0);
    });

    it('should brake approaching train when another is stopped at the crossing', () => {
        // Train 1 is stopped at the crossing (speed=0, dist=0)
        // Train 2 is approaching on the other segment (speed=10)
        // Train 2 should get emergency brake even though train 1 is stationary
        crossingMap.addCrossing(1, 0.5, 2, 0.5);
        const trackGraph = mockTrackGraph(100);
        const guard = new CollisionGuard(trackGraph, crossingMap);

        const t1 = mockTrain({
            headPosition: makePosition(1, 0.5, 'tangent'),
            bogiePositions: [makePosition(1, 0.5, 'tangent')],
            speed: 0,
            occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
        });
        const t2 = mockTrain({
            headPosition: makePosition(2, 0.2, 'tangent'),
            bogiePositions: [makePosition(2, 0.2, 'tangent')],
            speed: 10,
            occupiedSegments: [{ trackNumber: 2, inTrackDirection: 'tangent' }],
        });

        const entries = [entry(1, t1), entry(2, t2)];
        registry.updateFromTrains(entries);
        guard.update(entries, registry);

        // Train 2 should be braking, train 1 is already stopped
        expect(t2.throttleStep).toBe('er');
    });

    it('should detect when train body spans the crossing even if head has passed', () => {
        // Crossing at t=0.5 on both segments.
        // Train 1 head at t=0.6 (past crossing) but last bogie at t=0.3 (before crossing)
        // → body spans the crossing point → occupying it (dist = 0)
        // Train 2 approaching on the other segment
        crossingMap.addCrossing(1, 0.5, 2, 0.5);
        const trackGraph = mockTrackGraph(100);
        const guard = new CollisionGuard(trackGraph, crossingMap);

        const t1 = mockTrain({
            headPosition: makePosition(1, 0.6, 'tangent'),
            bogiePositions: [
                makePosition(1, 0.55, 'tangent'), // first bogie, past crossing
                makePosition(1, 0.3, 'tangent'),  // last bogie, before crossing
            ],
            speed: 5,
            occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
        });
        const t2 = mockTrain({
            headPosition: makePosition(2, 0.3, 'tangent'),
            bogiePositions: [makePosition(2, 0.3, 'tangent')],
            speed: 10,
            occupiedSegments: [{ trackNumber: 2, inTrackDirection: 'tangent' }],
        });

        const entries = [entry(1, t1), entry(2, t2)];
        registry.updateFromTrains(entries);
        guard.update(entries, registry);

        // Train 1 body spans crossing (dist=0 ≤ 5) and train 2 approaching (dist=20)
        // → Tier 1b time-based check: t1 time=0 (at crossing), t2 time=2s → |0-2|<3 → brake
        expect(t2.throttleStep).toBe('er');
    });
});
