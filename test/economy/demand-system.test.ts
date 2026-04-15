// test/economy/demand-system.test.ts
import { beforeEach, describe, expect, it } from 'bun:test';

import {
    type EconomyState,
    type ZoneEntity,
    createEconomyState,
} from '../../src/economy/simulation-state';
import { runDemand } from '../../src/economy/systems/demand-system';
import { ResourceType, ZoneType } from '../../src/economy/types';

function addZone(
    state: EconomyState,
    type: ZoneType,
    population: number
): ZoneEntity {
    const id = state.nextZoneId++;
    const zone: ZoneEntity = {
        id,
        type,
        boundary: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
            { x: 0, y: 100 },
        ],
        population,
        satisfaction: 0.5,
        satisfactionHistory: [],
        demandPerMinute: new Map(),
    };
    state.zones.set(id, zone);
    return zone;
}

describe('DemandSystem', () => {
    let state: EconomyState;

    beforeEach(() => {
        state = createEconomyState();
    });

    it('residential zones demand food and goods proportional to population', () => {
        const zone = addZone(state, ZoneType.RESIDENTIAL, 10);
        runDemand(state);
        expect(zone.demandPerMinute.get(ResourceType.FOOD)).toBeGreaterThan(0);
        expect(zone.demandPerMinute.get(ResourceType.GOODS)).toBeGreaterThan(0);
    });

    it('commercial zones demand goods and workers', () => {
        const zone = addZone(state, ZoneType.COMMERCIAL, 10);
        runDemand(state);
        expect(zone.demandPerMinute.get(ResourceType.GOODS)).toBeGreaterThan(0);
        expect(zone.demandPerMinute.get(ResourceType.WORKERS)).toBeGreaterThan(
            0
        );
    });

    it('empty zones have zero demand', () => {
        const zone = addZone(state, ZoneType.RESIDENTIAL, 0);
        runDemand(state);
        expect(zone.demandPerMinute.get(ResourceType.FOOD) ?? 0).toBe(0);
    });

    it('higher population means higher demand', () => {
        const small = addZone(state, ZoneType.RESIDENTIAL, 5);
        const large = addZone(state, ZoneType.RESIDENTIAL, 20);
        runDemand(state);
        const smallFood = small.demandPerMinute.get(ResourceType.FOOD) ?? 0;
        const largeFood = large.demandPerMinute.get(ResourceType.FOOD) ?? 0;
        expect(largeFood).toBeGreaterThan(smallFood);
    });

    it('higher reputation zones demand more (growth spiral)', () => {
        const low = addZone(state, ZoneType.RESIDENTIAL, 10);
        low.satisfaction = 0.2;
        const high = addZone(state, ZoneType.RESIDENTIAL, 10);
        high.satisfaction = 0.9;
        runDemand(state);
        const lowFood = low.demandPerMinute.get(ResourceType.FOOD) ?? 0;
        const highFood = high.demandPerMinute.get(ResourceType.FOOD) ?? 0;
        expect(highFood).toBeGreaterThan(lowFood);
    });
});
