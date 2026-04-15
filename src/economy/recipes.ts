import { IndustryType, type Recipe, ResourceType } from './types';

export const RECIPES: ReadonlyMap<IndustryType, Recipe> = new Map([
    [
        IndustryType.FARM,
        {
            industryType: IndustryType.FARM,
            inputs: new Map(),
            outputs: new Map([[ResourceType.FOOD, 10]]),
            workersRequired: 2,
        },
    ],
    [
        IndustryType.LUMBER_MILL,
        {
            industryType: IndustryType.LUMBER_MILL,
            inputs: new Map(),
            outputs: new Map([[ResourceType.BUILDING_MATERIALS, 8]]),
            workersRequired: 3,
        },
    ],
    [
        IndustryType.WORKSHOP,
        {
            industryType: IndustryType.WORKSHOP,
            inputs: new Map([[ResourceType.BUILDING_MATERIALS, 5]]),
            outputs: new Map([[ResourceType.GOODS, 6]]),
            workersRequired: 4,
        },
    ],
]);

export function getRecipe(type: IndustryType): Recipe {
    const recipe = RECIPES.get(type);
    if (!recipe) {
        throw new Error(`No recipe defined for industry type: ${type}`);
    }
    return recipe;
}
