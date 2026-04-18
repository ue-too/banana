import { describe, expect, it } from 'bun:test';

import { StationManager } from '../src/stations/station-manager';
import { TrackAlignedPlatformManager } from '../src/stations/track-aligned-platform-manager';
import type { PlatformMigrationMap } from '../src/stations/track-aligned-platform-migration';
import { ShiftTemplateManager } from '../src/timetable/shift-template-manager';
import type { SerializedShiftTemplate } from '../src/timetable/types';

function makeSerializedTemplate(
    platformId: number,
    stopPositionIndex: number
): SerializedShiftTemplate[] {
    return [
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
                    stationId: 1,
                    platformKind: 'trackAligned',
                    platformId,
                    stopPositionIndex,
                    arrivalTime: null,
                    departureTime: 100,
                },
            ],
            legs: [],
        },
    ];
}

describe('ShiftTemplateManager.deserialize with platformMigrationMap', () => {
    it('rewrites platformId and stopPositionId using the migration map', () => {
        const stationMgr = new StationManager();
        const tapMgr = new TrackAlignedPlatformManager();
        const map: PlatformMigrationMap = new Map([
            [
                5,
                new Map([
                    [2, { newPlatformId: 11, newStopIndex: 0, newStopId: 7 }],
                ]),
            ],
        ]);

        const restored = ShiftTemplateManager.deserialize(
            makeSerializedTemplate(5, 2),
            stationMgr,
            tapMgr,
            map
        );
        const t = restored.getTemplate('s1')!;
        expect(t.stops[0].platformId).toBe(11);
        expect(t.stops[0].stopPositionId).toBe(7);
    });

    it('returns stopPositionId = -1 when migration entry has newStopId = -1 (orphan)', () => {
        const stationMgr = new StationManager();
        const tapMgr = new TrackAlignedPlatformManager();
        const map: PlatformMigrationMap = new Map([
            [
                5,
                new Map([
                    [2, { newPlatformId: 11, newStopIndex: -1, newStopId: -1 }],
                ]),
            ],
        ]);

        const restored = ShiftTemplateManager.deserialize(
            makeSerializedTemplate(5, 2),
            stationMgr,
            tapMgr,
            map
        );
        const t = restored.getTemplate('s1')!;
        expect(t.stops[0].platformId).toBe(11);
        expect(t.stops[0].stopPositionId).toBe(-1);
    });

    it('falls back to direct platform lookup when no migration entry exists', () => {
        const stationMgr = new StationManager();
        const tapMgr = new TrackAlignedPlatformManager();
        // Empty map — no migration.
        const map: PlatformMigrationMap = new Map();

        const restored = ShiftTemplateManager.deserialize(
            makeSerializedTemplate(99, 0),
            stationMgr,
            tapMgr,
            map
        );
        const t = restored.getTemplate('s1')!;
        expect(t.stops[0].platformId).toBe(99);
        // No matching platform either, so stopPositionId is -1 (broken reference).
        expect(t.stops[0].stopPositionId).toBe(-1);
    });
});
