export enum ResourceType {
    FOOD = 'food',
    GOODS = 'goods',
    WORKERS = 'workers',
    BUILDING_MATERIALS = 'building_materials',
}

export enum IndustryType {
    FARM = 'farm',
    LUMBER_MILL = 'lumber_mill',
    WORKSHOP = 'workshop',
}

export enum ZoneType {
    RESIDENTIAL = 'residential',
    COMMERCIAL = 'commercial',
    INDUSTRIAL = 'industrial',
}

export interface Recipe {
    readonly industryType: IndustryType;
    readonly inputs: ReadonlyMap<ResourceType, number>;
    readonly outputs: ReadonlyMap<ResourceType, number>;
    readonly workersRequired: number;
}

export interface TransportOrder {
    readonly resource: ResourceType;
    readonly quantity: number;
    readonly sourceStationId: number;
    readonly destinationStationId: number;
}

export type SerializedStockpile = Record<string, number>;
