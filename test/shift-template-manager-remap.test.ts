import { describe, it, expect } from 'bun:test';
import { ShiftTemplateManager } from '../src/timetable/shift-template-manager';
import { DayOfWeek, type ShiftTemplate } from '../src/timetable/types';
import type { PlatformMigrationMap } from '../src/stations/track-aligned-platform-migration';

function makeTemplate(
    stationId: number,
    platformId: number,
    stopPositionIndex: number,
): ShiftTemplate {
    return {
        id: 'shift-1',
        name: 'Test',
        activeDays: {
            [DayOfWeek.Monday]: true,
            [DayOfWeek.Tuesday]: false,
            [DayOfWeek.Wednesday]: false,
            [DayOfWeek.Thursday]: false,
            [DayOfWeek.Friday]: false,
            [DayOfWeek.Saturday]: false,
            [DayOfWeek.Sunday]: false,
        },
        stops: [
            {
                stationId,
                platformKind: 'trackAligned',
                platformId,
                stopPositionId: stopPositionIndex,
                arrivalTime: null,
                departureTime: 100,
            },
            {
                stationId,
                platformKind: 'trackAligned',
                platformId,
                stopPositionId: stopPositionIndex,
                arrivalTime: 200,
                departureTime: null,
            },
        ],
        legs: [{ routeId: 'r1' }],
    };
}

describe('ShiftTemplateManager.remapTrackAlignedPlatformReferences', () => {
    it('rewrites platformId and stopPositionIndex according to the migration map', () => {
        const mgr = new ShiftTemplateManager();
        mgr.addTemplate(makeTemplate(1, 5, 2));

        const map: PlatformMigrationMap = new Map([
            [
                5,
                new Map([
                    [2, { newPlatformId: 11, newStopIndex: 0, newStopId: 0 }],
                ]),
            ],
        ]);
        mgr.remapTrackAlignedPlatformReferences(map);

        const t = mgr.getTemplate('shift-1')!;
        expect(t.stops[0].platformId).toBe(11);
        expect(t.stops[0].stopPositionId).toBe(0);
        expect(t.stops[1].platformId).toBe(11);
        expect(t.stops[1].stopPositionId).toBe(0);
    });

    it('leaves island-platform stops unchanged', () => {
        const mgr = new ShiftTemplateManager();
        const template = makeTemplate(1, 5, 2);
        template.stops[0].platformKind = 'island';
        mgr.addTemplate(template);

        const map: PlatformMigrationMap = new Map([
            [5, new Map([[2, { newPlatformId: 11, newStopIndex: 0, newStopId: 0 }]])],
        ]);
        mgr.remapTrackAlignedPlatformReferences(map);

        const t = mgr.getTemplate('shift-1')!;
        expect(t.stops[0].platformId).toBe(5);
        expect(t.stops[0].stopPositionId).toBe(2);
    });

    it('leaves unrelated track-aligned stops unchanged', () => {
        const mgr = new ShiftTemplateManager();
        mgr.addTemplate(makeTemplate(1, 99, 0));

        const map: PlatformMigrationMap = new Map([
            [5, new Map([[2, { newPlatformId: 11, newStopIndex: 0, newStopId: 0 }]])],
        ]);
        mgr.remapTrackAlignedPlatformReferences(map);

        const t = mgr.getTemplate('shift-1')!;
        expect(t.stops[0].platformId).toBe(99);
        expect(t.stops[0].stopPositionId).toBe(0);
    });

    it('leaves orphaned stops (newStopIndex === -1) unchanged', () => {
        const mgr = new ShiftTemplateManager();
        mgr.addTemplate(makeTemplate(1, 5, 2));

        const map: PlatformMigrationMap = new Map([
            [5, new Map([[2, { newPlatformId: 11, newStopIndex: -1, newStopId: -1 }]])],
        ]);
        mgr.remapTrackAlignedPlatformReferences(map);

        const t = mgr.getTemplate('shift-1')!;
        expect(t.stops[0].platformId).toBe(5);
        expect(t.stops[0].stopPositionId).toBe(2);
    });
});
