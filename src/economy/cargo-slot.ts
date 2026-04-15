import type { ResourceType } from './types';

export interface CargoSlot {
    resourceType: ResourceType | null;
    quantity: number;
    readonly capacity: number;
}

export function createCargoSlot(capacity: number): CargoSlot {
    return { resourceType: null, quantity: 0, capacity };
}

export function loadCargo(
    slot: CargoSlot,
    resource: ResourceType,
    amount: number
): number {
    if (slot.resourceType !== null && slot.resourceType !== resource) {
        return 0;
    }
    const space = slot.capacity - slot.quantity;
    const loaded = Math.min(amount, space);
    if (loaded <= 0) return 0;
    slot.resourceType = resource;
    slot.quantity += loaded;
    return loaded;
}

export function unloadCargo(
    slot: CargoSlot,
    amount: number
): { resource: ResourceType | null; quantity: number } {
    if (slot.resourceType === null || slot.quantity <= 0) {
        return { resource: null, quantity: 0 };
    }
    const unloaded = Math.min(amount, slot.quantity);
    const resource = slot.resourceType;
    slot.quantity -= unloaded;
    if (slot.quantity <= 0) {
        slot.resourceType = null;
        slot.quantity = 0;
    }
    return { resource, quantity: unloaded };
}

export interface SerializedCargoSlot {
    resourceType: string | null;
    quantity: number;
    capacity: number;
}

export function serializeCargoSlot(slot: CargoSlot): SerializedCargoSlot {
    return {
        resourceType: slot.resourceType,
        quantity: slot.quantity,
        capacity: slot.capacity,
    };
}

export function deserializeCargoSlot(data: SerializedCargoSlot): CargoSlot {
    return {
        resourceType: data.resourceType as ResourceType | null,
        quantity: data.quantity,
        capacity: data.capacity,
    };
}
