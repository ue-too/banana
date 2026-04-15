import type { Point } from '@ue-too/math';

import type { EconomyState, ZoneEntity } from './simulation-state';
import type { ZoneType } from './types';

type Callback<T extends unknown[]> = (...args: T) => void;

export class ZoneManager {
    private _state: EconomyState;
    private _addCallbacks: Callback<[number, ZoneEntity]>[] = [];
    private _removeCallbacks: Callback<[number]>[] = [];

    constructor(state: EconomyState) {
        this._state = state;
    }

    addZone(type: ZoneType, boundary: Point[]): number {
        const id = this._state.nextZoneId++;
        const zone: ZoneEntity = {
            id,
            type,
            boundary,
            population: 0,
            satisfaction: 0.5,
            satisfactionHistory: [],
            demandPerMinute: new Map(),
        };
        this._state.zones.set(id, zone);
        for (const cb of this._addCallbacks) cb(id, zone);
        return id;
    }

    removeZone(id: number): void {
        if (!this._state.zones.has(id)) return;
        this._state.zones.delete(id);
        for (const cb of this._removeCallbacks) cb(id);
    }

    getZone(id: number): ZoneEntity | null {
        return this._state.zones.get(id) ?? null;
    }

    getSatisfaction(id: number): number {
        const zone = this._state.zones.get(id);
        if (!zone) return 0;
        return zone.satisfaction;
    }

    getAllZones(): ZoneEntity[] {
        return Array.from(this._state.zones.values());
    }

    onAdd(callback: Callback<[number, ZoneEntity]>): void {
        this._addCallbacks.push(callback);
    }

    onRemove(callback: Callback<[number]>): void {
        this._removeCallbacks.push(callback);
    }
}
