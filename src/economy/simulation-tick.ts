import type { EconomyState } from './simulation-state';
import { runDemand } from './systems/demand-system';
import { type GrowthEvent, runGrowth } from './systems/growth-system';
import { runProduction } from './systems/production-system';
import { type ZoneStationLookup, runTransfer } from './systems/transfer-system';

export function simulationTick(
    state: EconomyState,
    deltaMinutes: number,
    getZoneStation: ZoneStationLookup
): GrowthEvent[] {
    runProduction(state, deltaMinutes);
    runDemand(state);
    runTransfer(state, deltaMinutes, getZoneStation);
    return runGrowth(state);
}
