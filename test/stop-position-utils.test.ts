import { describe, expect, it } from 'bun:test';

import {
    assignStopPositionIds,
    nextStopPositionId,
} from '../src/stations/stop-position-utils';
import type { StopPosition } from '../src/stations/types';

describe('nextStopPositionId', () => {
    it('returns 0 for an empty array', () => {
        expect(nextStopPositionId([])).toBe(0);
    });

    it('returns max id + 1 for a non-empty array', () => {
        const stops: StopPosition[] = [
            { id: 4, trackSegmentId: 1, direction: 'tangent', tValue: 0.5 },
            {
                id: 7,
                trackSegmentId: 1,
                direction: 'reverseTangent',
                tValue: 0.5,
            },
        ];
        expect(nextStopPositionId(stops)).toBe(8);
    });

    it('handles non-contiguous ids', () => {
        const stops: StopPosition[] = [
            { id: 0, trackSegmentId: 1, direction: 'tangent', tValue: 0.5 },
            {
                id: 12,
                trackSegmentId: 1,
                direction: 'reverseTangent',
                tValue: 0.5,
            },
            { id: 3, trackSegmentId: 1, direction: 'tangent', tValue: 0.7 },
        ];
        expect(nextStopPositionId(stops)).toBe(13);
    });
});

describe('assignStopPositionIds', () => {
    it('assigns sequential ids starting at 0 to a fresh array', () => {
        const inputs = [
            { trackSegmentId: 1, direction: 'tangent' as const, tValue: 0.5 },
            {
                trackSegmentId: 1,
                direction: 'reverseTangent' as const,
                tValue: 0.5,
            },
        ];
        const result = assignStopPositionIds(inputs);
        expect(result.map(s => s.id)).toEqual([0, 1]);
    });

    it('preserves existing fields verbatim', () => {
        const inputs = [
            { trackSegmentId: 7, direction: 'tangent' as const, tValue: 0.25 },
        ];
        const [stop] = assignStopPositionIds(inputs);
        expect(stop.trackSegmentId).toBe(7);
        expect(stop.direction).toBe('tangent');
        expect(stop.tValue).toBe(0.25);
    });

    it('does not mutate the input objects', () => {
        const inputs = [
            { trackSegmentId: 1, direction: 'tangent' as const, tValue: 0.5 },
        ];
        const result = assignStopPositionIds(inputs);
        expect(result[0]).not.toBe(inputs[0]);
        expect((inputs[0] as { id?: number }).id).toBeUndefined();
    });
});
