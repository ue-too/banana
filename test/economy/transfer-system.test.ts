import { beforeEach, describe, expect, it } from 'bun:test';

import {
    DEFAULT_SERVICE_RADIUS,
    type EconomyState,
    type IndustryEntity,
    type StationEconomyData,
    type ZoneEntity,
    createEconomyState,
} from '../../src/economy/simulation-state';
import { Stockpile } from '../../src/economy/stockpile';
import { runTransfer } from '../../src/economy/systems/transfer-system';
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
        demandPerMinute: new Map([[ResourceType.FOOD, 10]]),
    };
    state.zones.set(id, zone);
    return zone;
}

function addIndustry(
    state: EconomyState,
    type: IndustryType,
    stationId: number
): IndustryEntity {
    const id = state.nextIndustryId++;
    const industry: IndustryEntity = {
        id,
        type,
        position: { x: 0, y: 0 },
        assignedStationId: stationId,
        workerCount: 0,
        stockpile: new Stockpile(),
    };
    state.industries.set(id, industry);
    return industry;
}

// Helper: maps zone ID -> station ID
function getZoneStation(): number | null {
    return 1;
}

describe('TransferSystem', () => {
    let state: EconomyState;

    beforeEach(() => {
        state = createEconomyState();
    });

    it('transfers food from station stockpile to residential zone', () => {
        const station = addStationEconomy(state, 1);
        station.stockpile.add(ResourceType.FOOD, 50);
        const zone = addZone(state, ZoneType.RESIDENTIAL, 5);
        zone.demandPerMinute.set(ResourceType.FOOD, 10);
        runTransfer(state, 1, getZoneStation);
        expect(station.stockpile.get(ResourceType.FOOD)).toBeLessThan(50);
    });

    it('delivers workers from residential zones to industries via station', () => {
        const station = addStationEconomy(state, 1);
        const zone = addZone(state, ZoneType.RESIDENTIAL, 10);
        zone.satisfaction = 0.8;
        const industry = addIndustry(state, IndustryType.FARM, 1);
        runTransfer(state, 1, getZoneStation);
        expect(industry.workerCount).toBeGreaterThan(0);
    });

    it('updates zone satisfaction based on fulfilled demand', () => {
        const station = addStationEconomy(state, 1);
        station.stockpile.add(ResourceType.FOOD, 100);
        const zone = addZone(state, ZoneType.RESIDENTIAL, 5);
        zone.demandPerMinute.set(ResourceType.FOOD, 10);
        zone.satisfaction = 0.5;
        runTransfer(state, 1, getZoneStation);
        expect(zone.satisfaction).toBeGreaterThan(0.5);
    });

    it('decreases satisfaction when demand is unmet', () => {
        const station = addStationEconomy(state, 1);
        const zone = addZone(state, ZoneType.RESIDENTIAL, 5);
        zone.demandPerMinute.set(ResourceType.FOOD, 10);
        zone.satisfaction = 0.8;
        runTransfer(state, 1, getZoneStation);
        expect(zone.satisfaction).toBeLessThan(0.8);
    });
});
