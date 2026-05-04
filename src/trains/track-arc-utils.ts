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
