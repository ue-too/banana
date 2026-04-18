import { describe, expect, it } from 'bun:test';

import {
    normalizedToStop,
    stopToNormalized,
} from '../src/stations/arc-length-resolver';
import type { SpineEntry } from '../src/stations/track-aligned-platform-types';

// Stub BCurve: fullLength = N, linear (t maps directly to length fraction).
const makeCurve = (fullLength: number) => ({ fullLength });

const getCurve = (segmentId: number) => {
    if (segmentId === 10) return makeCurve(100);
    if (segmentId === 11) return makeCurve(50);
    if (segmentId === 12) return makeCurve(200);
    throw new Error(`Unknown segment ${segmentId}`);
};

describe('normalizedToStop', () => {
    it('resolves 0.5 on a single full-range segment to tValue=0.5', () => {
        const spine: SpineEntry[] = [
            { trackSegment: 10, tStart: 0, tEnd: 1, side: 1 },
        ];
        const result = normalizedToStop(spine, 0.5, getCurve);
        expect(result.trackSegmentId).toBe(10);
        expect(result.tValue).toBeCloseTo(0.5, 5);
    });

    it('resolves 0.0 to the start of the first segment', () => {
        const spine: SpineEntry[] = [
            { trackSegment: 10, tStart: 0.2, tEnd: 0.8, side: 1 },
        ];
        const result = normalizedToStop(spine, 0, getCurve);
        expect(result.trackSegmentId).toBe(10);
        expect(result.tValue).toBeCloseTo(0.2, 5);
    });

    it('resolves 1.0 to the end of the last segment', () => {
        const spine: SpineEntry[] = [
            { trackSegment: 10, tStart: 0.2, tEnd: 0.8, side: 1 },
        ];
        const result = normalizedToStop(spine, 1, getCurve);
        expect(result.trackSegmentId).toBe(10);
        expect(result.tValue).toBeCloseTo(0.8, 5);
    });

    it('crosses segment boundaries on a multi-segment spine', () => {
        // seg 10: fullLength=100, tStart=0, tEnd=1 → arc=100
        // seg 11: fullLength=50,  tStart=0, tEnd=1 → arc=50
        // total arc = 150. normalized 0.8 → target arc = 120 → in seg 11 at arc offset 20/50 = 0.4
        const spine: SpineEntry[] = [
            { trackSegment: 10, tStart: 0, tEnd: 1, side: 1 },
            { trackSegment: 11, tStart: 0, tEnd: 1, side: 1 },
        ];
        const result = normalizedToStop(spine, 0.8, getCurve);
        expect(result.trackSegmentId).toBe(11);
        expect(result.tValue).toBeCloseTo(0.4, 5);
    });
});

describe('stopToNormalized', () => {
    it('returns 0.5 for tValue=0.5 on a single full-range segment', () => {
        const spine: SpineEntry[] = [
            { trackSegment: 10, tStart: 0, tEnd: 1, side: 1 },
        ];
        expect(stopToNormalized(spine, 10, 0.5, getCurve)).toBeCloseTo(0.5, 5);
    });

    it('returns 0 for tValue at spine start', () => {
        const spine: SpineEntry[] = [
            { trackSegment: 10, tStart: 0.2, tEnd: 0.8, side: 1 },
        ];
        expect(stopToNormalized(spine, 10, 0.2, getCurve)).toBeCloseTo(0, 5);
    });

    it('returns 1 for tValue at spine end', () => {
        const spine: SpineEntry[] = [
            { trackSegment: 10, tStart: 0.2, tEnd: 0.8, side: 1 },
        ];
        expect(stopToNormalized(spine, 10, 0.8, getCurve)).toBeCloseTo(1, 5);
    });

    it('resolves a stop on the second segment of a multi-segment spine', () => {
        const spine: SpineEntry[] = [
            { trackSegment: 10, tStart: 0, tEnd: 1, side: 1 },
            { trackSegment: 11, tStart: 0, tEnd: 1, side: 1 },
        ];
        // seg 10 arc=100, seg 11 arc=50, total=150.
        // Stop at seg 11, tValue=0.4 → arc from start = 100 + 0.4*50 = 120 → normalized = 120/150 = 0.8
        expect(stopToNormalized(spine, 11, 0.4, getCurve)).toBeCloseTo(0.8, 5);
    });

    it('returns 0 when segment is not in the spine', () => {
        const spine: SpineEntry[] = [
            { trackSegment: 10, tStart: 0, tEnd: 1, side: 1 },
        ];
        expect(stopToNormalized(spine, 99, 0.5, getCurve)).toBe(0);
    });
});
