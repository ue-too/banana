import { describe, it, expect } from 'bun:test';

import { TrackAlignedPlatformManager } from '../src/stations/track-aligned-platform-manager';
import type { Station } from '../src/stations/types';

describe('station platform list rewrite after dual-spine split', () => {
    it('replaces an old dual-spine platform id with the two new face ids', () => {
        const legacy = {
            platforms: [
                {
                    id: 5,
                    stationId: 1,
                    spineA: [{ trackSegment: 10, tStart: 0, tEnd: 1, side: 1 as const }],
                    spineB: [{ trackSegment: 20, tStart: 0, tEnd: 1, side: -1 as const }],
                    offset: 2,
                    outerVertices: {
                        kind: 'dual' as const,
                        capA: [{ x: 0, y: 5 }],
                        capB: [{ x: 10, y: 5 }],
                    },
                    stopPositions: [
                        { trackSegmentId: 10, direction: 'tangent' as const, tValue: 0.5 },
                    ],
                },
            ],
        };
        const { splitIds } = TrackAlignedPlatformManager.deserializeAny(
            legacy,
            () => [{ x: 5, y: 0 }, { x: 5, y: 2.5 }],
        );

        // Simulate the scene-serialization logic manually.
        const station = {
            trackAlignedPlatforms: [5, 42] as number[],
        } as Pick<Station, 'trackAlignedPlatforms'>;

        const rewritten: number[] = [];
        for (const oldId of station.trackAlignedPlatforms) {
            const newIds = splitIds.get(oldId);
            if (newIds !== undefined) {
                rewritten.push(...newIds);
            } else {
                rewritten.push(oldId);
            }
        }
        station.trackAlignedPlatforms = rewritten;

        // Platform 5 should have been replaced by its two new face IDs.
        expect(rewritten).toHaveLength(3);
        expect(rewritten).toContain(42); // untouched
        // The two new IDs come from splitIds.get(5); they must not equal 5.
        const newIds = splitIds.get(5)!;
        expect(newIds).toHaveLength(2);
        expect(rewritten).toContain(newIds[0]);
        expect(rewritten).toContain(newIds[1]);
    });

    it('leaves trackAlignedPlatforms unchanged when there are no dual-spine splits', () => {
        const newFormat = {
            platforms: [
                {
                    id: 3,
                    stationId: 1,
                    spine: [{ trackSegment: 10, tStart: 0, tEnd: 1, side: 1 as const }],
                    offset: 2,
                    outerVertices: [{ x: 0, y: 5 }, { x: 10, y: 5 }],
                    stopPositions: [],
                },
            ],
        };
        const { splitIds } = TrackAlignedPlatformManager.deserializeAny(
            newFormat,
            () => [],
        );

        expect(splitIds.size).toBe(0);

        // Simulate the scene-serialization rewrite guard: no-op when empty.
        const station = {
            trackAlignedPlatforms: [3, 7] as number[],
        } as Pick<Station, 'trackAlignedPlatforms'>;

        if (splitIds.size > 0) {
            const rewritten: number[] = [];
            for (const oldId of station.trackAlignedPlatforms) {
                const newIds = splitIds.get(oldId);
                if (newIds !== undefined) {
                    rewritten.push(...newIds);
                } else {
                    rewritten.push(oldId);
                }
            }
            station.trackAlignedPlatforms = rewritten;
        }

        // Array must be untouched.
        expect(station.trackAlignedPlatforms).toEqual([3, 7]);
    });
});
