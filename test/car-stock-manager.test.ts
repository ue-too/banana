import { describe, expect, it } from 'bun:test';

import { CarStockManager } from '../src/trains/car-stock-manager';

describe('CarStockManager.setOnBeforeRemove', () => {
    it('fires the callback with the removed car when removeCar is called', () => {
        const manager = new CarStockManager();
        const car = manager.createCar();
        const carId = car.id;

        const fired: string[] = [];
        manager.setOnBeforeRemove(c => fired.push(c.id));

        manager.removeCar(carId);

        expect(fired).toEqual([carId]);
    });

    it('does not fire the callback when the car id does not exist', () => {
        const manager = new CarStockManager();
        const fired: string[] = [];
        manager.setOnBeforeRemove(c => fired.push(c.id));

        manager.removeCar('nonexistent-id');

        expect(fired).toHaveLength(0);
    });

    it('fires the callback before the car is removed from the pool', () => {
        const manager = new CarStockManager();
        const car = manager.createCar();
        const carId = car.id;

        let countDuringCallback = -1;
        manager.setOnBeforeRemove(() => {
            countDuringCallback = manager.count;
        });

        manager.removeCar(carId);

        // Callback fires before deletion: count should still be 1 inside the callback
        expect(countDuringCallback).toBe(1);
        // After removeCar completes, stock is empty
        expect(manager.count).toBe(0);
    });
});
