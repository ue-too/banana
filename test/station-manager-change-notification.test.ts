import { describe, expect, it, mock } from 'bun:test';

import { StationManager } from '../src/stations/station-manager';
import { ELEVATION } from '../src/trains/tracks/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStationSeed() {
    return {
        name: 'test',
        position: { x: 0, y: 0 },
        elevation: ELEVATION.GROUND,
        platforms: [],
        trackSegments: [],
        joints: [],
        trackAlignedPlatforms: [] as number[],
    };
}

function makeStationWithPlatform() {
    return {
        ...makeStationSeed(),
        platforms: [
            {
                id: 0,
                track: 5,
                width: 3,
                offset: 2,
                side: 1 as const,
                stopPositions: [],
            },
        ],
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StationManager change notification', () => {
    it('fires onChange when a station is created via createStation', () => {
        const m = new StationManager();
        const listener = mock(() => {});
        m.onChange(listener);
        m.createStation(makeStationSeed());
        expect(listener).toHaveBeenCalled();
    });

    it('fires onChange when a station is created via createStationWithId', () => {
        const m = new StationManager();
        const listener = mock(() => {});
        m.onChange(listener);
        m.createStationWithId(42, { ...makeStationSeed(), id: 42 });
        expect(listener).toHaveBeenCalled();
    });

    it('fires onChange when a station is destroyed', () => {
        const m = new StationManager();
        const id = m.createStation(makeStationSeed());
        const listener = mock(() => {});
        m.onChange(listener);
        m.destroyStation(id);
        expect(listener).toHaveBeenCalled();
    });

    it('fires onChange when a stop position is added', () => {
        const m = new StationManager();
        const id = m.createStation(makeStationWithPlatform());
        const listener = mock(() => {});
        m.onChange(listener);
        m.addStopPosition(id, 0, {
            trackSegmentId: 5,
            direction: 'tangent',
            tValue: 0.5,
        });
        expect(listener).toHaveBeenCalled();
    });

    it('fires onChange when a stop position is updated', () => {
        const m = new StationManager();
        const id = m.createStation(makeStationWithPlatform());
        const stopId = m.addStopPosition(id, 0, {
            trackSegmentId: 5,
            direction: 'tangent',
            tValue: 0.5,
        });
        const listener = mock(() => {});
        m.onChange(listener);
        m.updateStopPosition(id, 0, stopId, { tValue: 0.8 });
        expect(listener).toHaveBeenCalled();
    });

    it('fires onChange when a stop position is removed', () => {
        const m = new StationManager();
        const id = m.createStation(makeStationWithPlatform());
        const stopId = m.addStopPosition(id, 0, {
            trackSegmentId: 5,
            direction: 'tangent',
            tValue: 0.5,
        });
        const listener = mock(() => {});
        m.onChange(listener);
        m.removeStopPosition(id, 0, stopId);
        expect(listener).toHaveBeenCalled();
    });

    it('onChange returns an unsubscribe function that stops notifications', () => {
        const m = new StationManager();
        const listener = mock(() => {});
        const unsubscribe = m.onChange(listener);
        unsubscribe();
        m.createStation(makeStationSeed());
        expect(listener).not.toHaveBeenCalled();
    });

    it('multiple listeners all receive notifications', () => {
        const m = new StationManager();
        const listenerA = mock(() => {});
        const listenerB = mock(() => {});
        m.onChange(listenerA);
        m.onChange(listenerB);
        m.createStation(makeStationSeed());
        expect(listenerA).toHaveBeenCalled();
        expect(listenerB).toHaveBeenCalled();
    });

    it('unsubscribing one listener does not affect others', () => {
        const m = new StationManager();
        const listenerA = mock(() => {});
        const listenerB = mock(() => {});
        const unsubscribeA = m.onChange(listenerA);
        m.onChange(listenerB);
        unsubscribeA();
        m.createStation(makeStationSeed());
        expect(listenerA).not.toHaveBeenCalled();
        expect(listenerB).toHaveBeenCalled();
    });
});
