import type { CarCargo, ResourceCounts, ResourceTypeId } from './types';
import { DEFAULT_CAR_CAPACITY } from './types';

type SerializedCar = { carId: string; capacity: number; contents: ResourceCounts };

export class CarCargoStore {
    private _cargo: Map<string, CarCargo> = new Map();

    getCargo(carId: string): Readonly<CarCargo> {
        let entry = this._cargo.get(carId);
        if (!entry) {
            entry = { capacity: DEFAULT_CAR_CAPACITY, contents: {} };
            this._cargo.set(carId, entry);
        }
        return entry;
    }

    getTotalLoad(carId: string): number {
        const entry = this._cargo.get(carId);
        if (!entry) return 0;
        let total = 0;
        for (const v of Object.values(entry.contents)) total += v;
        return total;
    }

    setCapacity(carId: string, capacity: number): void {
        if (!Number.isFinite(capacity) || capacity < 0) {
            throw new Error('capacity must be a non-negative finite number');
        }
        const entry = this.getCargo(carId);
        entry.capacity = capacity;
        // If current load exceeds new capacity, we leave it alone — resource tests
        // never hit this path and mutating arbitrarily would hide bugs.
    }

    add(carId: string, type: ResourceTypeId, amount: number): number {
        if (!Number.isFinite(amount) || amount <= 0) return 0;
        const entry = this.getCargo(carId);
        const room = entry.capacity - this._sum(entry.contents);
        const actual = Math.min(amount, Math.max(0, room));
        if (actual > 0) {
            entry.contents[type] = (entry.contents[type] ?? 0) + actual;
        }
        return actual;
    }

    remove(carId: string, type: ResourceTypeId, amount: number): number {
        if (!Number.isFinite(amount) || amount <= 0) return 0;
        const entry = this._cargo.get(carId);
        if (!entry) return 0;
        const have = entry.contents[type] ?? 0;
        const actual = Math.min(amount, have);
        if (actual > 0) {
            const remaining = have - actual;
            if (remaining === 0) delete entry.contents[type];
            else entry.contents[type] = remaining;
        }
        return actual;
    }

    hydrate(cars: readonly SerializedCar[]): void {
        this._cargo.clear();
        for (const c of cars) {
            this._cargo.set(c.carId, {
                capacity: c.capacity,
                contents: { ...c.contents },
            });
        }
    }

    serialize(): SerializedCar[] {
        const out: SerializedCar[] = [];
        for (const [carId, cargo] of this._cargo) {
            out.push({
                carId,
                capacity: cargo.capacity,
                contents: { ...cargo.contents },
            });
        }
        return out;
    }

    private _sum(contents: ResourceCounts): number {
        let total = 0;
        for (const v of Object.values(contents)) total += v;
        return total;
    }
}
