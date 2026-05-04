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
            occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
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

    it('returns an in-range match when moving train approaches with leading tail (reverseTangent)', () => {
        // Moving train (id 1) in reverseTangent direction → leading endpoint = tail.
        // Head at t=0.20 (point x=20), tail bogie at t=0.18 (point x=18).
        // Stopped train (id 2) head at t=0.13 (point x=13), tangent direction.
        // Endpoint Euclidean distance from moving tail (x=18) to stopped head (x=13) = 5.
        // Default coupler 3+3+2 = 8. 5 <= 8 → in-range, with stopped end = head.
        const trackGraph = mockTrackGraph(100);
        const detector = new CouplingApproachDetector(trackGraph);

        const moving = mockTrain({
            headPosition: pos(1, 0.2, 'reverseTangent', { x: 20, y: 0 }),
            bogiePositions: [
                pos(1, 0.2, 'reverseTangent', { x: 20, y: 0 }), // head
                pos(1, 0.18, 'tangent', { x: 18, y: 0 }), // tail bogie carries walk-back direction
            ],
            speed: 1,
            occupiedSegments: [
                { trackNumber: 1, inTrackDirection: 'reverseTangent' },
            ],
        });
        const stopped = mockTrain({
            headPosition: pos(1, 0.13, 'tangent', { x: 13, y: 0 }),
            bogiePositions: [pos(1, 0.13, 'tangent', { x: 13, y: 0 })],
            speed: 0,
            occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
        });

        const entries = [entry(1, moving), entry(2, stopped)];
        registry.updateFromTrains(entries);
        detector.update(entries, registry);

        const matches = detector.getInRangeMatches();
        expect(matches).toHaveLength(1);
        expect(matches[0]).toMatchObject({
            trainA: { id: 1, end: 'tail' },
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
            occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
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
            occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
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
            occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
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
            occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
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
        // Rule 4 finds a candidate (stopped head on same segment), but Rule 5
        // (closing speed) returns 0: the moving head is at higher arc, the stopped
        // head is at lower arc, both tangent → "following" with a stopped front
        // train and a moving rear → closing speed = max(0, 0 - 1) = 0.
        const trackGraph = mockTrackGraph(100);
        const detector = new CouplingApproachDetector(trackGraph);

        const moving = mockTrain({
            headPosition: pos(1, 0.2, 'tangent', { x: 20, y: 0 }),
            bogiePositions: [
                pos(1, 0.2, 'tangent', { x: 20, y: 0 }),
                pos(1, 0.18, 'tangent', { x: 18, y: 0 }),
            ],
            speed: 1,
            occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
        });
        const stopped = mockTrain({
            headPosition: pos(1, 0.1, 'tangent', { x: 10, y: 0 }),
            bogiePositions: [pos(1, 0.1, 'tangent', { x: 10, y: 0 })],
            speed: 0,
            occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
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
            occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
        });
        const stopped = mockTrain({
            headPosition: pos(1, 0.15, 'tangent', { x: 15, y: 0 }),
            bogiePositions: [pos(1, 0.15, 'tangent', { x: 15, y: 0 })],
            speed: 0,
            occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
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
            occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
        });
        const stopped = mockTrain({
            headPosition: pos(2, 0.5, 'tangent', { x: 50, y: 0 }),
            bogiePositions: [pos(2, 0.5, 'tangent', { x: 50, y: 0 })],
            speed: 0,
            occupiedJoints: [{ jointNumber: 99, direction: 'tangent' }],
            occupiedSegments: [{ trackNumber: 2, inTrackDirection: 'tangent' }],
        });

        const entries = [entry(1, moving), entry(2, stopped)];
        registry.updateFromTrains(entries);
        detector.update(entries, registry);

        expect(detector.getInRangeMatches()).toHaveLength(0);
        expect(detector.isExempt(1, 2)).toBe(false);
    });

    it('classifies a rejected pair as null (no exemption, no in-range)', () => {
        const trackGraph = mockTrackGraph(100);
        const detector = new CouplingApproachDetector(trackGraph);

        const moving = mockTrain({
            headPosition: pos(1, 0.05, 'tangent', { x: 5, y: 0 }),
            bogiePositions: [pos(1, 0.05, 'tangent', { x: 5, y: 0 })],
            speed: 1,
            occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
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

        // First frame: in-range as expected.
        detector.update(entries, registry);
        expect(detector.getInRangeMatches()).toHaveLength(1);
        expect(detector.isExempt(1, 2)).toBe(true);

        // Reject the pair (simulating AutoCoupler's depth_exceeded callback).
        detector.markRejected(1, 2);

        // Second frame: pair is no longer in-range or exempt.
        detector.update(entries, registry);
        expect(detector.getInRangeMatches()).toHaveLength(0);
        expect(detector.isExempt(1, 2)).toBe(false);
    });

    it('clears rejected memory once the pair is no longer colocated', () => {
        const trackGraph = mockTrackGraph(100);
        const detector = new CouplingApproachDetector(trackGraph);

        const moving = mockTrain({
            headPosition: pos(1, 0.05, 'tangent', { x: 5, y: 0 }),
            bogiePositions: [pos(1, 0.05, 'tangent', { x: 5, y: 0 })],
            speed: 1,
            occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
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
        detector.markRejected(1, 2);

        // Frame 2: still colocated → still rejected.
        detector.update(entries, registry);
        expect(detector.getInRangeMatches()).toHaveLength(0);

        // Move the stopped train away from the moving train's segment.
        const movedAway = mockTrain({
            headPosition: pos(2, 0.5, 'reverseTangent', { x: 50, y: 50 }),
            bogiePositions: [pos(2, 0.5, 'reverseTangent', { x: 50, y: 50 })],
            speed: 0,
            occupiedSegments: [
                { trackNumber: 2, inTrackDirection: 'reverseTangent' },
            ],
        });
        const newEntries = [entry(1, moving), entry(2, movedAway)];
        registry.updateFromTrains(newEntries);
        detector.update(newEntries, registry);

        // Pair is no longer colocated → rejection memory pruned.
        // Bring them back to colocated and verify in-range works again.
        registry.updateFromTrains(entries);
        detector.update(entries, registry);
        expect(detector.getInRangeMatches()).toHaveLength(1);
        expect(detector.isExempt(1, 2)).toBe(true);
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
            occupiedSegments: [{ trackNumber: 1, inTrackDirection: 'tangent' }],
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
        expect(matches).toHaveLength(2);
        // Closer one first.
        expect(matches[0].distance).toBeLessThanOrEqual(matches[1].distance);
    });
});
