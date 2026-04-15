import { describe, expect, it } from 'bun:test';

import {
    type CargoSlot,
    createCargoSlot,
    loadCargo,
    unloadCargo,
} from '../../src/economy/cargo-slot';
import { ResourceType } from '../../src/economy/types';

describe('CargoSlot', () => {
    it('creates an empty slot with capacity', () => {
        const slot = createCargoSlot(50);
        expect(slot.resourceType).toBeNull();
        expect(slot.quantity).toBe(0);
        expect(slot.capacity).toBe(50);
    });

    it('loads cargo into empty slot', () => {
        const slot = createCargoSlot(50);
        const loaded = loadCargo(slot, ResourceType.FOOD, 30);
        expect(loaded).toBe(30);
        expect(slot.resourceType).toBe(ResourceType.FOOD);
        expect(slot.quantity).toBe(30);
    });

    it('clamps loading to capacity', () => {
        const slot = createCargoSlot(50);
        const loaded = loadCargo(slot, ResourceType.FOOD, 80);
        expect(loaded).toBe(50);
        expect(slot.quantity).toBe(50);
    });

    it('does not load different resource type into occupied slot', () => {
        const slot = createCargoSlot(50);
        loadCargo(slot, ResourceType.FOOD, 20);
        const loaded = loadCargo(slot, ResourceType.GOODS, 10);
        expect(loaded).toBe(0);
        expect(slot.resourceType).toBe(ResourceType.FOOD);
        expect(slot.quantity).toBe(20);
    });

    it('adds to existing cargo of same type', () => {
        const slot = createCargoSlot(50);
        loadCargo(slot, ResourceType.FOOD, 20);
        const loaded = loadCargo(slot, ResourceType.FOOD, 15);
        expect(loaded).toBe(15);
        expect(slot.quantity).toBe(35);
    });

    it('unloads cargo and clears type when empty', () => {
        const slot = createCargoSlot(50);
        loadCargo(slot, ResourceType.FOOD, 30);
        const unloaded = unloadCargo(slot, 30);
        expect(unloaded).toEqual({ resource: ResourceType.FOOD, quantity: 30 });
        expect(slot.resourceType).toBeNull();
        expect(slot.quantity).toBe(0);
    });

    it('partially unloads cargo', () => {
        const slot = createCargoSlot(50);
        loadCargo(slot, ResourceType.FOOD, 30);
        const unloaded = unloadCargo(slot, 10);
        expect(unloaded).toEqual({ resource: ResourceType.FOOD, quantity: 10 });
        expect(slot.quantity).toBe(20);
    });
});
