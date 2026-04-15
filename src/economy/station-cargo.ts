import type { CargoSlot } from './cargo-slot';
import { loadCargo, unloadCargo } from './cargo-slot';
import type { StationEconomyData } from './simulation-state';

export interface TrainCargo {
    readonly slots: CargoSlot[];
}

export function processTrainAtStation(
    trainCargo: TrainCargo,
    station: StationEconomyData
): void {
    // Phase 1: Unload
    for (const slot of trainCargo.slots) {
        if (slot.resourceType === null || slot.quantity <= 0) continue;
        const shouldUnload =
            station.autoMode || station.unloadRules.has(slot.resourceType);
        if (!shouldUnload) continue;
        const { resource, quantity } = unloadCargo(slot, slot.quantity);
        if (resource !== null && quantity > 0) {
            station.stockpile.add(resource, quantity);
        }
    }

    // Phase 2: Load
    for (const slot of trainCargo.slots) {
        const space = slot.capacity - slot.quantity;
        if (space <= 0) continue;
        if (station.autoMode) {
            for (const [resource, available] of station.stockpile.entries()) {
                if (available <= 0) continue;
                if (
                    slot.resourceType !== null &&
                    slot.resourceType !== resource
                )
                    continue;
                const taken = station.stockpile.remove(resource, space);
                loadCargo(slot, resource, taken);
                break;
            }
        } else {
            for (const resource of station.loadRules) {
                if (
                    slot.resourceType !== null &&
                    slot.resourceType !== resource
                )
                    continue;
                const available = station.stockpile.get(resource);
                if (available <= 0) continue;
                const taken = station.stockpile.remove(resource, space);
                loadCargo(slot, resource, taken);
                break;
            }
        }
    }
}
