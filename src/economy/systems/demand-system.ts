import type { EconomyState, ZoneEntity } from '../simulation-state';
import { ResourceType, ZoneType } from '../types';

const ZONE_DEMAND: Record<ZoneType, [ResourceType, number][]> = {
    [ZoneType.RESIDENTIAL]: [
        [ResourceType.FOOD, 1],
        [ResourceType.GOODS, 0.5],
    ],
    [ZoneType.COMMERCIAL]: [
        [ResourceType.GOODS, 0.8],
        [ResourceType.WORKERS, 1],
    ],
    [ZoneType.INDUSTRIAL]: [[ResourceType.WORKERS, 1.5]],
};

function computeDemand(zone: ZoneEntity): void {
    zone.demandPerMinute.clear();
    if (zone.population <= 0) return;

    const baseDemands = ZONE_DEMAND[zone.type];
    const satisfactionMultiplier = 0.5 + zone.satisfaction;

    for (const [resource, ratePerPop] of baseDemands) {
        const demand = zone.population * ratePerPop * satisfactionMultiplier;
        zone.demandPerMinute.set(resource, demand);
    }
}

export function runDemand(state: EconomyState): void {
    for (const zone of state.zones.values()) {
        computeDemand(zone);
    }
}
