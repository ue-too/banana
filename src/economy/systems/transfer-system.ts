import type { EconomyState, ZoneEntity } from '../simulation-state';
import { SATISFACTION_WINDOW_SIZE } from '../simulation-state';
import { ResourceType, ZoneType } from '../types';

export type ZoneStationLookup = (zoneId: number) => number | null;

function workerOutputRate(zone: ZoneEntity): number {
    if (zone.type !== ZoneType.RESIDENTIAL) return 0;
    if (zone.satisfaction < 0.4) return 0;
    return zone.population * 0.5 * zone.satisfaction;
}

export function runTransfer(
    state: EconomyState,
    deltaMinutes: number,
    getZoneStation: ZoneStationLookup
): void {
    // Phase 1: Deliver resources from stations to zones, track fulfillment
    for (const zone of state.zones.values()) {
        const stationId = getZoneStation(zone.id);
        if (stationId === null) continue;

        const stationData = state.stationEconomy.get(stationId);
        if (!stationData) continue;

        let totalDemand = 0;
        let totalFulfilled = 0;

        for (const [resource, ratePerMinute] of zone.demandPerMinute) {
            const needed = ratePerMinute * deltaMinutes;
            if (needed <= 0) continue;

            totalDemand += needed;
            const delivered = stationData.stockpile.remove(resource, needed);
            totalFulfilled += delivered;
        }

        // Update satisfaction based on fulfillment ratio
        if (totalDemand > 0) {
            const fulfillmentRatio = totalFulfilled / totalDemand;
            const blendSpeed = 0.1 * deltaMinutes;
            zone.satisfaction =
                zone.satisfaction +
                (fulfillmentRatio - zone.satisfaction) *
                    Math.min(blendSpeed, 1);
            zone.satisfaction = Math.max(0, Math.min(1, zone.satisfaction));
        }

        // Record satisfaction sample
        zone.satisfactionHistory.push(zone.satisfaction);
        if (zone.satisfactionHistory.length > SATISFACTION_WINDOW_SIZE) {
            zone.satisfactionHistory.shift();
        }
    }

    // Phase 2: Residential zones produce workers -> distribute to industries via stations
    for (const zone of state.zones.values()) {
        const rate = workerOutputRate(zone);
        if (rate <= 0) continue;

        const stationId = getZoneStation(zone.id);
        if (stationId === null) continue;

        const stationData = state.stationEconomy.get(stationId);
        if (!stationData) continue;

        const workersProduced = rate * deltaMinutes;
        stationData.stockpile.add(ResourceType.WORKERS, workersProduced);
    }

    // Phase 3: Distribute workers evenly from stations to industries
    // First, reset all worker counts (workers are a per-tick flow, not accumulated)
    for (const industry of state.industries.values()) {
        industry.workerCount = 0;
    }

    // Group industries by station
    const industriesByStation = new Map<number, typeof state.industries extends Map<number, infer V> ? V[] : never>();
    for (const industry of state.industries.values()) {
        if (industry.assignedStationId === null) continue;
        let list = industriesByStation.get(industry.assignedStationId);
        if (!list) {
            list = [];
            industriesByStation.set(industry.assignedStationId, list);
        }
        list.push(industry);
    }

    // Distribute workers evenly among industries at each station
    for (const [stationId, industries] of industriesByStation) {
        const stationData = state.stationEconomy.get(stationId);
        if (!stationData) continue;

        const available = stationData.stockpile.remove(
            ResourceType.WORKERS,
            stationData.stockpile.get(ResourceType.WORKERS)
        );
        if (available <= 0) continue;

        const perIndustry = available / industries.length;
        for (const industry of industries) {
            industry.workerCount = perIndustry;
        }
    }
}
