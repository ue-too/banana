import type { CityCluster, EconomyState } from './simulation-state';

export class CityGrowthManager {
    private _state: EconomyState;

    constructor(state: EconomyState) {
        this._state = state;
    }

    recomputeClusters(getZoneStation: (zoneId: number) => number | null): void {
        this._state.cities.clear();
        this._state.nextCityId = 1;
        const stationZones = new Map<number, Set<number>>();
        for (const zone of this._state.zones.values()) {
            const stationId = getZoneStation(zone.id);
            if (stationId === null) continue;
            if (!stationZones.has(stationId)) {
                stationZones.set(stationId, new Set());
            }
            stationZones.get(stationId)!.add(zone.id);
        }
        for (const [stationId, zoneIds] of stationZones) {
            if (zoneIds.size === 0) continue;
            const cityId = this._state.nextCityId++;
            const cluster: CityCluster = {
                id: cityId,
                zoneIds,
                stationIds: new Set([stationId]),
                reputation: this._computeReputation(zoneIds),
            };
            this._state.cities.set(cityId, cluster);
        }
    }

    getCity(id: number): CityCluster | null {
        return this._state.cities.get(id) ?? null;
    }

    getAllCities(): CityCluster[] {
        return Array.from(this._state.cities.values());
    }

    updateReputations(): void {
        for (const city of this._state.cities.values()) {
            city.reputation = this._computeReputation(city.zoneIds);
        }
    }

    private _computeReputation(zoneIds: Set<number>): number {
        let totalSatisfaction = 0;
        let totalPopulation = 0;
        for (const zoneId of zoneIds) {
            const zone = this._state.zones.get(zoneId);
            if (!zone) continue;
            totalSatisfaction += zone.satisfaction * zone.population;
            totalPopulation += zone.population;
        }
        if (totalPopulation === 0) return 0.5;
        return totalSatisfaction / totalPopulation;
    }
}
