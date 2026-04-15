import type { EconomyManager } from './economy-manager';
import { Stockpile } from './stockpile';
import type { IndustryType, ResourceType, ZoneType } from './types';
import type { SerializedStockpile } from './types';

interface SerializedIndustry {
    id: number;
    type: string;
    position: { x: number; y: number };
    assignedStationId: number | null;
    workerCount: number;
    stockpile: SerializedStockpile;
}

interface SerializedZone {
    id: number;
    type: string;
    boundary: { x: number; y: number }[];
    population: number;
    satisfaction: number;
    satisfactionHistory: number[];
}

interface SerializedStationEconomy {
    stationId: number;
    stockpile: SerializedStockpile;
    serviceRadius: number;
    loadRules: string[];
    unloadRules: string[];
    autoMode: boolean;
}

export interface SerializedEconomyData {
    industries: SerializedIndustry[];
    zones: SerializedZone[];
    stationEconomy: SerializedStationEconomy[];
    nextIndustryId: number;
    nextZoneId: number;
}

export function serializeEconomy(
    manager: EconomyManager
): SerializedEconomyData {
    const state = manager.state;

    const industries: SerializedIndustry[] = [];
    for (const ind of state.industries.values()) {
        industries.push({
            id: ind.id,
            type: ind.type,
            position: { x: ind.position.x, y: ind.position.y },
            assignedStationId: ind.assignedStationId,
            workerCount: ind.workerCount,
            stockpile: ind.stockpile.serialize(),
        });
    }

    const zones: SerializedZone[] = [];
    for (const zone of state.zones.values()) {
        zones.push({
            id: zone.id,
            type: zone.type,
            boundary: zone.boundary.map(p => ({ x: p.x, y: p.y })),
            population: zone.population,
            satisfaction: zone.satisfaction,
            satisfactionHistory: [...zone.satisfactionHistory],
        });
    }

    const stationEconomy: SerializedStationEconomy[] = [];
    for (const sd of state.stationEconomy.values()) {
        stationEconomy.push({
            stationId: sd.stationId,
            stockpile: sd.stockpile.serialize(),
            serviceRadius: sd.serviceRadius,
            loadRules: Array.from(sd.loadRules),
            unloadRules: Array.from(sd.unloadRules),
            autoMode: sd.autoMode,
        });
    }

    return {
        industries,
        zones,
        stationEconomy,
        nextIndustryId: state.nextIndustryId,
        nextZoneId: state.nextZoneId,
    };
}

export function deserializeEconomy(
    manager: EconomyManager,
    data: SerializedEconomyData
): void {
    manager.clearForLoad();
    const state = manager.state;

    // Restore station economy data first (industries reference stations)
    for (const sd of data.stationEconomy) {
        manager.registerStation(sd.stationId);
        const stationData = manager.getStationEconomy(sd.stationId)!;
        const stockpile = Stockpile.deserialize(sd.stockpile);
        for (const [resource, qty] of stockpile.entries()) {
            stationData.stockpile.add(resource, qty);
        }
        stationData.serviceRadius = sd.serviceRadius;
        stationData.autoMode = sd.autoMode;
        for (const rule of sd.loadRules) {
            stationData.loadRules.add(rule as ResourceType);
        }
        for (const rule of sd.unloadRules) {
            stationData.unloadRules.add(rule as ResourceType);
        }
    }

    // Restore industries
    for (const ind of data.industries) {
        const id = manager.industries.addIndustry(
            ind.type as IndustryType,
            ind.position
        );
        if (ind.assignedStationId !== null) {
            manager.industries.assignStation(id, ind.assignedStationId);
        }
        const industry = manager.industries.getIndustry(id)!;
        industry.workerCount = ind.workerCount;
        const stockpile = Stockpile.deserialize(ind.stockpile);
        for (const [resource, qty] of stockpile.entries()) {
            industry.stockpile.add(resource, qty);
        }
    }

    // Restore zones
    for (const z of data.zones) {
        const id = manager.zones.addZone(z.type as ZoneType, z.boundary);
        const zone = manager.zones.getZone(id)!;
        zone.population = z.population;
        zone.satisfaction = z.satisfaction;
        zone.satisfactionHistory.push(...z.satisfactionHistory);
    }

    // Restore ID counters
    state.nextIndustryId = data.nextIndustryId;
    state.nextZoneId = data.nextZoneId;
}
