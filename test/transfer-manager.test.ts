import { describe, it, expect } from 'bun:test';
import { CarCargoStore } from '@/resources/car-cargo-store';
import { PlatformBufferStore } from '@/resources/platform-buffer-store';
import { TransferManager } from '@/resources/transfer-manager';
import {
    DEFAULT_CAR_CAPACITY,
    TRANSFER_RATE_UNITS_PER_CAR_PER_SEC,
    type PlatformHandle,
} from '@/resources/types';

const platform: PlatformHandle = { kind: 'island', stationId: 1, platformId: 0 };

function makeTrain(carIds: string[]): { cars: { id: string }[] } {
    return { cars: carIds.map((id) => ({ id })) };
}

function makeDeps(carIds: string[]): {
    cargo: CarCargoStore;
    buffer: PlatformBufferStore;
    manager: TransferManager;
} {
    const cargo = new CarCargoStore();
    const buffer = new PlatformBufferStore();
    const train = makeTrain(carIds);
    const manager = new TransferManager({
        carCargoStore: cargo,
        platformBufferStore: buffer,
        getTrainById: (id) => (id === 1 ? (train as any) : null),
        getSimTime: () => 0,
    });
    return { cargo, buffer, manager };
}

describe('TransferManager', () => {
    it('does nothing when no trains are transferring', () => {
        const { manager, buffer } = makeDeps(['car-0']);
        manager.update(1);
        expect(buffer.getEffectiveBuffer(platform)).toEqual({});
    });

    it('unloads cargo into the buffer first (greedy unload)', () => {
        const { cargo, buffer, manager } = makeDeps(['car-0']);
        cargo.add('car-0', 'iron-ore', 20);
        manager.begin(1, platform);
        manager.update(1); // budget = 5 * 1 = 5 per car
        expect(cargo.getCargo('car-0').contents).toEqual({ 'iron-ore': 15 });
        expect(buffer.getEffectiveBuffer(platform)).toEqual({ 'iron-ore': 5 });
    });

    it('fills empty cars from the buffer up to the per-tick budget', () => {
        const { cargo, buffer, manager } = makeDeps(['car-0']);
        buffer.add(platform, 'goods', 100);
        manager.begin(1, platform);
        manager.update(1);
        expect(cargo.getCargo('car-0').contents).toEqual({ goods: 5 });
        expect(buffer.getEffectiveBuffer(platform)).toEqual({ goods: 95 });
    });

    it('within one tick, unloads then loads — remaining budget fills from buffer', () => {
        const { cargo, buffer, manager } = makeDeps(['car-0']);
        cargo.add('car-0', 'iron-ore', 2);     // small cargo, drains fast
        buffer.add(platform, 'goods', 100);
        manager.begin(1, platform);
        manager.update(1); // budget = 5; unload 2 iron-ore, load 3 goods
        expect(cargo.getCargo('car-0').contents).toEqual({ goods: 3 });
        expect(buffer.getEffectiveBuffer(platform)).toEqual({
            'iron-ore': 2,
            goods: 97,
        });
    });

    it('respects car capacity when loading', () => {
        const { cargo, buffer, manager } = makeDeps(['car-0']);
        cargo.setCapacity('car-0', 3);
        buffer.add(platform, 'goods', 100);
        manager.begin(1, platform);
        manager.update(10); // budget = 50, but cap is 3
        expect(cargo.getCargo('car-0').contents).toEqual({ goods: 3 });
        expect(buffer.getEffectiveBuffer(platform)).toEqual({ goods: 97 });
    });

    it('parallelizes across cars (10 cars = 10× the rate)', () => {
        const carIds = Array.from({ length: 10 }, (_, i) => `car-${i}`);
        const { cargo, buffer, manager } = makeDeps(carIds);
        buffer.add(platform, 'goods', 1000);
        manager.begin(1, platform);
        manager.update(1);
        let total = 0;
        for (const id of carIds) total += cargo.getTotalLoad(id);
        expect(total).toBe(TRANSFER_RATE_UNITS_PER_CAR_PER_SEC * 10);
    });

    it('end() stops the transfer; subsequent updates are no-ops', () => {
        const { cargo, buffer, manager } = makeDeps(['car-0']);
        buffer.add(platform, 'goods', 100);
        manager.begin(1, platform);
        manager.end(1);
        manager.update(1);
        expect(cargo.getCargo('car-0').contents).toEqual({});
        expect(buffer.getEffectiveBuffer(platform)).toEqual({ goods: 100 });
    });

    it('begin() replaces any existing transfer for that train', () => {
        const { manager } = makeDeps(['car-0']);
        const platform2 = { ...platform, platformId: 1 };
        manager.begin(1, platform);
        manager.begin(1, platform2);
        expect(manager.getTransfer(1)?.platform).toEqual(platform2);
    });

    it('skips trains that have been deleted since begin', () => {
        const cargo = new CarCargoStore();
        const buffer = new PlatformBufferStore();
        let trainAlive = true;
        const manager = new TransferManager({
            carCargoStore: cargo,
            platformBufferStore: buffer,
            getTrainById: (id) => (trainAlive && id === 1 ? ({ cars: [{ id: 'car-0' }] } as any) : null),
            getSimTime: () => 0,
        });
        buffer.add(platform, 'goods', 100);
        manager.begin(1, platform);
        trainAlive = false;
        // Should not throw, should not mutate buffer
        manager.update(1);
        expect(buffer.getEffectiveBuffer(platform)).toEqual({ goods: 100 });
    });

    it('endAllAtPlatform clears any transfer on that platform', () => {
        const { manager } = makeDeps(['car-0']);
        manager.begin(1, platform);
        manager.endAllAtPlatform(platform);
        expect(manager.getTransfer(1)).toBeNull();
    });

    it('respects car capacity across multiple cars (no overflow)', () => {
        const { cargo, buffer, manager } = makeDeps(['car-0']);
        buffer.add(platform, 'goods', 1000);
        manager.begin(1, platform);
        // Run enough ticks to try to overflow: 100 sec * 5/sec = 500 attempted
        for (let i = 0; i < 100; i++) manager.update(1);
        expect(cargo.getTotalLoad('car-0')).toBe(DEFAULT_CAR_CAPACITY);
    });
});
