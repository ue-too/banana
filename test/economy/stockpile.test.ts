import { describe, expect, it } from 'bun:test';

import { Stockpile } from '../../src/economy/stockpile';
import { ResourceType } from '../../src/economy/types';

describe('Stockpile', () => {
    it('starts empty', () => {
        const s = new Stockpile();
        expect(s.get(ResourceType.FOOD)).toBe(0);
        expect(s.isEmpty()).toBe(true);
    });

    it('adds resources', () => {
        const s = new Stockpile();
        s.add(ResourceType.FOOD, 10);
        expect(s.get(ResourceType.FOOD)).toBe(10);
        expect(s.isEmpty()).toBe(false);
    });

    it('removes resources', () => {
        const s = new Stockpile();
        s.add(ResourceType.FOOD, 10);
        const removed = s.remove(ResourceType.FOOD, 7);
        expect(removed).toBe(7);
        expect(s.get(ResourceType.FOOD)).toBe(3);
    });

    it('clamps removal to available amount', () => {
        const s = new Stockpile();
        s.add(ResourceType.FOOD, 5);
        const removed = s.remove(ResourceType.FOOD, 10);
        expect(removed).toBe(5);
        expect(s.get(ResourceType.FOOD)).toBe(0);
    });

    it('checks if enough resources are available', () => {
        const s = new Stockpile();
        s.add(ResourceType.BUILDING_MATERIALS, 20);
        expect(s.hasEnough(ResourceType.BUILDING_MATERIALS, 15)).toBe(true);
        expect(s.hasEnough(ResourceType.BUILDING_MATERIALS, 25)).toBe(false);
    });

    it('returns all non-zero entries', () => {
        const s = new Stockpile();
        s.add(ResourceType.FOOD, 10);
        s.add(ResourceType.GOODS, 5);
        const entries = s.entries();
        expect(entries).toEqual([
            [ResourceType.FOOD, 10],
            [ResourceType.GOODS, 5],
        ]);
    });

    it('serializes and deserializes', () => {
        const s = new Stockpile();
        s.add(ResourceType.FOOD, 10);
        s.add(ResourceType.WORKERS, 3);
        const data = s.serialize();
        const restored = Stockpile.deserialize(data);
        expect(restored.get(ResourceType.FOOD)).toBe(10);
        expect(restored.get(ResourceType.WORKERS)).toBe(3);
        expect(restored.get(ResourceType.GOODS)).toBe(0);
    });
});
