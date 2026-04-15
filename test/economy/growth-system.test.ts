// test/economy/growth-system.test.ts
import { beforeEach, describe, expect, it } from 'bun:test';

import {
    DECAY_THRESHOLD,
    type EconomyState,
    GROWTH_THRESHOLD,
    SATISFACTION_WINDOW_SIZE,
    type ZoneEntity,
    createEconomyState,
} from '../../src/economy/simulation-state';
import {
    type GrowthEvent,
    runGrowth,
} from '../../src/economy/systems/growth-system';
import { ZoneType } from '../../src/economy/types';

function addZone(
    state: EconomyState,
    type: ZoneType,
    population: number,
    satisfaction: number,
    historyLength: number = SATISFACTION_WINDOW_SIZE
): ZoneEntity {
    const id = state.nextZoneId++;
    const zone: ZoneEntity = {
        id,
        type,
        boundary: [
            { x: 0, y: 0 },
            { x: 200, y: 0 },
            { x: 200, y: 200 },
            { x: 0, y: 200 },
        ],
        population,
        satisfaction,
        satisfactionHistory: Array(historyLength).fill(satisfaction),
        demandPerMinute: new Map(),
    };
    state.zones.set(id, zone);
    return zone;
}

describe('GrowthSystem', () => {
    let state: EconomyState;

    beforeEach(() => {
        state = createEconomyState();
    });

    it('spawns a building when satisfaction is sustained above growth threshold', () => {
        addZone(state, ZoneType.RESIDENTIAL, 5, GROWTH_THRESHOLD + 0.1);
        const events = runGrowth(state);
        const spawns = events.filter(e => e.type === 'spawn');
        expect(spawns.length).toBe(1);
        expect(spawns[0].zoneId).toBe(1);
    });

    it('does not spawn when satisfaction history is too short', () => {
        addZone(state, ZoneType.RESIDENTIAL, 5, GROWTH_THRESHOLD + 0.1, 3);
        const events = runGrowth(state);
        expect(events.filter(e => e.type === 'spawn').length).toBe(0);
    });

    it('abandons a building when satisfaction drops below decay threshold', () => {
        addZone(state, ZoneType.RESIDENTIAL, 5, DECAY_THRESHOLD - 0.1);
        const events = runGrowth(state);
        const abandons = events.filter(e => e.type === 'abandon');
        expect(abandons.length).toBe(1);
    });

    it('does not abandon when population is already zero', () => {
        addZone(state, ZoneType.RESIDENTIAL, 0, DECAY_THRESHOLD - 0.1);
        const events = runGrowth(state);
        expect(events.filter(e => e.type === 'abandon').length).toBe(0);
    });

    it('does nothing in the neutral zone between thresholds', () => {
        addZone(state, ZoneType.RESIDENTIAL, 5, 0.5);
        const events = runGrowth(state);
        expect(events.length).toBe(0);
    });

    it('increases population on spawn', () => {
        const zone = addZone(
            state,
            ZoneType.RESIDENTIAL,
            5,
            GROWTH_THRESHOLD + 0.1
        );
        runGrowth(state);
        expect(zone.population).toBe(6);
    });

    it('decreases population on abandon', () => {
        const zone = addZone(
            state,
            ZoneType.RESIDENTIAL,
            5,
            DECAY_THRESHOLD - 0.1
        );
        runGrowth(state);
        expect(zone.population).toBe(4);
    });
});
