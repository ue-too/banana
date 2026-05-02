import type { CarImageRegistry } from './car-image-registry';
import type { CarStockManager } from './car-stock-manager';
import type { CarTemplate } from './car-template';
import type { FormationManager } from './formation-manager';
import {
    type FormationTemplate,
    resolveFormationTemplate,
} from './formation-template';

export type MaterializeFormationTemplateArgs = {
    template: FormationTemplate;
    carTemplates: readonly CarTemplate[];
    carStockManager: CarStockManager;
    formationManager: FormationManager;
    carImageRegistry: CarImageRegistry;
};

export type MaterializeFormationTemplateResult =
    | { ok: true; formationId: string }
    | { ok: false; missingTemplateIds: string[] };

/**
 * Build a fresh depot Formation from a FormationTemplate.
 *
 * Manufactures one new Car per slot using the resolved CarTemplate's spec,
 * registers any per-template image, then composes the cars into a new
 * Formation in the FormationManager (named after the template). Cars are
 * pulled from stock during the round-trip; on success no cars remain in stock.
 *
 * Returns the missing-template-ids list without touching any manager when the
 * template references one or more deleted car templates. The DepotPanel UI
 * already disables the trigger button in this case; the early return is a
 * defensive fallback.
 */
export function materializeFormationTemplate(
    args: MaterializeFormationTemplateArgs
): MaterializeFormationTemplateResult {
    const {
        template,
        carTemplates,
        carStockManager,
        formationManager,
        carImageRegistry,
    } = args;

    const resolution = resolveFormationTemplate(template, carTemplates);
    if (!resolution.ok) {
        return {
            ok: false,
            missingTemplateIds: resolution.missingTemplateIds,
        };
    }

    const byId = new Map(carTemplates.map(c => [c.id, c]));
    const newCarIds: string[] = [];
    for (const slot of template.slots) {
        const ct = byId.get(slot.carTemplateId)!;
        const car = carStockManager.createCar(
            [...ct.bogieOffsets],
            ct.edgeToBogie,
            ct.bogieToEdge,
            ct.type,
            ct.width
        );
        if (ct.image) {
            carImageRegistry.set(car.id, ct.image.src);
        }
        if (slot.flipped) {
            car.switchDirection();
        }
        newCarIds.push(car.id);
    }

    const formation = formationManager.createFormation(newCarIds);
    formationManager.renameFormation(formation.id, template.name);

    return { ok: true, formationId: formation.id };
}
