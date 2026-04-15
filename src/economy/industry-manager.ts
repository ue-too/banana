import type { Point } from '@ue-too/math';

import type { EconomyState, IndustryEntity } from './simulation-state';
import { Stockpile } from './stockpile';
import type { IndustryType } from './types';

type Callback<T extends unknown[]> = (...args: T) => void;

export class IndustryManager {
    private _state: EconomyState;
    private _addCallbacks: Callback<[number, IndustryEntity]>[] = [];
    private _removeCallbacks: Callback<[number]>[] = [];

    constructor(state: EconomyState) {
        this._state = state;
    }

    addIndustry(type: IndustryType, position: Point): number {
        const id = this._state.nextIndustryId++;
        const industry: IndustryEntity = {
            id,
            type,
            position,
            assignedStationId: null,
            workerCount: 0,
            stockpile: new Stockpile(),
        };
        this._state.industries.set(id, industry);
        for (const cb of this._addCallbacks) cb(id, industry);
        return id;
    }

    removeIndustry(id: number): void {
        if (!this._state.industries.has(id)) return;
        this._state.industries.delete(id);
        for (const cb of this._removeCallbacks) cb(id);
    }

    getIndustry(id: number): IndustryEntity | null {
        return this._state.industries.get(id) ?? null;
    }

    assignStation(industryId: number, stationId: number | null): void {
        const industry = this._state.industries.get(industryId);
        if (!industry) return;
        industry.assignedStationId = stationId;
    }

    getAllIndustries(): IndustryEntity[] {
        return Array.from(this._state.industries.values());
    }

    onAdd(callback: Callback<[number, IndustryEntity]>): void {
        this._addCallbacks.push(callback);
    }

    onRemove(callback: Callback<[number]>): void {
        this._removeCallbacks.push(callback);
    }
}
