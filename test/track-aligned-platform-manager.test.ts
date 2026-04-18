import { beforeEach, describe, expect, it } from 'bun:test';

import { TrackAlignedPlatformManager } from '../src/stations/track-aligned-platform-manager';
import type {
    LegacySerializedTrackAlignedPlatform,
    TrackAlignedPlatform,
} from '../src/stations/track-aligned-platform-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlatform(
    stationId: number,
    segments: number[]
): Omit<TrackAlignedPlatform, 'id'> {
    return {
        stationId,
        spine: segments.map(seg => ({
            trackSegment: seg,
            tStart: 0,
            tEnd: 1,
            side: 1 as const,
        })),
        offset: 2.0,
        outerVertices: [
            { x: 0, y: 5 },
            { x: 10, y: 5 },
        ],
        stopPositions: [],
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TrackAlignedPlatformManager', () => {
    let mgr: TrackAlignedPlatformManager;

    beforeEach(() => {
        mgr = new TrackAlignedPlatformManager();
    });

    // -----------------------------------------------------------------------
    // 1. Create and retrieve
    // -----------------------------------------------------------------------

    describe('createPlatform / getPlatform', () => {
        it('should create a platform and retrieve it by ID', () => {
            const id = mgr.createPlatform(makePlatform(1, [10]));
            const platform = mgr.getPlatform(id);
            expect(platform).not.toBeNull();
            expect(platform!.id).toBe(id);
            expect(platform!.stationId).toBe(1);
            expect(platform!.spine[0].trackSegment).toBe(10);
        });

        it('should assign unique IDs for multiple platforms', () => {
            const a = mgr.createPlatform(makePlatform(1, [10]));
            const b = mgr.createPlatform(makePlatform(1, [11]));
            expect(a).not.toBe(b);
        });

        it('should return null for a non-existent ID', () => {
            expect(mgr.getPlatform(999)).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // 2. Lookup by station ID
    // -----------------------------------------------------------------------

    describe('getPlatformsByStation', () => {
        it('should return platforms for a given station', () => {
            const id1 = mgr.createPlatform(makePlatform(1, [10]));
            const id2 = mgr.createPlatform(makePlatform(1, [11]));
            mgr.createPlatform(makePlatform(2, [12]));

            const results = mgr.getPlatformsByStation(1);
            expect(results.length).toBe(2);
            const ids = results.map(r => r.id);
            expect(ids).toContain(id1);
            expect(ids).toContain(id2);
        });

        it('should return empty array when station has no platforms', () => {
            mgr.createPlatform(makePlatform(1, [10]));
            expect(mgr.getPlatformsByStation(99)).toHaveLength(0);
        });

        it('should isolate platforms per station', () => {
            mgr.createPlatform(makePlatform(1, [10]));
            const id2 = mgr.createPlatform(makePlatform(2, [11]));

            const results = mgr.getPlatformsByStation(2);
            expect(results).toHaveLength(1);
            expect(results[0].id).toBe(id2);
        });
    });

    // -----------------------------------------------------------------------
    // 3. Lookup by segment ID
    // -----------------------------------------------------------------------

    describe('getPlatformsBySegment', () => {
        it('should find platforms via spine segment', () => {
            const id = mgr.createPlatform(makePlatform(1, [10, 11]));
            const results = mgr.getPlatformsBySegment(10);
            expect(results).toHaveLength(1);
            expect(results[0].id).toBe(id);
        });

        it('should not return platforms when segment is not in spine', () => {
            mgr.createPlatform(makePlatform(1, [10]));
            expect(mgr.getPlatformsBySegment(99)).toHaveLength(0);
        });

        it('should return multiple platforms sharing a segment', () => {
            const id1 = mgr.createPlatform(makePlatform(1, [10]));
            const id2 = mgr.createPlatform(makePlatform(2, [10]));
            const results = mgr.getPlatformsBySegment(10);
            expect(results).toHaveLength(2);
            const ids = results.map(r => r.id);
            expect(ids).toContain(id1);
            expect(ids).toContain(id2);
        });
    });

    // -----------------------------------------------------------------------
    // 4. Destroy a platform
    // -----------------------------------------------------------------------

    describe('destroyPlatform', () => {
        it('should remove the platform from getPlatform', () => {
            const id = mgr.createPlatform(makePlatform(1, [10]));
            mgr.destroyPlatform(id);
            expect(mgr.getPlatform(id)).toBeNull();
        });

        it('should remove the platform from station lookup', () => {
            const id = mgr.createPlatform(makePlatform(1, [10]));
            mgr.destroyPlatform(id);
            expect(mgr.getPlatformsByStation(1)).toHaveLength(0);
        });

        it('should remove the platform from segment lookup', () => {
            const id = mgr.createPlatform(makePlatform(1, [10]));
            mgr.destroyPlatform(id);
            expect(mgr.getPlatformsBySegment(10)).toHaveLength(0);
        });

        it('should not affect other platforms when one is destroyed', () => {
            const id1 = mgr.createPlatform(makePlatform(1, [10]));
            const id2 = mgr.createPlatform(makePlatform(1, [11]));
            mgr.destroyPlatform(id1);
            expect(mgr.getPlatform(id2)).not.toBeNull();
            expect(mgr.getPlatformsByStation(1)).toHaveLength(1);
        });
    });

    // -----------------------------------------------------------------------
    // 5. Destroy all platforms for a station
    // -----------------------------------------------------------------------

    describe('destroyPlatformsForStation', () => {
        it('should remove all platforms for the given station', () => {
            mgr.createPlatform(makePlatform(1, [10]));
            mgr.createPlatform(makePlatform(1, [11]));
            mgr.destroyPlatformsForStation(1);
            expect(mgr.getPlatformsByStation(1)).toHaveLength(0);
        });

        it('should not affect platforms for other stations', () => {
            mgr.createPlatform(makePlatform(1, [10]));
            const id2 = mgr.createPlatform(makePlatform(2, [11]));
            mgr.destroyPlatformsForStation(1);
            expect(mgr.getPlatformsByStation(2)).toHaveLength(1);
            expect(mgr.getPlatform(id2)).not.toBeNull();
        });

        it('should be a no-op for a station with no platforms', () => {
            expect(() => mgr.destroyPlatformsForStation(99)).not.toThrow();
        });
    });

    // -----------------------------------------------------------------------
    // 6. Serialize / deserialize round-trip
    // -----------------------------------------------------------------------

    describe('serialize / deserialize', () => {
        it('should round-trip a single-spine platform', () => {
            const id = mgr.createPlatform(makePlatform(1, [10, 11]));
            const data = mgr.serialize();
            const restored = TrackAlignedPlatformManager.deserialize(data);

            const platform = restored.getPlatform(id);
            expect(platform).not.toBeNull();
            expect(platform!.id).toBe(id);
            expect(platform!.stationId).toBe(1);
            expect(platform!.spine).toHaveLength(2);
            expect(platform!.spine[0].trackSegment).toBe(10);
        });

        it('should preserve IDs across round-trip', () => {
            const id1 = mgr.createPlatform(makePlatform(1, [10]));
            const id2 = mgr.createPlatform(makePlatform(2, [11]));
            const data = mgr.serialize();
            const restored = TrackAlignedPlatformManager.deserialize(data);

            expect(restored.getPlatform(id1)).not.toBeNull();
            expect(restored.getPlatform(id2)).not.toBeNull();
            expect(restored.getPlatform(id1)!.stationId).toBe(1);
            expect(restored.getPlatform(id2)!.stationId).toBe(2);
        });

        it('should restore lookups correctly after deserialization', () => {
            mgr.createPlatform(makePlatform(1, [10]));
            const data = mgr.serialize();
            const restored = TrackAlignedPlatformManager.deserialize(data);

            expect(restored.getPlatformsByStation(1)).toHaveLength(1);
            expect(restored.getPlatformsBySegment(10)).toHaveLength(1);
        });

        it('should produce empty data when no platforms exist', () => {
            const data = mgr.serialize();
            expect(data.platforms).toHaveLength(0);
            const restored = TrackAlignedPlatformManager.deserialize(data);
            expect(restored.getPlatformsByStation(1)).toHaveLength(0);
        });
    });

    // -----------------------------------------------------------------------
    // 7. createPlatformWithId / getAllPlatforms
    // -----------------------------------------------------------------------

    describe('createPlatformWithId', () => {
        it('should create a platform at a specific ID', () => {
            mgr.createPlatformWithId(3, makePlatform(1, [10]));
            const platform = mgr.getPlatform(3);
            expect(platform).not.toBeNull();
            expect(platform!.id).toBe(3);
            expect(platform!.stationId).toBe(1);
        });

        it('should be retrievable via station and segment lookups', () => {
            mgr.createPlatformWithId(3, makePlatform(1, [10]));
            expect(mgr.getPlatformsByStation(1)).toHaveLength(1);
            expect(mgr.getPlatformsBySegment(10)).toHaveLength(1);
        });
    });

    describe('getAllPlatforms', () => {
        it('should return empty array when no platforms exist', () => {
            expect(mgr.getAllPlatforms()).toHaveLength(0);
        });

        it('should return all living platforms', () => {
            mgr.createPlatform(makePlatform(1, [10]));
            mgr.createPlatform(makePlatform(2, [11]));
            mgr.createPlatform(makePlatform(3, [12]));
            expect(mgr.getAllPlatforms()).toHaveLength(3);
        });

        it('should not include destroyed platforms', () => {
            const id1 = mgr.createPlatform(makePlatform(1, [10]));
            mgr.createPlatform(makePlatform(2, [11]));
            mgr.destroyPlatform(id1);
            expect(mgr.getAllPlatforms()).toHaveLength(1);
        });
    });

    // -----------------------------------------------------------------------
    // 8. Serialization edge cases
    // -----------------------------------------------------------------------

    describe('serialization edge cases', () => {
        it('should round-trip platforms created with specific IDs', () => {
            mgr.createPlatformWithId(2, makePlatform(1, [10]));
            mgr.createPlatformWithId(5, makePlatform(2, [11]));
            const data = mgr.serialize();
            const restored = TrackAlignedPlatformManager.deserialize(data);

            expect(restored.getPlatform(2)).not.toBeNull();
            expect(restored.getPlatform(5)).not.toBeNull();
            expect(restored.getPlatform(2)!.stationId).toBe(1);
            expect(restored.getPlatform(5)!.stationId).toBe(2);
        });

        it('should preserve multi-segment spines through round-trip', () => {
            const id = mgr.createPlatform(makePlatform(1, [10, 11, 12]));
            const data = mgr.serialize();
            const restored = TrackAlignedPlatformManager.deserialize(data);
            const platform = restored.getPlatform(id)!;

            expect(platform.spine).toHaveLength(3);
            expect(platform.spine[0].trackSegment).toBe(10);
            expect(platform.spine[1].trackSegment).toBe(11);
            expect(platform.spine[2].trackSegment).toBe(12);
        });

        it('should preserve t-values and side through round-trip', () => {
            const platform: Omit<TrackAlignedPlatform, 'id'> = {
                stationId: 1,
                spine: [
                    { trackSegment: 10, tStart: 0.25, tEnd: 0.75, side: -1 },
                ],
                offset: 3.5,
                outerVertices: [{ x: 1, y: 2 }],
                stopPositions: [],
            };
            const id = mgr.createPlatform(platform);
            const data = mgr.serialize();
            const restored = TrackAlignedPlatformManager.deserialize(data);
            const p = restored.getPlatform(id)!;

            expect(p.spine[0].tStart).toBe(0.25);
            expect(p.spine[0].tEnd).toBe(0.75);
            expect(p.spine[0].side).toBe(-1);
            expect(p.offset).toBe(3.5);
        });
    });

    // -----------------------------------------------------------------------
    // 10. Legacy dual-spine migration
    // -----------------------------------------------------------------------

    describe('legacy dual-spine migration', () => {
        it('splits a legacy dual-spine platform into two single-spine platforms', () => {
            const legacyData = {
                platforms: [
                    {
                        id: 5,
                        stationId: 1,
                        spineA: [
                            {
                                trackSegment: 10,
                                tStart: 0,
                                tEnd: 1,
                                side: 1 as const,
                            },
                        ],
                        spineB: [
                            {
                                trackSegment: 20,
                                tStart: 0,
                                tEnd: 1,
                                side: -1 as const,
                            },
                        ],
                        offset: 2,
                        outerVertices: {
                            kind: 'dual' as const,
                            capA: [{ x: 0, y: 5 }],
                            capB: [{ x: 10, y: 5 }],
                        },
                        stopPositions: [
                            {
                                trackSegmentId: 10,
                                direction: 'tangent' as const,
                                tValue: 0.5,
                            },
                            {
                                trackSegmentId: 20,
                                direction: 'tangent' as const,
                                tValue: 0.5,
                            },
                        ],
                    },
                ],
            };
            const { manager, migrationMap } =
                TrackAlignedPlatformManager.deserializeAny(
                    legacyData,
                    (_: LegacySerializedTrackAlignedPlatform) => [
                        { x: 5, y: 0 },
                        { x: 5, y: 2.5 },
                    ]
                );

            const all = manager.getAllPlatforms();
            expect(all).toHaveLength(2);
            expect(
                all.map(p => p.platform.spine[0].trackSegment).sort()
            ).toEqual([10, 20]);

            // Migration map records where each legacy index ended up.
            const entries = migrationMap.get(5);
            expect(entries).toBeDefined();
            expect(entries!.size).toBe(2);
        });

        it('populates splitIds with the two new face IDs for each split dual-spine platform', () => {
            const legacyData = {
                platforms: [
                    {
                        id: 5,
                        stationId: 1,
                        spineA: [
                            {
                                trackSegment: 10,
                                tStart: 0,
                                tEnd: 1,
                                side: 1 as const,
                            },
                        ],
                        spineB: [
                            {
                                trackSegment: 20,
                                tStart: 0,
                                tEnd: 1,
                                side: -1 as const,
                            },
                        ],
                        offset: 2,
                        outerVertices: {
                            kind: 'dual' as const,
                            capA: [{ x: 0, y: 5 }],
                            capB: [{ x: 10, y: 5 }],
                        },
                        stopPositions: [
                            {
                                trackSegmentId: 10,
                                direction: 'tangent' as const,
                                tValue: 0.5,
                            },
                        ],
                    },
                ],
            };
            const { manager, splitIds } =
                TrackAlignedPlatformManager.deserializeAny(legacyData, () => [
                    { x: 5, y: 0 },
                    { x: 5, y: 2.5 },
                ]);

            expect(splitIds.size).toBe(1);

            const newIds = splitIds.get(5);
            expect(newIds).toBeDefined();
            expect(newIds).toHaveLength(2);

            const allPlatformIds = manager.getAllPlatforms().map(p => p.id);
            expect(allPlatformIds).toContain(newIds![0]);
            expect(allPlatformIds).toContain(newIds![1]);
            // New IDs must not equal the old ID.
            expect(newIds![0]).not.toBe(5);
            expect(newIds![1]).not.toBe(5);
        });

        it('reads the new format unchanged (empty migration map)', () => {
            const newData = {
                platforms: [
                    {
                        id: 3,
                        stationId: 1,
                        spine: [
                            {
                                trackSegment: 10,
                                tStart: 0,
                                tEnd: 1,
                                side: 1 as const,
                            },
                        ],
                        offset: 2,
                        outerVertices: [
                            { x: 0, y: 5 },
                            { x: 10, y: 5 },
                        ],
                        stopPositions: [
                            {
                                id: 0,
                                trackSegmentId: 10,
                                direction: 'tangent' as const,
                                tValue: 0.5,
                            },
                        ],
                    },
                ],
            };
            const { manager, migrationMap, splitIds } =
                TrackAlignedPlatformManager.deserializeAny(newData, () => []);
            expect(manager.getAllPlatforms()).toHaveLength(1);
            expect(migrationMap.size).toBe(0);
            expect(splitIds.size).toBe(0);
        });

        it('reads a legacy single-spine platform and preserves its id', () => {
            const legacySingle = {
                platforms: [
                    {
                        id: 8,
                        stationId: 2,
                        spineA: [
                            {
                                trackSegment: 15,
                                tStart: 0,
                                tEnd: 1,
                                side: 1 as const,
                            },
                        ],
                        spineB: null,
                        offset: 1.5,
                        outerVertices: {
                            kind: 'single' as const,
                            vertices: [{ x: 2, y: 4 }],
                        },
                        stopPositions: [
                            {
                                trackSegmentId: 15,
                                direction: 'tangent' as const,
                                tValue: 0.3,
                            },
                        ],
                    },
                ],
            };
            const { manager, migrationMap } =
                TrackAlignedPlatformManager.deserializeAny(
                    legacySingle,
                    () => []
                );
            const p = manager.getPlatform(8);
            expect(p).not.toBeNull();
            expect(p!.spine[0].trackSegment).toBe(15);
            expect(p!.outerVertices).toEqual([{ x: 2, y: 4 }]);
            expect(migrationMap.size).toBe(0);
        });
    });
});
