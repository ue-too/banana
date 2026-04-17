import { describe, it, expect } from 'bun:test';
import { CarCargoStore } from '@/resources/car-cargo-store';
import { DEFAULT_CAR_CAPACITY } from '@/resources/types';

describe('CarCargoStore', () => {
    it('returns empty cargo for an untouched car', () => {
        const store = new CarCargoStore();
        const cargo = store.getCargo('car-0');
        expect(cargo.capacity).toBe(DEFAULT_CAR_CAPACITY);
        expect(cargo.contents).toEqual({});
        expect(store.getTotalLoad('car-0')).toBe(0);
    });

    it('adds and removes resources, returning actual amounts moved', () => {
        const store = new CarCargoStore();
        expect(store.add('car-0', 'iron-ore', 10)).toBe(10);
        expect(store.getTotalLoad('car-0')).toBe(10);
        expect(store.getCargo('car-0').contents['iron-ore']).toBe(10);
        expect(store.remove('car-0', 'iron-ore', 4)).toBe(4);
        expect(store.getTotalLoad('car-0')).toBe(6);
    });

    it('clamps add() at capacity and returns the actual amount added', () => {
        const store = new CarCargoStore();
        expect(store.add('car-0', 'iron-ore', DEFAULT_CAR_CAPACITY + 30)).toBe(
            DEFAULT_CAR_CAPACITY,
        );
        expect(store.getTotalLoad('car-0')).toBe(DEFAULT_CAR_CAPACITY);
        // Adding more returns 0.
        expect(store.add('car-0', 'goods', 5)).toBe(0);
    });

    it('clamps remove() at zero and returns the actual amount removed', () => {
        const store = new CarCargoStore();
        store.add('car-0', 'iron-ore', 3);
        expect(store.remove('car-0', 'iron-ore', 10)).toBe(3);
        expect(store.getTotalLoad('car-0')).toBe(0);
        expect(store.remove('car-0', 'iron-ore', 1)).toBe(0);
    });

    it('allows mixed types up to total capacity', () => {
        const store = new CarCargoStore();
        expect(store.add('car-0', 'iron-ore', 30)).toBe(30);
        expect(store.add('car-0', 'goods', 30)).toBe(DEFAULT_CAR_CAPACITY - 30);
        expect(store.getTotalLoad('car-0')).toBe(DEFAULT_CAR_CAPACITY);
    });

    it('supports per-car capacity overrides via setCapacity', () => {
        const store = new CarCargoStore();
        store.setCapacity('car-0', 20);
        expect(store.add('car-0', 'goods', 100)).toBe(20);
    });

    it('hydrate replaces all cargo', () => {
        const store = new CarCargoStore();
        store.add('car-0', 'iron-ore', 10);
        store.hydrate([
            { carId: 'car-0', capacity: 30, contents: { goods: 5 } },
            { carId: 'car-1', capacity: 50, contents: {} },
        ]);
        expect(store.getCargo('car-0').capacity).toBe(30);
        expect(store.getCargo('car-0').contents).toEqual({ goods: 5 });
    });

    it('serialize returns a snapshot of all tracked cars', () => {
        const store = new CarCargoStore();
        store.add('car-0', 'iron-ore', 7);
        const snap = store.serialize();
        expect(snap).toContainEqual({
            carId: 'car-0',
            capacity: DEFAULT_CAR_CAPACITY,
            contents: { 'iron-ore': 7 },
        });
    });
});
