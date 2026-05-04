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
