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

    it('returns higher minus lower when both move reverseTangent and rear is faster', () => {
        // Both reverseTangent → moving toward lower arc.
        // Higher arc = rear, lower arc = front. Rear faster (5 vs 2) → closing speed 3.
        const a = pos(1, 0.5, 'reverseTangent');
        const b = pos(1, 0.1, 'reverseTangent');
        expect(closingSpeed(a, b, lengthAtT(0.5), lengthAtT(0.1), 5, 2)).toBe(
            3
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

    it('falls back to head-to-head distance when front train has no bogies', () => {
        // Both tangent, following direction. trainA at 0.1 (rear), trainB at 0.5 (front).
        // trainB has null bogies → _tailArcOnSegment returns null → fallback to |arcA - arcB| = 40.
        const headA = pos(1, 0.1, 'tangent');
        const headB = pos(1, 0.5, 'tangent');
        const trainA = mockTrain({
            headPosition: headA,
            bogiePositions: [headA],
            speed: 1,
        });
        const trainBNullBogies = {
            getBogiePositions: () => null,
        };
        expect(
            effectiveDistance(
                headA,
                headB,
                trainA,
                trainBNullBogies,
                lengthAtT(0.1),
                lengthAtT(0.5),
                seg
            )
        ).toBe(40);
    });
});
