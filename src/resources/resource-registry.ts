import type { ResourceType, ResourceTypeId } from './types';

export const RESOURCE_TYPES: readonly ResourceType[] = [
    { id: 'passenger', category: 'passenger', displayNameKey: 'resource.passenger' },
    { id: 'iron-ore', category: 'freight', displayNameKey: 'resource.ironOre' },
    { id: 'goods', category: 'freight', displayNameKey: 'resource.goods' },
] as const;

const BY_ID: Map<ResourceTypeId, ResourceType> = new Map(
    RESOURCE_TYPES.map((t) => [t.id, t]),
);

export function getResourceType(id: ResourceTypeId): ResourceType | null {
    return BY_ID.get(id) ?? null;
}

export function isKnownResourceType(id: ResourceTypeId): boolean {
    return BY_ID.has(id);
}
