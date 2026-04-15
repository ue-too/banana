import type { Point } from '@ue-too/math';

import type { Train } from '@/trains/formation';
import { CarType } from '@/trains/cars';

import { type CargoSlot, createCargoSlot } from './cargo-slot';
import { CityGrowthManager } from './city-growth-manager';
import { IndustryManager } from './industry-manager';
import { ResourceManager } from './resource-manager';
import { processTrainAtStation } from './station-cargo';
import {
    DEFAULT_SERVICE_RADIUS,
    type EconomyState,
    type StationEconomyData,
    createEconomyState,
} from './simulation-state';
import { simulationTick } from './simulation-tick';
import { Stockpile } from './stockpile';
import type { GrowthEvent } from './systems/growth-system';
import type { ZoneStationLookup } from './systems/transfer-system';
import type { ResourceType } from './types';
import { ZoneManager } from './zone-manager';

const FREIGHT_CAR_CAPACITY = 50;

export class EconomyManager {
    private _state: EconomyState;
    private _getZoneStation: ZoneStationLookup;

    /** Cargo slots keyed by car ID. Created on-demand for freight cars. */
    private _cargoSlots: Map<string, CargoSlot> = new Map();

    readonly industries: IndustryManager;
    readonly zones: ZoneManager;
    readonly cityGrowth: CityGrowthManager;
    readonly resources: ResourceManager;

    constructor(getZoneStation: ZoneStationLookup) {
        this._state = createEconomyState();
        this._getZoneStation = getZoneStation;
        this.industries = new IndustryManager(this._state);
        this.zones = new ZoneManager(this._state);
        this.cityGrowth = new CityGrowthManager(this._state);
        this.resources = new ResourceManager(this._state);
    }

    /**
     * Called when a train arrives at a station. Processes cargo
     * load/unload for all freight cars in the train.
     */
    handleTrainArrival(train: Train, stationId: number): void {
        const stationData = this._state.stationEconomy.get(stationId);
        if (!stationData) return;

        // Collect cargo slots for this train's freight cars
        const slots: CargoSlot[] = [];
        for (const car of train.formation.flatCars()) {
            if (car.type !== CarType.FREIGHT) continue;
            let slot = this._cargoSlots.get(car.id);
            if (!slot) {
                slot = createCargoSlot(FREIGHT_CAR_CAPACITY);
                this._cargoSlots.set(car.id, slot);
            }
            slots.push(slot);
        }

        if (slots.length === 0) return;

        processTrainAtStation({ slots }, stationData);
    }

    /**
     * Ensure all current stations are registered in the economy.
     * Call this before the tick so new stations participate immediately.
     */
    syncStations(stationIds: number[]): void {
        for (const id of stationIds) {
            this.registerStation(id);
        }
    }

    update(deltaMinutes: number): GrowthEvent[] {
        const events = simulationTick(
            this._state,
            deltaMinutes,
            this._getZoneStation
        );
        this.cityGrowth.recomputeClusters(this._getZoneStation);
        this.cityGrowth.updateReputations();
        return events;
    }

    registerStation(stationId: number): void {
        if (this._state.stationEconomy.has(stationId)) return;
        const data: StationEconomyData = {
            stationId,
            stockpile: new Stockpile(),
            serviceRadius: DEFAULT_SERVICE_RADIUS,
            loadRules: new Set(),
            unloadRules: new Set(),
            autoMode: false,
        };
        this._state.stationEconomy.set(stationId, data);
    }

    unregisterStation(stationId: number): void {
        this._state.stationEconomy.delete(stationId);
        for (const industry of this._state.industries.values()) {
            if (industry.assignedStationId === stationId) {
                industry.assignedStationId = null;
            }
        }
    }

    getStationEconomy(stationId: number): StationEconomyData | null {
        return this._state.stationEconomy.get(stationId) ?? null;
    }

    setLoadRule(
        stationId: number,
        resource: ResourceType,
        enabled: boolean
    ): void {
        const data = this._state.stationEconomy.get(stationId);
        if (!data) return;
        if (enabled) {
            data.loadRules.add(resource);
        } else {
            data.loadRules.delete(resource);
        }
    }

    setUnloadRule(
        stationId: number,
        resource: ResourceType,
        enabled: boolean
    ): void {
        const data = this._state.stationEconomy.get(stationId);
        if (!data) return;
        if (enabled) {
            data.unloadRules.add(resource);
        } else {
            data.unloadRules.delete(resource);
        }
    }

    setAutoMode(stationId: number, auto: boolean): void {
        const data = this._state.stationEconomy.get(stationId);
        if (!data) return;
        data.autoMode = auto;
    }

    findNearestStation(
        position: Point,
        stationPositions: Map<number, Point>
    ): number | null {
        let bestId: number | null = null;
        let bestDist = Infinity;
        for (const [stationId, stationPos] of stationPositions) {
            const data = this._state.stationEconomy.get(stationId);
            if (!data) continue;
            const dx = position.x - stationPos.x;
            const dy = position.y - stationPos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist <= data.serviceRadius && dist < bestDist) {
                bestDist = dist;
                bestId = stationId;
            }
        }
        return bestId;
    }

    clearForLoad(): void {
        this._state.industries.clear();
        this._state.zones.clear();
        this._state.cities.clear();
        this._state.stationEconomy.clear();
        this._state.nextIndustryId = 1;
        this._state.nextZoneId = 1;
        this._state.nextCityId = 1;
    }

    get state(): EconomyState {
        return this._state;
    }
}
