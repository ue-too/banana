import { beforeEach, describe, expect, it } from 'bun:test';

import { TrackAlignedPlatformManager } from '../src/stations/track-aligned-platform-manager';
import type { TrackAlignedPlatform } from '../src/stations/track-aligned-platform-types';
import { ShiftTemplateManager } from '../src/timetable/shift-template-manager';
import { DayOfWeek } from '../src/timetable/types';

function makePlatform(): Omit<TrackAlignedPlatform, 'id'> {
    return {
        stationId: 1,
        spine: [
            { trackSegment: 10, tStart: 0.2, tEnd: 0.8, side: 1 },
            { trackSegment: 11, tStart: 0, tEnd: 0.5, side: 1 },
        ],
        offset: 2,
        outerVertices: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
        ],
        stopPositions: [
            { id: 0, trackSegmentId: 10, direction: 'tangent', tValue: 0.5 },
            {
                id: 1,
                trackSegmentId: 10,
                direction: 'reverseTangent',
                tValue: 0.5,
            },
        ],
    };
}

describe('TrackAlignedPlatformManager stop-position CRUD', () => {
    let mgr: TrackAlignedPlatformManager;
    let platformId: number;

    beforeEach(() => {
        mgr = new TrackAlignedPlatformManager();
        platformId = mgr.createPlatform(makePlatform());
    });

    describe('addStopPosition', () => {
        it('appends a stop with a fresh id when input is on a covered segment', () => {
            const newId = mgr.addStopPosition(platformId, {
                trackSegmentId: 11,
                direction: 'tangent',
                tValue: 0.25,
            });
            expect(newId).toBe(2);
            const stops = mgr.getPlatform(platformId)!.stopPositions;
            expect(stops).toHaveLength(3);
            expect(stops[2]).toEqual({
                id: 2,
                trackSegmentId: 11,
                direction: 'tangent',
                tValue: 0.25,
            });
        });

        it('throws when the trackSegmentId is not in the spine', () => {
            expect(() =>
                mgr.addStopPosition(platformId, {
                    trackSegmentId: 99,
                    direction: 'tangent',
                    tValue: 0.5,
                })
            ).toThrow();
        });

        it('throws when tValue is outside the spine entry range', () => {
            // Spine entry for segment 10 is [0.2, 0.8]
            expect(() =>
                mgr.addStopPosition(platformId, {
                    trackSegmentId: 10,
                    direction: 'tangent',
                    tValue: 0.9,
                })
            ).toThrow();
            expect(() =>
                mgr.addStopPosition(platformId, {
                    trackSegmentId: 10,
                    direction: 'tangent',
                    tValue: 0.1,
                })
            ).toThrow();
        });

        it('accepts tValue at the spine entry boundary', () => {
            expect(() =>
                mgr.addStopPosition(platformId, {
                    trackSegmentId: 10,
                    direction: 'tangent',
                    tValue: 0.2,
                })
            ).not.toThrow();
            expect(() =>
                mgr.addStopPosition(platformId, {
                    trackSegmentId: 10,
                    direction: 'tangent',
                    tValue: 0.8,
                })
            ).not.toThrow();
        });
    });

    describe('updateStopPosition', () => {
        it('updates tValue and direction in place', () => {
            mgr.updateStopPosition(platformId, 0, {
                tValue: 0.6,
                direction: 'reverseTangent',
            });
            const stop = mgr.getPlatform(platformId)!.stopPositions[0];
            expect(stop.tValue).toBe(0.6);
            expect(stop.direction).toBe('reverseTangent');
        });

        it('throws when the stop id is not found', () => {
            expect(() =>
                mgr.updateStopPosition(platformId, 999, { tValue: 0.5 })
            ).toThrow();
        });

        it('throws when the new tValue is outside the spine entry range', () => {
            expect(() =>
                mgr.updateStopPosition(platformId, 0, { tValue: 0.9 })
            ).toThrow();
        });
    });

    describe('removeStopPosition', () => {
        it('removes the stop and keeps remaining ids', () => {
            mgr.removeStopPosition(platformId, 0);
            const stops = mgr.getPlatform(platformId)!.stopPositions;
            expect(stops).toHaveLength(1);
            expect(stops[0].id).toBe(1);
        });

        it('subsequent add issues a fresh id (not the deleted one)', () => {
            mgr.removeStopPosition(platformId, 0);
            const newId = mgr.addStopPosition(platformId, {
                trackSegmentId: 10,
                direction: 'tangent',
                tValue: 0.3,
            });
            expect(newId).toBe(2);
        });

        it('is a no-op when the id does not exist', () => {
            expect(() => mgr.removeStopPosition(platformId, 999)).not.toThrow();
            expect(mgr.getPlatform(platformId)!.stopPositions).toHaveLength(2);
        });
    });
});

describe('TrackAlignedPlatformManager.findShiftsReferencingStopPosition', () => {
    it('returns templates whose scheduled stops match', () => {
        const mgr = new TrackAlignedPlatformManager();
        const platformId = mgr.createPlatform(makePlatform());
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
                    stationId: 1,
                    platformKind: 'trackAligned',
                    platformId,
                    stopPositionId: 1,
                    arrivalTime: null,
                    departureTime: 100,
                },
            ],
            legs: [],
        });

        const refs = mgr.findShiftsReferencingStopPosition(platformId, 1, stm);
        expect(refs).toHaveLength(1);
        expect(refs[0].id).toBe('s1');
    });

    it('returns empty when no template references the stop', () => {
        const mgr = new TrackAlignedPlatformManager();
        const platformId = mgr.createPlatform(makePlatform());
        const stm = new ShiftTemplateManager();
        const refs = mgr.findShiftsReferencingStopPosition(platformId, 1, stm);
        expect(refs).toHaveLength(0);
    });

    it('does not match island stops with the same numbers', () => {
        const mgr = new TrackAlignedPlatformManager();
        const platformId = mgr.createPlatform(makePlatform());
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
                    stationId: 1,
                    platformKind: 'island',
                    platformId,
                    stopPositionId: 1,
                    arrivalTime: null,
                    departureTime: 100,
                },
            ],
            legs: [],
        });

        const refs = mgr.findShiftsReferencingStopPosition(platformId, 1, stm);
        expect(refs).toHaveLength(0);
    });
});
