import { describe, it, expect } from 'bun:test';
import {
    buildStopIndex,
    findNearestStop,
    StationPresenceDetector,
    type StopIndexEntry,
    type StationPresence,
    type StationPresenceEvent,
} from '../src/trains/station-presence-detector';
import type { StationManager } from '../src/stations/station-manager';
import type { TrackAlignedPlatformManager } from '../src/stations/track-aligned-platform-manager';
import type { TrackGraph } from '../src/trains/tracks/track';
import type { OccupancyRegistry } from '../src/trains/occupancy-registry';
import type { PlacedTrainEntry } from '../src/trains/train-manager';
import type { Train } from '../src/trains/formation';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStationManager(
    stations: {
        id: number;
        platforms: { id: number; track: number; stopPositions: { id: number; trackSegmentId: number; tValue: number; direction: 'tangent' | 'reverseTangent' }[] }[];
        trackAlignedPlatforms: number[];
    }[],
): StationManager {
    return {
        getStations: () =>
            stations.map((s) => ({
                id: s.id,
                station: {
                    id: s.id,
                    platforms: s.platforms,
                    trackAlignedPlatforms: s.trackAlignedPlatforms,
                },
            })),
    } as unknown as StationManager;
}

function makeTapManager(
    platforms: {
        id: number;
        stationId: number;
        spine: { trackSegment: number }[];
        stopPositions: { id: number; trackSegmentId: number; tValue: number; direction: 'tangent' | 'reverseTangent' }[];
    }[],
): TrackAlignedPlatformManager {
    return {
        getAllPlatforms: () =>
            platforms.map((p) => ({ id: p.id, platform: p })),
    } as unknown as TrackAlignedPlatformManager;
}

/** Stub curve: linear, arc length = fullLength * t. */
function makeCurve(fullLength: number) {
    return {
        fullLength,
        lengthAtT: (t: number) => fullLength * t,
    };
}

function makeGetCurve(map: Record<number, number>) {
    return (segmentId: number) => makeCurve(map[segmentId] ?? 100);
}

function makeTrackGraph(curves: Record<number, number>): TrackGraph {
    return {
        getTrackSegmentCurve: (segmentId: number) => {
            const len = curves[segmentId];
            if (len === undefined) return null;
            return {
                fullLength: len,
                lengthAtT: (t: number) => len * t,
            };
        },
    } as unknown as TrackGraph;
}

function makeTrain(segment: number, tValue: number, speed = 0): Train {
    return {
        position: { trackSegment: segment, tValue, direction: 'tangent', point: { x: 0, y: 0 } },
        speed,
    } as unknown as Train;
}

function makePlaced(entries: { id: number; train: Train }[]): PlacedTrainEntry[] {
    return entries as PlacedTrainEntry[];
}

const nullOccupancy = {} as OccupancyRegistry;

// ---------------------------------------------------------------------------
// Tests: buildStopIndex
// ---------------------------------------------------------------------------

describe('buildStopIndex', () => {
    it('indexes island-platform stop positions by segment', () => {
        const sm = makeStationManager([
            {
                id: 1,
                platforms: [
                    {
                        id: 0,
                        track: 10,
                        stopPositions: [
                            { id: 0, trackSegmentId: 10, tValue: 0.5, direction: 'tangent' },
                        ],
                    },
                ],
                trackAlignedPlatforms: [],
            },
        ]);
        const tapMgr = makeTapManager([]);

        const index = buildStopIndex(sm, tapMgr);
        expect(index.get(10)).toHaveLength(1);
        expect(index.get(10)![0].stationId).toBe(1);
        expect(index.get(10)![0].platformKind).toBe('island');
    });

    it('indexes track-aligned platform stop positions by segment', () => {
        const sm = makeStationManager([
            { id: 1, platforms: [], trackAlignedPlatforms: [5] },
        ]);
        const tapMgr = makeTapManager([
            {
                id: 5,
                stationId: 1,
                spine: [{ trackSegment: 20 }],
                stopPositions: [
                    { id: 0, trackSegmentId: 20, tValue: 0.5, direction: 'tangent' },
                    { id: 1, trackSegmentId: 20, tValue: 0.5, direction: 'reverseTangent' },
                ],
            },
        ]);

        const index = buildStopIndex(sm, tapMgr);
        expect(index.get(20)).toHaveLength(2);
        expect(index.get(20)![0].platformKind).toBe('trackAligned');
    });

    it('returns empty map when no platforms exist', () => {
        const sm = makeStationManager([]);
        const tapMgr = makeTapManager([]);
        const index = buildStopIndex(sm, tapMgr);
        expect(index.size).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Tests: findNearestStop
// ---------------------------------------------------------------------------

describe('findNearestStop', () => {
    it('returns the nearest stop within threshold', () => {
        const entries: StopIndexEntry[] = [
            {
                stationId: 1,
                platformId: 0,
                platformKind: 'island',
                stopPositionId: 0,
                tValue: 0.5,
                direction: 'tangent',
            },
        ];
        const getCurve = makeGetCurve({ 10: 100 });
        // Train at tValue=0.52, stop at 0.5, distance = 2 world units (100 * 0.02).
        const result = findNearestStop(entries, 0.52, 10, getCurve, 5);
        expect(result).not.toBeNull();
        expect(result!.stopPositionId).toBe(0);
    });

    it('returns null when no stop is within threshold', () => {
        const entries: StopIndexEntry[] = [
            {
                stationId: 1,
                platformId: 0,
                platformKind: 'island',
                stopPositionId: 0,
                tValue: 0.5,
                direction: 'tangent',
            },
        ];
        const getCurve = makeGetCurve({ 10: 100 });
        // Train at tValue=0.9, distance = 40 world units. Threshold = 5.
        const result = findNearestStop(entries, 0.9, 10, getCurve, 5);
        expect(result).toBeNull();
    });

    it('picks the closer stop when multiple are within threshold', () => {
        const entries: StopIndexEntry[] = [
            {
                stationId: 1,
                platformId: 0,
                platformKind: 'island',
                stopPositionId: 0,
                tValue: 0.4,
                direction: 'tangent',
            },
            {
                stationId: 1,
                platformId: 0,
                platformKind: 'island',
                stopPositionId: 1,
                tValue: 0.52,
                direction: 'reverseTangent',
            },
        ];
        const getCurve = makeGetCurve({ 10: 100 });
        // Train at 0.5. Stop 0 at 0.4 (dist=10), Stop 1 at 0.52 (dist=2). Threshold=15.
        const result = findNearestStop(entries, 0.5, 10, getCurve, 15);
        expect(result).not.toBeNull();
        expect(result!.stopPositionId).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Tests: StationPresenceDetector
// ---------------------------------------------------------------------------

describe('StationPresenceDetector', () => {
    function makeDetector() {
        const sm = makeStationManager([
            {
                id: 1,
                platforms: [
                    {
                        id: 0,
                        track: 10,
                        stopPositions: [
                            { id: 0, trackSegmentId: 10, tValue: 0.5, direction: 'tangent' },
                        ],
                    },
                ],
                trackAlignedPlatforms: [],
            },
        ]);
        const tapMgr = makeTapManager([]);
        const trackGraph = makeTrackGraph({ 10: 100, 20: 100 });
        return new StationPresenceDetector(sm, tapMgr, trackGraph, 5);
    }

    it('detects a train near a stop position', () => {
        const detector = makeDetector();
        const trains = makePlaced([
            { id: 1, train: makeTrain(10, 0.51) },
        ]);
        detector.update(trains, nullOccupancy);
        const presence = detector.getPresenceForTrain(1);
        expect(presence).not.toBeNull();
        expect(presence!.stationId).toBe(1);
        expect(presence!.stopPositionId).toBe(0);
    });

    it('returns null for a train far from any stop', () => {
        const detector = makeDetector();
        const trains = makePlaced([
            { id: 1, train: makeTrain(10, 0.1) },
        ]);
        detector.update(trains, nullOccupancy);
        expect(detector.getPresenceForTrain(1)).toBeNull();
    });

    it('returns null for a train on a segment with no stops', () => {
        const detector = makeDetector();
        const trains = makePlaced([
            { id: 1, train: makeTrain(20, 0.5) },
        ]);
        detector.update(trains, nullOccupancy);
        expect(detector.getPresenceForTrain(1)).toBeNull();
    });

    it('fires an arrived event when a train enters proximity', () => {
        const detector = makeDetector();
        const events: StationPresenceEvent[] = [];
        detector.subscribe((e) => events.push(e));

        detector.update(makePlaced([{ id: 1, train: makeTrain(10, 0.51) }]), nullOccupancy);

        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('arrived');
        if (events[0].type === 'arrived') {
            expect(events[0].trainId).toBe(1);
            expect(events[0].presence.stationId).toBe(1);
        }
    });

    it('fires a departed event when a train leaves proximity', () => {
        const detector = makeDetector();
        const events: StationPresenceEvent[] = [];

        // Frame 1: train arrives.
        detector.update(makePlaced([{ id: 1, train: makeTrain(10, 0.51) }]), nullOccupancy);
        detector.subscribe((e) => events.push(e));

        // Frame 2: train is gone (empty train list).
        detector.update(makePlaced([]), nullOccupancy);

        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('departed');
        if (events[0].type === 'departed') {
            expect(events[0].trainId).toBe(1);
        }
    });

    it('does not fire events when a train stays at the same stop', () => {
        const detector = makeDetector();

        // Frame 1: arrive.
        detector.update(makePlaced([{ id: 1, train: makeTrain(10, 0.51) }]), nullOccupancy);

        const events: StationPresenceEvent[] = [];
        detector.subscribe((e) => events.push(e));

        // Frame 2: still there.
        detector.update(makePlaced([{ id: 1, train: makeTrain(10, 0.52) }]), nullOccupancy);

        expect(events).toHaveLength(0);
    });

    it('getTrainsAtStation returns matching train ids', () => {
        const detector = makeDetector();
        detector.update(makePlaced([
            { id: 1, train: makeTrain(10, 0.51) },
            { id: 2, train: makeTrain(10, 0.1) },
        ]), nullOccupancy);

        expect(detector.getTrainsAtStation(1)).toEqual([1]);
        expect(detector.getTrainsAtStation(99)).toEqual([]);
    });
});
