import type { EconomyState } from './simulation-state';
import { ResourceType } from './types';

export interface ResourceFlowSummary {
    totalSupply: Map<ResourceType, number>;
    totalDemand: Map<ResourceType, number>;
}

export class ResourceManager {
    private _state: EconomyState;

    constructor(state: EconomyState) {
        this._state = state;
    }

    getStationStockpile(stationId: number): Map<ResourceType, number> | null {
        const data = this._state.stationEconomy.get(stationId);
        if (!data) return null;
        const result = new Map<ResourceType, number>();
        for (const [resource, qty] of data.stockpile.entries()) {
            result.set(resource, qty);
        }
        return result;
    }

    getGlobalSummary(): ResourceFlowSummary {
        const totalSupply = new Map<ResourceType, number>();
        const totalDemand = new Map<ResourceType, number>();
        for (const stationData of this._state.stationEconomy.values()) {
            for (const [resource, qty] of stationData.stockpile.entries()) {
                totalSupply.set(
                    resource,
                    (totalSupply.get(resource) ?? 0) + qty
                );
            }
        }
        for (const zone of this._state.zones.values()) {
            for (const [resource, rate] of zone.demandPerMinute) {
                totalDemand.set(
                    resource,
                    (totalDemand.get(resource) ?? 0) + rate
                );
            }
        }
        return { totalSupply, totalDemand };
    }
}
