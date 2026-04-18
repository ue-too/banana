import { describe, expect, it } from 'bun:test';

import { StationManager } from '../src/stations/station-manager';
import { TrackAlignedPlatformManager } from '../src/stations/track-aligned-platform-manager';
import { ShiftTemplateManager } from '../src/timetable/shift-template-manager';
import type { SerializedShiftTemplate } from '../src/timetable/types';
import { ELEVATION } from '../src/trains/tracks/types';

function makeStationWithIslandPlatform() {
    const mgr = new StationManager();
    const id = mgr.createStation({
        name: 'A',
        position: { x: 0, y: 0 },
        elevation: ELEVATION.GROUND,
        platforms: [
            {
                id: 0,
                track: 100,
                width: 5,
                offset: 1,
                side: 1,
                stopPositions: [
                    {
                        id: 5,
                        trackSegmentId: 100,
                        direction: 'tangent',
                        tValue: 0.5,
                    },
                    {
                        id: 8,
                        trackSegmentId: 100,
                        direction: 'reverseTangent',
                        tValue: 0.5,
                    },
                ],
            },
        ],
        trackSegments: [100],
        joints: [],
        trackAlignedPlatforms: [],
    });
    return { mgr, stationId: id };
}

describe('ShiftTemplateManager.deserialize — ScheduledStop id migration', () => {
    it('uses stopPositionId directly when present in the serialized form', () => {
        const { mgr: stationMgr, stationId } = makeStationWithIslandPlatform();
        const tapMgr = new TrackAlignedPlatformManager();

        const serialized: SerializedShiftTemplate[] = [
            {
                id: 's1',
                name: 'S1',
                activeDays: {
                    '0': true,
                    '1': false,
                    '2': false,
                    '3': false,
                    '4': false,
                    '5': false,
                    '6': false,
                },
                stops: [
                    {
                        stationId,
                        platformKind: 'island',
                        platformId: 0,
                        stopPositionId: 8,
                        arrivalTime: null,
                        departureTime: 100,
                    },
                    {
                        stationId,
                        platformKind: 'island',
                        platformId: 0,
                        stopPositionId: 5,
                        arrivalTime: 200,
                        departureTime: null,
                    },
                ],
                legs: [{ routeId: 'r1' }],
            },
        ];

        const restored = ShiftTemplateManager.deserialize(
            serialized,
            stationMgr,
            tapMgr
        );
        const t = restored.getTemplate('s1')!;
        expect(t.stops[0].stopPositionId).toBe(8);
        expect(t.stops[1].stopPositionId).toBe(5);
    });

    it("resolves legacy stopPositionIndex to the platform stop's id", () => {
        const { mgr: stationMgr, stationId } = makeStationWithIslandPlatform();
        const tapMgr = new TrackAlignedPlatformManager();

        const serialized: SerializedShiftTemplate[] = [
            {
                id: 's1',
                name: 'S1',
                activeDays: {
                    '0': true,
                    '1': false,
                    '2': false,
                    '3': false,
                    '4': false,
                    '5': false,
                    '6': false,
                },
                stops: [
                    {
                        stationId,
                        platformKind: 'island',
                        platformId: 0,
                        stopPositionIndex: 0,
                        arrivalTime: null,
                        departureTime: 100,
                    },
                    {
                        stationId,
                        platformKind: 'island',
                        platformId: 0,
                        stopPositionIndex: 1,
                        arrivalTime: 200,
                        departureTime: null,
                    },
                ],
                legs: [{ routeId: 'r1' }],
            },
        ];

        const restored = ShiftTemplateManager.deserialize(
            serialized,
            stationMgr,
            tapMgr
        );
        const t = restored.getTemplate('s1')!;
        // Index 0 → id 5; index 1 → id 8.
        expect(t.stops[0].stopPositionId).toBe(5);
        expect(t.stops[1].stopPositionId).toBe(8);
    });

    it('leaves stopPositionId as -1 when neither id nor a resolvable index is present', () => {
        const { mgr: stationMgr, stationId } = makeStationWithIslandPlatform();
        const tapMgr = new TrackAlignedPlatformManager();

        const serialized: SerializedShiftTemplate[] = [
            {
                id: 's1',
                name: 'S1',
                activeDays: {
                    '0': true,
                    '1': false,
                    '2': false,
                    '3': false,
                    '4': false,
                    '5': false,
                    '6': false,
                },
                stops: [
                    {
                        stationId,
                        platformKind: 'island',
                        platformId: 0,
                        stopPositionIndex: 99,
                        arrivalTime: null,
                        departureTime: 100,
                    },
                ],
                legs: [],
            },
        ];

        const restored = ShiftTemplateManager.deserialize(
            serialized,
            stationMgr,
            tapMgr
        );
        const t = restored.getTemplate('s1')!;
        expect(t.stops[0].stopPositionId).toBe(-1);
    });
});
