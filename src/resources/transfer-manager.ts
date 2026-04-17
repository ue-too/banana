import type { CarCargoStore } from './car-cargo-store';
import type { PlatformBufferStore } from './platform-buffer-store';
import type {
    Buffer,
    PlatformHandle,
    ResourceTypeId,
    TransferState,
} from './types';
import {
    TRANSFER_RATE_UNITS_PER_CAR_PER_SEC,
    encodePlatformKey,
} from './types';

type TrainLike = { cars: readonly { id: string }[] };

export type TransferManagerDeps = {
    carCargoStore: CarCargoStore;
    platformBufferStore: PlatformBufferStore;
    getTrainById: (id: number) => TrainLike | null;
    getSimTime: () => number;
};

export class TransferManager {
    private _active: Map<number, TransferState> = new Map();
    private readonly _deps: TransferManagerDeps;

    constructor(deps: TransferManagerDeps) {
        this._deps = deps;
    }

    begin(trainId: number, platform: PlatformHandle): void {
        if (this._active.has(trainId)) {
            // Arrive while already transferring — per spec, replace defensively.
            // eslint-disable-next-line no-console
            console.warn(
                `[TransferManager] begin() while already transferring: train ${trainId}`
            );
        }
        this._active.set(trainId, {
            trainId,
            platform,
            startedAt: this._deps.getSimTime(),
        });
    }

    end(trainId: number): void {
        this._active.delete(trainId);
    }

    endAllAtPlatform(platform: PlatformHandle): void {
        const targetKey = encodePlatformKey(platform);
        for (const [id, state] of this._active) {
            if (encodePlatformKey(state.platform) === targetKey) {
                this._active.delete(id);
            }
        }
    }

    clear(): void {
        this._active.clear();
    }

    getTransfer(trainId: number): TransferState | null {
        return this._active.get(trainId) ?? null;
    }

    update(dt: number): void {
        if (!Number.isFinite(dt) || dt <= 0) return;
        const dead: number[] = [];
        for (const [trainId, state] of this._active) {
            const train = this._deps.getTrainById(trainId);
            if (!train) {
                dead.push(trainId);
                continue;
            }
            for (const car of train.cars) {
                const bufferSnapshot =
                    this._deps.platformBufferStore.getEffectiveBuffer(
                        state.platform
                    );
                let budget = TRANSFER_RATE_UNITS_PER_CAR_PER_SEC * dt;
                budget = this._unloadCar(
                    car.id,
                    state.platform,
                    bufferSnapshot,
                    budget
                );
                if (budget > 0) {
                    this._loadCar(
                        car.id,
                        state.platform,
                        bufferSnapshot,
                        budget
                    );
                }
            }
        }
        for (const id of dead) this._active.delete(id);
    }

    private _unloadCar(
        carId: string,
        platform: PlatformHandle,
        bufferSnapshot: Readonly<Buffer>,
        budget: number
    ): number {
        const cargo = this._deps.carCargoStore.getCargo(carId);
        for (const type of Object.keys(cargo.contents) as ResourceTypeId[]) {
            if (budget <= 0) break;
            // Skip types the platform already supplies — avoids an unload/reload cycle.
            if ((bufferSnapshot[type] ?? 0) > 0) continue;
            const have = cargo.contents[type] ?? 0;
            if (have <= 0) continue;
            const amount = Math.min(have, budget);
            const removed = this._deps.carCargoStore.remove(
                carId,
                type,
                amount
            );
            this._deps.platformBufferStore.add(platform, type, removed);
            budget -= removed;
        }
        return budget;
    }

    private _loadCar(
        carId: string,
        platform: PlatformHandle,
        bufferSnapshot: Readonly<Buffer>,
        budget: number
    ): number {
        for (const type of Object.keys(bufferSnapshot) as ResourceTypeId[]) {
            if (budget <= 0) break;
            const available = bufferSnapshot[type] ?? 0;
            if (available <= 0) continue;
            const wanted = Math.min(available, budget);
            const added = this._deps.carCargoStore.add(carId, type, wanted);
            if (added > 0) {
                this._deps.platformBufferStore.remove(platform, type, added);
            }
            budget -= added;
            if (added === 0) {
                // Car is at total-capacity; no other type can fit either.
                return 0;
            }
        }
        return budget;
    }
}
