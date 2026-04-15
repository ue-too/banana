import { beforeEach, describe, expect, it } from 'bun:test';

import {
    DEFAULT_SERVICE_RADIUS,
    type EconomyState,
    type IndustryEntity,
    type StationEconomyData,
    createEconomyState,
} from '../../src/economy/simulation-state';
import { Stockpile } from '../../src/economy/stockpile';
import { runProduction } from '../../src/economy/systems/production-system';
import { IndustryType, ResourceType } from '../../src/economy/types';

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

describe('ProductionSystem', () => {
    let state: EconomyState;

    beforeEach(() => {
        state = createEconomyState();
    });

    it('farm produces food into station stockpile when it has workers', () => {
        const station = addStationEconomy(state, 1);
        addIndustry(state, IndustryType.FARM, 1, 5);
        runProduction(state, 1);
        expect(station.stockpile.get(ResourceType.FOOD)).toBe(10);
    });

    it('farm produces nothing without workers', () => {
        const station = addStationEconomy(state, 1);
        addIndustry(state, IndustryType.FARM, 1, 0);
        runProduction(state, 1);
        expect(station.stockpile.get(ResourceType.FOOD)).toBe(0);
    });

    it('farm produces nothing without assigned station', () => {
        addIndustry(state, IndustryType.FARM, null as unknown as number, 5);
        runProduction(state, 1);
        expect(state.industries.size).toBe(1);
    });

    it('workshop consumes building materials and produces goods', () => {
        const station = addStationEconomy(state, 1);
        station.stockpile.add(ResourceType.BUILDING_MATERIALS, 100);
        addIndustry(state, IndustryType.WORKSHOP, 1, 5);
        runProduction(state, 1);
        expect(station.stockpile.get(ResourceType.GOODS)).toBe(6);
        expect(station.stockpile.get(ResourceType.BUILDING_MATERIALS)).toBe(95);
    });

    it('workshop does not produce when inputs are insufficient', () => {
        const station = addStationEconomy(state, 1);
        station.stockpile.add(ResourceType.BUILDING_MATERIALS, 2);
        addIndustry(state, IndustryType.WORKSHOP, 1, 5);
        runProduction(state, 1);
        expect(station.stockpile.get(ResourceType.GOODS)).toBe(0);
        expect(station.stockpile.get(ResourceType.BUILDING_MATERIALS)).toBe(2);
    });

    it('scales production by deltaTime', () => {
        const station = addStationEconomy(state, 1);
        addIndustry(state, IndustryType.FARM, 1, 5);
        runProduction(state, 0.5);
        expect(station.stockpile.get(ResourceType.FOOD)).toBe(5);
    });
});
