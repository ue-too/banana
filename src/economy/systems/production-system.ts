import { getRecipe } from '../recipes';
import type { EconomyState } from '../simulation-state';

export function runProduction(state: EconomyState, deltaMinutes: number): void {
    for (const industry of state.industries.values()) {
        if (industry.assignedStationId === null) continue;
        if (industry.workerCount <= 0) continue;

        const stationData = state.stationEconomy.get(
            industry.assignedStationId
        );
        if (!stationData) continue;

        const recipe = getRecipe(industry.type);
        if (industry.workerCount < recipe.workersRequired) continue;

        let canProduce = true;
        for (const [resource, rate] of recipe.inputs) {
            const needed = rate * deltaMinutes;
            if (!stationData.stockpile.hasEnough(resource, needed)) {
                canProduce = false;
                break;
            }
        }

        if (!canProduce) continue;

        for (const [resource, rate] of recipe.inputs) {
            stationData.stockpile.remove(resource, rate * deltaMinutes);
        }

        for (const [resource, rate] of recipe.outputs) {
            stationData.stockpile.add(resource, rate * deltaMinutes);
        }
    }
}
