export type ResourceTypeId = string;

export type ResourceType = {
    id: ResourceTypeId;
    displayNameKey: string;
    category: 'passenger' | 'freight';
};

export type ResourceCounts = Record<ResourceTypeId, number>;

export type CarCargo = {
    capacity: number;
    contents: ResourceCounts;
};

export type Buffer = ResourceCounts;

export type PlatformKind = 'island' | 'trackAligned';

export type PlatformHandle = {
    kind: PlatformKind;
    stationId: number;
    platformId: number;
};

export type PlatformRole = 'source' | 'sink';

export type PlatformResourceConfig = {
    bufferMode: 'private' | 'sharedWithStation';
    roles: Partial<Record<ResourceTypeId, PlatformRole>>;
};

export type TransferState = {
    trainId: number;
    platform: PlatformHandle;
    startedAt: number;
};

export const DEFAULT_CAR_CAPACITY = 50;
export const TRANSFER_RATE_UNITS_PER_CAR_PER_SEC = 5;
export const SOURCE_RATE = 1;
export const SINK_RATE = 1;

export function encodePlatformKey(handle: PlatformHandle): string {
    return `${handle.kind}:${handle.stationId}:${handle.platformId}`;
}

export function decodePlatformKey(key: string): PlatformHandle {
    const [kind, stationIdStr, platformIdStr] = key.split(':');
    if (kind !== 'island' && kind !== 'trackAligned') {
        throw new Error(`bad platform kind in key: ${key}`);
    }
    return {
        kind,
        stationId: Number(stationIdStr),
        platformId: Number(platformIdStr),
    };
}
