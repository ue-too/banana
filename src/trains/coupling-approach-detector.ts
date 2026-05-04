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
 * "endpoints touching" definition. Keep in sync.
 */
const COUPLING_GAP_TOLERANCE = 0.5;

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
    /**
     * Pair keys (`${lo}:${hi}`) that returned depth_exceeded from a recent
     * couple attempt. Such pairs are *not* exempted or in-range so that
     * collision-guard takes over and stops the moving train. Cleared
     * automatically once the pair stops being colocated (i.e., trains
     * separate).
     */
    private _rejectedPairs: Set<string> = new Set();
    private _candidates: {
        stoppedEnd: 'head' | 'tail';
        stoppedEndPos: TrainPosition;
        stoppedEndPoint: { x: number; y: number };
    }[] = [];

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

        // Drop rejected-pair memory for pairs that have separated.
        if (this._rejectedPairs.size > 0) {
            for (const key of this._rejectedPairs) {
                if (!colocated.has(key)) {
                    this._rejectedPairs.delete(key);
                }
            }
        }

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

    /**
     * Mark a pair as rejected (e.g., depth_exceeded) so future frames
     * do not classify it as exempt or in-range. The flag is cleared
     * automatically when the pair is no longer colocated.
     */
    markRejected(idA: number, idB: number): void {
        const lo = Math.min(idA, idB);
        const hi = Math.max(idA, idB);
        this._rejectedPairs.add(`${lo}:${hi}`);
    }

    private _classifyPair(
        idA: number,
        trainA: Train,
        idB: number,
        trainB: Train
    ): void {
        // If a previous frame's couple attempt failed (depth_exceeded),
        // skip classification. Collision-guard will then handle stopping
        // the moving train normally.
        const lo = Math.min(idA, idB);
        const hi = Math.max(idA, idB);
        if (this._rejectedPairs.has(`${lo}:${hi}`)) return;

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

        // Rule 3: leading endpoint is always the head. `position` is the head
        // and is reassigned by `Train.switchDirection()` whenever a train
        // changes facing — so the head always corresponds to the leading edge
        // of motion, regardless of whether direction is tangent or
        // reverseTangent. There is no path where a moving train approaches
        // another with its tail.
        const movingLeadingPos = movingPos;
        const movingLeadingPoint = movingPos.point;

        const stoppedBogies = stopped.getBogiePositions();
        if (!stoppedBogies || stoppedBogies.length === 0) return;

        // Rule 4: pair the moving leading endpoint with stopped head OR tail,
        // whichever is on the same segment AND closer.
        const stoppedHeadPos = stoppedPos;
        const stoppedTailPos = stoppedBogies[stoppedBogies.length - 1];

        this._candidates.length = 0;
        if (stoppedHeadPos.trackSegment === movingLeadingPos.trackSegment) {
            this._candidates.push({
                stoppedEnd: 'head',
                stoppedEndPos: stoppedHeadPos,
                stoppedEndPoint: stoppedHeadPos.point,
            });
        }
        if (stoppedTailPos.trackSegment === movingLeadingPos.trackSegment) {
            this._candidates.push({
                stoppedEnd: 'tail',
                stoppedEndPos: stoppedTailPos,
                stoppedEndPoint: stoppedTailPos.point,
            });
        }
        if (this._candidates.length === 0) return;

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
        for (const c of this._candidates) {
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
            moving.formation.headCouplerLength +
            (best.stoppedEnd === 'head'
                ? stopped.formation.headCouplerLength
                : stopped.formation.tailCouplerLength) +
            COUPLING_GAP_TOLERANCE;

        const envelope = couplingThreshold * APPROACH_ENVELOPE_MULTIPLIER;
        if (best.distance > envelope) return;

        // Pair qualifies for exemption.
        const pairLo = Math.min(movingId, stoppedId);
        const pairHi = Math.max(movingId, stoppedId);
        this._exemptPairs.add(`${pairLo}:${pairHi}`);

        if (best.distance <= couplingThreshold) {
            this._inRangeMatches.push({
                trainA: { id: movingId, end: 'head' },
                trainB: { id: stoppedId, end: best.stoppedEnd },
                distance: best.distance,
            });
        }
    }
}
