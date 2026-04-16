import { describe, it, expect } from 'bun:test';
import type { Point } from '@ue-too/math';
import { splitLegacyDualSpinePlatform } from '../src/stations/track-aligned-platform-migration';
import type { LegacySerializedTrackAlignedPlatform } from '../src/stations/track-aligned-platform-types';

function makeLegacyDual(): LegacySerializedTrackAlignedPlatform {
    return {
        id: 7,
        stationId: 3,
        spineA: [{ trackSegment: 10, tStart: 0, tEnd: 1, side: 1 }],
        spineB: [{ trackSegment: 20, tStart: 0, tEnd: 1, side: -1 }],
        offset: 2,
        outerVertices: {
            kind: 'dual',
            capA: [{ x: 5, y: 5 }],
            capB: [{ x: 5, y: -5 }],
        },
        stopPositions: [
            { trackSegmentId: 10, direction: 'tangent', tValue: 0.5 },
            { trackSegmentId: 10, direction: 'reverseTangent', tValue: 0.5 },
            { trackSegmentId: 20, direction: 'tangent', tValue: 0.5 },
            { trackSegmentId: 20, direction: 'reverseTangent', tValue: 0.5 },
        ],
    };
}

describe('splitLegacyDualSpinePlatform', () => {
    it('splits a dual-spine record into two single-spine records', () => {
        const legacy = makeLegacyDual();
        const { faceA, faceB } = splitLegacyDualSpinePlatform(
            legacy,
            () => [{ x: 0, y: 0 }, { x: 10, y: 0 }] as Point[],
        );

        expect(faceA.stationId).toBe(3);
        expect(faceA.spine).toEqual(legacy.spineA);
        expect(faceB.spine).toEqual(legacy.spineB);
    });

    it('routes each stop position to the face whose spine contains the segment', () => {
        const legacy = makeLegacyDual();
        const { faceA, faceB } = splitLegacyDualSpinePlatform(
            legacy,
            () => [{ x: 0, y: 0 }, { x: 10, y: 0 }] as Point[],
        );

        expect(faceA.stopPositions.map((s) => s.trackSegmentId)).toEqual([10, 10]);
        expect(faceB.stopPositions.map((s) => s.trackSegmentId)).toEqual([20, 20]);
        expect(faceA.stopPositions.map((s) => s.id)).toEqual([0, 1]);
        expect(faceB.stopPositions.map((s) => s.id)).toEqual([0, 1]);
    });

    it('emits a migration mapping that traces each old stop index to its new face + index', () => {
        const legacy = makeLegacyDual();
        const { stopIndexMap } = splitLegacyDualSpinePlatform(
            legacy,
            () => [{ x: 0, y: 0 }, { x: 10, y: 0 }] as Point[],
        );

        expect(stopIndexMap).toEqual([
            { face: 'A', newIndex: 0, newId: 0 },
            { face: 'A', newIndex: 1, newId: 1 },
            { face: 'B', newIndex: 0, newId: 0 },
            { face: 'B', newIndex: 1, newId: 1 },
        ]);
    });

    it("uses the supplied getMidline to populate each face's outer vertices", () => {
        const legacy = makeLegacyDual();
        const midline: Point[] = [{ x: 1, y: 1 }, { x: 9, y: 1 }];
        const { faceA, faceB } = splitLegacyDualSpinePlatform(legacy, () => midline);
        expect(faceA.outerVertices).toEqual(midline);
        expect(faceB.outerVertices).toEqual(midline);
    });
});
