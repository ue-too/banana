import type { OccupancyRegistry } from './occupancy-registry';
import type { PlacedTrainEntry } from './train-manager';
import type { TrackGraph } from './tracks/track';
import type { TrainPosition } from './formation';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Arc-length distance threshold (world units) for an immediate emergency stop. */
const CRITICAL_DISTANCE = 5;

/** Safety margin multiplier applied to the kinematic braking distance for Tier 1 throttle reduction. */
const BRAKING_SAFETY_MARGIN = 1.8;

/** Time window (seconds) within which two trains approaching a crossing are considered a conflict. */
const CROSSING_TIME_WINDOW = 3;

/**
 * Emergency brake deceleration magnitude (world units / s²).
 * Must match the `er` entry in DEFAULT_THROTTLE_STEPS (absolute value).
 */
const EMERGENCY_BRAKE_DECEL = 1.3;

// ---------------------------------------------------------------------------
// CrossingMap
// ---------------------------------------------------------------------------

export type CrossingEntry = {
    crossingSegment: number;
    selfT: number;
    otherT: number;
};

/**
 * Bidirectional registry of track-level crossings.
 * When segment A crosses segment B at (tA, tB), both
 * A→B and B→A entries are maintained so lookups are O(1).
 *
 * @group Train System
 */
export class CrossingMap {
    private _map: Map<number, CrossingEntry[]> = new Map();

    /**
     * Record a crossing between two track segments.
     * Inserts a pair of symmetric entries so both segments know about each other.
     */
    addCrossing(segmentA: number, tA: number, segmentB: number, tB: number): void {
        this._getOrCreate(segmentA).push({ crossingSegment: segmentB, selfT: tA, otherT: tB });
        this._getOrCreate(segmentB).push({ crossingSegment: segmentA, selfT: tB, otherT: tA });
    }

    /**
     * Remove all crossing data for `segmentNumber`, and also remove the
     * back-references in partner segments that pointed to it.
     */
    removeSegment(segmentNumber: number): void {
        const entries = this._map.get(segmentNumber);
        if (entries) {
            for (const entry of entries) {
                const partner = this._map.get(entry.crossingSegment);
                if (partner) {
                    const filtered = partner.filter(e => e.crossingSegment !== segmentNumber);
                    if (filtered.length === 0) {
                        this._map.delete(entry.crossingSegment);
                    } else {
                        this._map.set(entry.crossingSegment, filtered);
                    }
                }
            }
        }
        this._map.delete(segmentNumber);
    }

    /**
     * Return all crossings for a given segment, or an empty array if none exist.
     */
    getCrossings(segmentNumber: number): readonly CrossingEntry[] {
        return this._map.get(segmentNumber) ?? EMPTY_CROSSINGS;
    }

    private _getOrCreate(segmentNumber: number): CrossingEntry[] {
        let arr = this._map.get(segmentNumber);
        if (!arr) {
            arr = [];
            this._map.set(segmentNumber, arr);
        }
        return arr;
    }
}

const EMPTY_CROSSINGS: readonly CrossingEntry[] = [];

// ---------------------------------------------------------------------------
// CollisionGuard
// ---------------------------------------------------------------------------

/**
 * Per-frame collision prevention system.
 *
 * Reads colocated train pairs from {@link OccupancyRegistry} and applies
 * graduated braking interventions:
 *
 * - **Tier 2** (≤ {@link CRITICAL_DISTANCE} world units): `emergencyStop()` on both trains — speed zeroed, train locked.
 * - **Tier 1** (≤ brakingDistance × {@link BRAKING_SAFETY_MARGIN}): `setThrottleStep('er')` on both trains.
 *
 * Trains that are no longer in danger have their collision lock cleared automatically each frame.
 *
 * @group Train System
 */
export class CollisionGuard {
    private _trackGraph: TrackGraph;
    private _crossingMap: CrossingMap;

    /** IDs of trains currently hard-stopped by Tier 2. */
    private _lockedTrains: Set<number> = new Set();

    constructor(trackGraph: TrackGraph, crossingMap: CrossingMap) {
        this._trackGraph = trackGraph;
        this._crossingMap = crossingMap;
    }

    /**
     * Run one frame of collision detection and response.
     * Call after all trains have moved and after `OccupancyRegistry.updateFromTrains()`.
     */
    update(placedTrains: readonly PlacedTrainEntry[], occupancyRegistry: OccupancyRegistry): void {
        // Build a fast ID → entry lookup for this frame.
        const trainMap = new Map<number, PlacedTrainEntry>();
        for (const entry of placedTrains) {
            trainMap.set(entry.id, entry);
        }

        // Track which trains are still in danger this frame so we can clear stale locks.
        const dangerousThisFrame = new Set<number>();

        // --- Same-track detection ---
        const colocatedPairs = occupancyRegistry.getColocatedPairs();
        for (const pairKey of colocatedPairs) {
            const colonIdx = pairKey.indexOf(':');
            const idA = parseInt(pairKey.slice(0, colonIdx), 10);
            const idB = parseInt(pairKey.slice(colonIdx + 1), 10);

            const entryA = trainMap.get(idA);
            const entryB = trainMap.get(idB);
            if (!entryA || !entryB) continue;

            this._checkSameTrack(idA, entryA.train, idB, entryB.train, dangerousThisFrame);
        }

        // --- Crossing detection ---
        this._checkCrossings(placedTrains, occupancyRegistry, trainMap, dangerousThisFrame);

        // --- Clear locks for trains no longer in danger ---
        for (const lockedId of this._lockedTrains) {
            if (!dangerousThisFrame.has(lockedId)) {
                const entry = trainMap.get(lockedId);
                if (entry) {
                    entry.train.clearCollisionLock();
                }
                this._lockedTrains.delete(lockedId);
            }
        }
    }

    // -----------------------------------------------------------------------
    // Same-track detection
    // -----------------------------------------------------------------------

    private _checkSameTrack(
        idA: number,
        trainA: PlacedTrainEntry['train'],
        idB: number,
        trainB: PlacedTrainEntry['train'],
        dangerousThisFrame: Set<number>,
    ): void {
        const posA = trainA.position;
        const posB = trainB.position;
        if (!posA || !posB) return;

        // Both must be on the same segment.
        if (posA.trackSegment !== posB.trackSegment) return;

        // Skip if both stopped.
        if (trainA.speed === 0 && trainB.speed === 0) return;

        const seg = this._trackGraph.getTrackSegmentWithJoints(posA.trackSegment);
        if (!seg) return;

        const arcA = seg.curve.lengthAtT(posA.tValue);
        const arcB = seg.curve.lengthAtT(posB.tValue);

        // Compute closing speed (positive = gap is shrinking). Returns 0 if not closing.
        const closingSpeed = this._closingSpeed(posA, posB, arcA, arcB, trainA.speed, trainB.speed);
        if (closingSpeed <= 0) return;

        // For head-on collisions, head-to-head distance is correct (heads approach each other).
        // For following collisions, the relevant gap is from the rear train's head to the
        // front train's tail (last bogie on this segment). Using head-to-head would miss
        // collisions because the front train's body extends far behind its head.
        const distance = this._effectiveDistance(
            posA, posB, trainA, trainB, arcA, arcB, seg,
        );

        if (distance <= CRITICAL_DISTANCE) {
            // Tier 2: hard stop
            trainA.emergencyStop();
            trainB.emergencyStop();
            this._lockedTrains.add(idA);
            this._lockedTrains.add(idB);
            dangerousThisFrame.add(idA);
            dangerousThisFrame.add(idB);
        } else {
            const brakingDistance = (closingSpeed * closingSpeed) / (2 * EMERGENCY_BRAKE_DECEL);
            if (distance <= brakingDistance * BRAKING_SAFETY_MARGIN) {
                // Tier 1: reduce throttle to emergency brake without locking
                trainA.setThrottleStep('er');
                trainB.setThrottleStep('er');
                dangerousThisFrame.add(idA);
                dangerousThisFrame.add(idB);
            }
        }
    }

    /**
     * Compute the effective collision-relevant distance between two trains.
     *
     * - **Head-on**: both heads approach each other → head-to-head distance.
     * - **Following**: the rear train's head approaches the front train's tail →
     *   distance from rear head to front train's last bogie on this segment.
     *   Returns 0 if already overlapping.
     */
    private _effectiveDistance(
        posA: TrainPosition,
        posB: TrainPosition,
        trainA: PlacedTrainEntry['train'],
        trainB: PlacedTrainEntry['train'],
        arcA: number,
        arcB: number,
        seg: { curve: { lengthAtT(t: number): number } },
    ): number {
        // Head-on: opposite directions → use head-to-head distance.
        if (posA.direction !== posB.direction) {
            return Math.abs(arcA - arcB);
        }

        // Following: same direction. Identify the front and rear trains.
        let rearArc: number;
        let frontTrain: PlacedTrainEntry['train'];
        let frontArc: number;

        if (posA.direction === 'tangent') {
            // Both moving toward higher arc. Lower arc = rear, higher arc = front.
            if (arcA <= arcB) {
                rearArc = arcA;
                frontTrain = trainB;
                frontArc = arcB;
            } else {
                rearArc = arcB;
                frontTrain = trainA;
                frontArc = arcA;
            }
        } else {
            // Both moving toward lower arc. Higher arc = rear, lower arc = front.
            if (arcA >= arcB) {
                rearArc = arcA;
                frontTrain = trainB;
                frontArc = arcB;
            } else {
                rearArc = arcB;
                frontTrain = trainA;
                frontArc = arcA;
            }
        }

        // Find the front train's tail: the last bogie on this segment.
        const frontTailArc = this._tailArcOnSegment(frontTrain, posA.trackSegment, seg);
        if (frontTailArc === null) {
            // Couldn't determine tail → fall back to head-to-head.
            return Math.abs(arcA - arcB);
        }

        // Gap between the rear train's head and the front train's tail.
        const gap = Math.abs(rearArc - frontTailArc);
        return gap;
    }

    /**
     * Find the arc-length of a train's rearmost bogie that is on the given segment.
     * Returns null if bogie positions are unavailable.
     */
    private _tailArcOnSegment(
        train: PlacedTrainEntry['train'],
        segmentNumber: number,
        seg: { curve: { lengthAtT(t: number): number } },
    ): number | null {
        const bogies = train.getBogiePositions();
        if (!bogies || bogies.length === 0) return null;

        // Walk from last bogie backwards to find one on this segment.
        for (let i = bogies.length - 1; i >= 0; i--) {
            if (bogies[i].trackSegment === segmentNumber) {
                return seg.curve.lengthAtT(bogies[i].tValue);
            }
        }

        return null;
    }

    /**
     * Compute the rate at which the gap between two trains on the same segment
     * is closing. Returns a positive value if they are getting closer, or 0 if
     * the gap is steady or growing.
     *
     * Handles two scenarios:
     * - **Head-on**: trains face opposite directions → closing speed = sum of speeds.
     * - **Following**: trains face the same direction → closing speed = rear speed − front speed
     *   (positive only when the rear train is faster).
     *
     * Convention:
     * - `'tangent'` → moving toward higher t-value / arc-length.
     * - `'reverseTangent'` → moving toward lower t-value / arc-length.
     */
    private _closingSpeed(
        posA: TrainPosition,
        posB: TrainPosition,
        arcA: number,
        arcB: number,
        speedA: number,
        speedB: number,
    ): number {
        // Identify which train is lower / higher along the arc.
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

        // Head-on: lower moving up, higher moving down.
        if (lowerDir === 'tangent' && higherDir === 'reverseTangent') {
            return lowerSpeed + higherSpeed;
        }

        // Following in tangent direction: both moving toward higher arc-length.
        // The lower train is behind; closing when it's faster.
        if (lowerDir === 'tangent' && higherDir === 'tangent') {
            return Math.max(0, lowerSpeed - higherSpeed);
        }

        // Following in reverseTangent direction: both moving toward lower arc-length.
        // The higher train is behind; closing when it's faster.
        if (lowerDir === 'reverseTangent' && higherDir === 'reverseTangent') {
            return Math.max(0, higherSpeed - lowerSpeed);
        }

        // Diverging: lower moving down, higher moving up.
        return 0;
    }

    // -----------------------------------------------------------------------
    // Crossing detection
    // -----------------------------------------------------------------------

    private _checkCrossings(
        placedTrains: readonly PlacedTrainEntry[],
        occupancyRegistry: OccupancyRegistry,
        trainMap: Map<number, PlacedTrainEntry>,
        dangerousThisFrame: Set<number>,
    ): void {
        // Build segment → trains lookup (keyed by head position segment).
        const segmentToTrains = new Map<number, { id: number; train: PlacedTrainEntry['train'] }[]>();
        for (const entry of placedTrains) {
            const pos = entry.train.position;
            if (!pos) continue;
            const seg = pos.trackSegment;
            let list = segmentToTrains.get(seg);
            if (!list) {
                list = [];
                segmentToTrains.set(seg, list);
            }
            list.push({ id: entry.id, train: entry.train });
        }

        // Deduplicate pair checks.
        const checkedPairs = new Set<string>();

        for (const [segNum, trainsOnSeg] of segmentToTrains) {
            const crossings = this._crossingMap.getCrossings(segNum);
            if (crossings.length === 0) continue;

            const segData = this._trackGraph.getTrackSegmentWithJoints(segNum);
            if (!segData) continue;

            for (const crossing of crossings) {
                const partnerTrains = segmentToTrains.get(crossing.crossingSegment);
                if (!partnerTrains || partnerTrains.length === 0) continue;

                const partnerSegData = this._trackGraph.getTrackSegmentWithJoints(
                    crossing.crossingSegment,
                );
                if (!partnerSegData) continue;

                for (const trainA of trainsOnSeg) {
                    for (const trainB of partnerTrains) {
                        const smallerId = Math.min(trainA.id, trainB.id);
                        const largerId = Math.max(trainA.id, trainB.id);
                        const pairKey = `${smallerId}:${largerId}`;
                        if (checkedPairs.has(pairKey)) continue;
                        checkedPairs.add(pairKey);

                        const posA = trainA.train.position;
                        const posB = trainB.train.position;
                        if (!posA || !posB) continue;

                        const distA = this._distanceToCrossingOrOccupying(
                            trainA.train, posA, crossing.selfT, segData,
                        );
                        const distB = this._distanceToCrossingOrOccupying(
                            trainB.train, posB, crossing.otherT, partnerSegData,
                        );

                        // If either train is past the crossing AND not occupying it, skip.
                        if (distA === null || distB === null) continue;

                        // Tier 2: both within critical distance → emergencyStop.
                        if (distA <= CRITICAL_DISTANCE && distB <= CRITICAL_DISTANCE) {
                            trainA.train.emergencyStop();
                            trainB.train.emergencyStop();
                            this._lockedTrains.add(trainA.id);
                            this._lockedTrains.add(trainB.id);
                            dangerousThisFrame.add(trainA.id);
                            dangerousThisFrame.add(trainB.id);
                            continue;
                        }

                        // Tier 1a: one train is stopped at/near the crossing — the
                        // other must brake regardless of time-to-arrival.
                        const speedA = trainA.train.speed;
                        const speedB = trainB.train.speed;
                        const aAtCrossing = distA <= CRITICAL_DISTANCE && speedA === 0;
                        const bAtCrossing = distB <= CRITICAL_DISTANCE && speedB === 0;

                        if (aAtCrossing && speedB > 0) {
                            trainB.train.setThrottleStep('er');
                            dangerousThisFrame.add(trainA.id);
                            dangerousThisFrame.add(trainB.id);
                            continue;
                        }
                        if (bAtCrossing && speedA > 0) {
                            trainA.train.setThrottleStep('er');
                            dangerousThisFrame.add(trainA.id);
                            dangerousThisFrame.add(trainB.id);
                            continue;
                        }

                        // Tier 1b: both moving — check time-to-arrival window.
                        if (speedA === 0 || speedB === 0) continue;

                        const timeA = distA / speedA;
                        const timeB = distB / speedB;

                        if (isFinite(timeA) && isFinite(timeB) && Math.abs(timeA - timeB) < CROSSING_TIME_WINDOW) {
                            trainA.train.setThrottleStep('er');
                            trainB.train.setThrottleStep('er');
                            dangerousThisFrame.add(trainA.id);
                            dangerousThisFrame.add(trainB.id);
                        }
                    }
                }
            }
        }
    }

    /**
     * Compute the arc-length distance from a train to a crossing t-value.
     *
     * Returns:
     * - Positive number if the train's head is approaching the crossing
     * - `0` if the train's body is currently occupying the crossing
     *   (head has passed but bogies still span the crossing point)
     * - `null` if the train is entirely past the crossing
     */
    private _distanceToCrossingOrOccupying(
        train: PlacedTrainEntry['train'],
        pos: TrainPosition,
        crossingT: number,
        segData: { curve: { lengthAtT(t: number): number } },
    ): number | null {
        const posLen = segData.curve.lengthAtT(pos.tValue);
        const crossingLen = segData.curve.lengthAtT(crossingT);
        const diff = crossingLen - posLen;

        // Head is approaching the crossing
        if (pos.direction === 'tangent' && diff >= 0) return diff;
        if (pos.direction === 'reverseTangent' && diff <= 0) return -diff;

        // Head has passed — check if the body still covers the crossing.
        // The train's body extends behind the head. If any bogie on this
        // segment is on the other side of the crossing, the train spans it.
        const bogies = train.getBogiePositions();
        if (bogies) {
            for (const bogie of bogies) {
                if (bogie.trackSegment !== pos.trackSegment) continue;
                const bogieLen = segData.curve.lengthAtT(bogie.tValue);
                const bogieDiff = crossingLen - bogieLen;
                // Head and bogie are on opposite sides of the crossing → occupying
                if ((diff < 0 && bogieDiff >= 0) || (diff > 0 && bogieDiff <= 0)) {
                    return 0; // occupying the crossing
                }
            }
        }

        return null; // entirely past
    }
}
