// test/economy/simulation-tick.test.ts
import { beforeEach, describe, expect, it } from 'bun:test';

import {
    DEFAULT_SERVICE_RADIUS,
    type EconomyState,
    type IndustryEntity,
    SATISFACTION_WINDOW_SIZE,
    type StationEconomyData,
    type ZoneEntity,
    createEconomyState,
} from '../../src/economy/simulation-state';
import { simulationTick } from '../../src/economy/simulation-tick';
import { Stockpile } from '../../src/economy/stockpile';
import type { ZoneStationLookup } from '../../src/economy/systems/transfer-system';
import { IndustryType, ResourceType, ZoneType } from '../../src/economy/types';

function addStationEconomy(
    state: EconomyState,
    stationId: number
): StationEconomyData {
    const data: StationEconomyData = {
        stationId,
        stockpile: new Stockpile(),
        serviceRadius: DEFAULT_SERVICE_RADIUS,
        loadRules: new Set(),
        unloadRules: new Set(),
        autoMode: false,
    };
    state.stationEconomy.set(stationId, data);
    return data;
}

function addIndustry(
    state: EconomyState,
    type: IndustryType,
    stationId: number,
    workers: number
): IndustryEntity {
    const id = state.nextIndustryId++;
    const industry: IndustryEntity = {
        id,
        type,
        position: { x: 0, y: 0 },
        assignedStationId: stationId,
        workerCount: workers,
        stockpile: new Stockpile(),
    };
    state.industries.set(id, industry);
    return industry;
}

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

const getZoneStation: ZoneStationLookup = () => 1;

describe('simulationTick (integration)', () => {
    let state: EconomyState;

    beforeEach(() => {
        state = createEconomyState();
    });

    it('runs all four pipeline steps without error', () => {
        addStationEconomy(state, 1);
        addIndustry(state, IndustryType.FARM, 1, 5);
        addZone(state, ZoneType.RESIDENTIAL, 5);
        const events = simulationTick(state, 1, getZoneStation);
        expect(Array.isArray(events)).toBe(true);
    });

    it('farm produces food that gets delivered to residential zone', () => {
        addStationEconomy(state, 1);
        addIndustry(state, IndustryType.FARM, 1, 5);
        const zone = addZone(state, ZoneType.RESIDENTIAL, 5);
        for (let i = 0; i < 5; i++) {
            simulationTick(state, 1, getZoneStation);
        }
        expect(zone.demandPerMinute.size).toBeGreaterThan(0);
        expect(zone.satisfactionHistory.length).toBeGreaterThan(0);
    });

    it('full loop: production -> demand -> transfer -> growth over many ticks', () => {
        const station = addStationEconomy(state, 1);
        addIndustry(state, IndustryType.FARM, 1, 5);
        const zone = addZone(state, ZoneType.RESIDENTIAL, 3);
        station.stockpile.add(ResourceType.FOOD, 10000);
        station.stockpile.add(ResourceType.GOODS, 10000);
        const initialPop = zone.population;
        for (let i = 0; i < SATISFACTION_WINDOW_SIZE + 5; i++) {
            simulationTick(state, 1, getZoneStation);
        }
        expect(zone.population).toBeGreaterThan(initialPop);
    });
});
