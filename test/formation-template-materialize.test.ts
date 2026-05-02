import { describe, expect, it } from 'bun:test';

import { CarImageRegistry } from '../src/trains/car-image-registry';
import { CarStockManager } from '../src/trains/car-stock-manager';
import type { CarTemplate } from '../src/trains/car-template';
import { CarType } from '../src/trains/cars';
import { FormationManager } from '../src/trains/formation-manager';
import type { FormationTemplate } from '../src/trains/formation-template';
import { materializeFormationTemplate } from '../src/trains/formation-template-materialize';

function makeCarTemplate(
    id: string,
    overrides: Partial<CarTemplate> = {}
): CarTemplate {
    return {
        id,
        bogieOffsets: [12],
        edgeToBogie: 2.5,
        bogieToEdge: 2.5,
        width: 2.8,
        type: CarType.COACH,
        ...overrides,
    };
}

function makeManagers() {
    const carStockManager = new CarStockManager();
    const formationManager = new FormationManager(carStockManager);
    const carImageRegistry = new CarImageRegistry();
    return { carStockManager, formationManager, carImageRegistry };
}

describe('materializeFormationTemplate', () => {
    it('creates a depot formation with cars matching each slot in order', () => {
        const { carStockManager, formationManager, carImageRegistry } =
            makeManagers();
        const a = makeCarTemplate('a', { width: 2.5 });
        const b = makeCarTemplate('b', { width: 3.0, bogieOffsets: [15] });
        const tpl: FormationTemplate = {
            id: 'ftpl-1',
            name: 'Local Express',
            slots: [
                { carTemplateId: 'a' },
                { carTemplateId: 'b' },
                { carTemplateId: 'a' },
            ],
        };

        const result = materializeFormationTemplate({
            template: tpl,
            carTemplates: [a, b],
            carStockManager,
            formationManager,
            carImageRegistry,
        });

        expect(result.ok).toBe(true);
        expect(formationManager.count).toBe(1);
        expect(carStockManager.getAvailableCars().length).toBe(0);

        if (!result.ok) return;
        const formation = formationManager.getFormation(result.formationId);
        expect(formation).not.toBeNull();
        expect(formation!.name).toBe('Local Express');

        const cars = formation!.flatCars();
        expect(cars.length).toBe(3);
        expect(cars[0].width).toBe(2.5);
        expect(cars[1].width).toBe(3.0);
        expect(cars[1].bogieOffsets()).toEqual([15]);
        expect(cars[2].width).toBe(2.5);
    });

    it('registers images for slots whose source template carries one', () => {
        const { carStockManager, formationManager, carImageRegistry } =
            makeManagers();
        const withImage = makeCarTemplate('img', {
            image: {
                src: 'data:image/png;base64,xxx',
                position: { x: 0, y: 0 },
                width: 10,
                height: 5,
            },
        });
        const plain = makeCarTemplate('plain');

        const result = materializeFormationTemplate({
            template: {
                id: 'ftpl-2',
                name: 'Mixed',
                slots: [{ carTemplateId: 'img' }, { carTemplateId: 'plain' }],
            },
            carTemplates: [withImage, plain],
            carStockManager,
            formationManager,
            carImageRegistry,
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const cars = formationManager
            .getFormation(result.formationId)!
            .flatCars();
        expect(carImageRegistry.get(cars[0].id)).toBe(
            'data:image/png;base64,xxx'
        );
        expect(carImageRegistry.has(cars[1].id)).toBe(false);
    });

    it('returns missing template ids without side effects when unresolved', () => {
        const { carStockManager, formationManager, carImageRegistry } =
            makeManagers();
        const result = materializeFormationTemplate({
            template: {
                id: 'ftpl-3',
                name: 'Broken',
                slots: [{ carTemplateId: 'gone' }],
            },
            carTemplates: [],
            carStockManager,
            formationManager,
            carImageRegistry,
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.missingTemplateIds).toEqual(['gone']);
        }
        expect(formationManager.count).toBe(0);
        expect(carStockManager.getAvailableCars().length).toBe(0);
    });
});
