import type { Point } from '@ue-too/math';

import { Stockpile } from './stockpile';
import { type IndustryType, type ResourceType, type ZoneType } from './types';

export interface IndustryEntity {
    readonly id: number;
    readonly type: IndustryType;
    readonly position: Point;
    assignedStationId: number | null;
    workerCount: number;
    readonly stockpile: Stockpile;
}

export interface ZoneEntity {
    readonly id: number;
    readonly type: ZoneType;
    readonly boundary: readonly Point[];
    population: number;
    satisfaction: number; // 0.0–1.0
    satisfactionHistory: number[];
    readonly demandPerMinute: Map<ResourceType, number>;
}

export interface CityCluster {
    readonly id: number;
    readonly zoneIds: Set<number>;
    readonly stationIds: Set<number>;
    reputation: number;
}

export interface StationEconomyData {
    readonly stationId: number;
    readonly stockpile: Stockpile;
    serviceRadius: number;
    readonly loadRules: Set<ResourceType>;
    readonly unloadRules: Set<ResourceType>;
    autoMode: boolean;
}

export interface EconomyState {
    industries: Map<number, IndustryEntity>;
    zones: Map<number, ZoneEntity>;
    cities: Map<number, CityCluster>;
    stationEconomy: Map<number, StationEconomyData>;
    nextIndustryId: number;
    nextZoneId: number;
    nextCityId: number;
}

export function createEconomyState(): EconomyState {
    return {
        industries: new Map(),
        zones: new Map(),
        cities: new Map(),
        stationEconomy: new Map(),
        nextIndustryId: 1,
        nextZoneId: 1,
        nextCityId: 1,
    };
}

export const DEFAULT_SERVICE_RADIUS = 500;

export const GROWTH_THRESHOLD = 0.6;
export const DECAY_THRESHOLD = 0.3;
export const GROWTH_SUSTAIN_MINUTES = 5;
export const DECAY_SUSTAIN_MINUTES = 10;
export const SATISFACTION_WINDOW_SIZE = 20;
