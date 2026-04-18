import { beforeEach, describe, expect, it } from 'bun:test';

import { StationManager } from '../src/stations/station-manager';
import type { Platform } from '../src/stations/types';
import { ShiftTemplateManager } from '../src/timetable/shift-template-manager';
import { DayOfWeek } from '../src/timetable/types';
import { ELEVATION } from '../src/trains/tracks/types';

function makePlatform(track: number): Platform {
    return {
        id: 0,
        track,
        width: 5,
        offset: 1,
        side: 1,
        stopPositions: [
            { id: 0, trackSegmentId: track, direction: 'tangent', tValue: 0.5 },
            {
                id: 1,
                trackSegmentId: track,
                direction: 'reverseTangent',
                tValue: 0.5,
            },
        ],
    };
}

function setupStationWithPlatform(track: number) {
    const mgr = new StationManager();
    const stationId = mgr.createStation({
        name: 'S',
        position: { x: 0, y: 0 },
        elevation: ELEVATION.GROUND,
        platforms: [makePlatform(track)],
        trackSegments: [track],
        joints: [],
        trackAlignedPlatforms: [],
    });
    return { mgr, stationId, platformId: 0 };
}

describe('StationManager stop-position CRUD', () => {
    describe('addStopPosition', () => {
        it('appends a new stop position with a fresh id', () => {
            const { mgr, stationId, platformId } = setupStationWithPlatform(10);
            const newId = mgr.addStopPosition(stationId, platformId, {
                trackSegmentId: 10,
                direction: 'tangent',
                tValue: 0.25,
            });
            expect(newId).toBe(2);
            const platform = mgr.getStation(stationId)!.platforms[0];
            expect(platform.stopPositions).toHaveLength(3);
            expect(platform.stopPositions[2]).toEqual({
                id: 2,
                trackSegmentId: 10,
                direction: 'tangent',
                tValue: 0.25,
            });
        });

        it('throws when the trackSegmentId does not match the platform', () => {
            const { mgr, stationId, platformId } = setupStationWithPlatform(10);
            expect(() =>
                mgr.addStopPosition(stationId, platformId, {
                    trackSegmentId: 99,
                    direction: 'tangent',
                    tValue: 0.5,
                })
            ).toThrow();
        });

        it('throws when tValue is out of [0, 1]', () => {
            const { mgr, stationId, platformId } = setupStationWithPlatform(10);
            expect(() =>
                mgr.addStopPosition(stationId, platformId, {
                    trackSegmentId: 10,
                    direction: 'tangent',
                    tValue: 1.5,
                })
            ).toThrow();
        });
    });

    describe('updateStopPosition', () => {
        it('updates tValue and direction in place', () => {
            const { mgr, stationId, platformId } = setupStationWithPlatform(10);
            mgr.updateStopPosition(stationId, platformId, 0, {
                tValue: 0.8,
                direction: 'reverseTangent',
            });
            const updated =
                mgr.getStation(stationId)!.platforms[0].stopPositions[0];
            expect(updated.tValue).toBe(0.8);
            expect(updated.direction).toBe('reverseTangent');
            expect(updated.id).toBe(0);
        });

        it('throws when the stop id does not exist', () => {
            const { mgr, stationId, platformId } = setupStationWithPlatform(10);
            expect(() =>
                mgr.updateStopPosition(stationId, platformId, 999, {
                    tValue: 0.5,
                })
            ).toThrow();
        });

        it('throws when patch tValue is out of range', () => {
            const { mgr, stationId, platformId } = setupStationWithPlatform(10);
            expect(() =>
                mgr.updateStopPosition(stationId, platformId, 0, {
                    tValue: -0.1,
                })
            ).toThrow();
        });
    });

    describe('removeStopPosition', () => {
        it('removes the stop and preserves remaining ids', () => {
            const { mgr, stationId, platformId } = setupStationWithPlatform(10);
            mgr.removeStopPosition(stationId, platformId, 0);
            const stops = mgr.getStation(stationId)!.platforms[0].stopPositions;
            expect(stops).toHaveLength(1);
            expect(stops[0].id).toBe(1);
        });

        it('subsequent addStopPosition reuses the next id (not a deleted one)', () => {
            const { mgr, stationId, platformId } = setupStationWithPlatform(10);
            mgr.removeStopPosition(stationId, platformId, 0);
            const newId = mgr.addStopPosition(stationId, platformId, {
                trackSegmentId: 10,
                direction: 'tangent',
                tValue: 0.3,
            });
            expect(newId).toBe(2);
        });

        it('is a no-op when the id does not exist', () => {
            const { mgr, stationId, platformId } = setupStationWithPlatform(10);
            expect(() =>
                mgr.removeStopPosition(stationId, platformId, 999)
            ).not.toThrow();
            const stops = mgr.getStation(stationId)!.platforms[0].stopPositions;
            expect(stops).toHaveLength(2);
        });
    });
});

describe('StationManager.findShiftsReferencingStopPosition', () => {
    it('returns templates whose scheduled stops match', () => {
        const { mgr, stationId, platformId } = setupStationWithPlatform(10);
        const stm = new ShiftTemplateManager();
        stm.addTemplate({
            id: 's1',
            name: 'S1',
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
                    platformKind: 'island',
                    platformId,
                    stopPositionId: 0,
                    arrivalTime: null,
                    departureTime: 100,
                },
            ],
            legs: [],
        });

        const refs = mgr.findShiftsReferencingStopPosition(
            stationId,
            platformId,
            0,
            stm
        );
        expect(refs).toHaveLength(1);
        expect(refs[0].id).toBe('s1');
    });

    it('returns empty when no template references the stop', () => {
        const { mgr, stationId, platformId } = setupStationWithPlatform(10);
        const stm = new ShiftTemplateManager();
        const refs = mgr.findShiftsReferencingStopPosition(
            stationId,
            platformId,
            0,
            stm
        );
        expect(refs).toHaveLength(0);
    });
});
