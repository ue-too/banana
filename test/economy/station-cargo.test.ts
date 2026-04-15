import { describe, expect, it } from 'bun:test';

import { createCargoSlot } from '../../src/economy/cargo-slot';
import {
    DEFAULT_SERVICE_RADIUS,
    type StationEconomyData,
} from '../../src/economy/simulation-state';
import {
    type TrainCargo,
    processTrainAtStation,
} from '../../src/economy/station-cargo';
import { Stockpile } from '../../src/economy/stockpile';
import { ResourceType } from '../../src/economy/types';

function makeStationData(
    loadRules: ResourceType[],
    unloadRules: ResourceType[]
): StationEconomyData {
    return {
        stationId: 1,
        stockpile: new Stockpile(),
        serviceRadius: DEFAULT_SERVICE_RADIUS,
        loadRules: new Set(loadRules),
        unloadRules: new Set(unloadRules),
        autoMode: false,
    };
}

describe('processTrainAtStation', () => {
    it('unloads matching cargo into station stockpile', () => {
        const station = makeStationData([], [ResourceType.FOOD]);
        const slot = createCargoSlot(50);
        slot.resourceType = ResourceType.FOOD;
        slot.quantity = 30;
        const trainCargo: TrainCargo = { slots: [slot] };
        processTrainAtStation(trainCargo, station);
        expect(station.stockpile.get(ResourceType.FOOD)).toBe(30);
        expect(slot.quantity).toBe(0);
    });

    it('loads matching cargo from station stockpile', () => {
        const station = makeStationData([ResourceType.GOODS], []);
        station.stockpile.add(ResourceType.GOODS, 40);
        const slot = createCargoSlot(50);
        const trainCargo: TrainCargo = { slots: [slot] };
        processTrainAtStation(trainCargo, station);
        expect(slot.resourceType).toBe(ResourceType.GOODS);
        expect(slot.quantity).toBe(40);
        expect(station.stockpile.get(ResourceType.GOODS)).toBe(0);
    });

    it('unloads first then loads', () => {
        const station = makeStationData(
            [ResourceType.GOODS],
            [ResourceType.FOOD]
        );
        station.stockpile.add(ResourceType.GOODS, 20);
        const slot = createCargoSlot(50);
        slot.resourceType = ResourceType.FOOD;
        slot.quantity = 30;
        const trainCargo: TrainCargo = { slots: [slot] };
        processTrainAtStation(trainCargo, station);
        expect(station.stockpile.get(ResourceType.FOOD)).toBe(30);
        expect(slot.resourceType).toBe(ResourceType.GOODS);
        expect(slot.quantity).toBe(20);
    });

    it('skips cargo not in unload rules', () => {
        const station = makeStationData([], [ResourceType.GOODS]);
        const slot = createCargoSlot(50);
        slot.resourceType = ResourceType.FOOD;
        slot.quantity = 30;
        const trainCargo: TrainCargo = { slots: [slot] };
        processTrainAtStation(trainCargo, station);
        expect(slot.quantity).toBe(30);
        expect(station.stockpile.get(ResourceType.FOOD)).toBe(0);
    });
});
