import { describe, expect, it } from 'bun:test';

import {
    type SerializedSceneData,
    validateSerializedSceneData,
} from '../src/scene-serialization';
import { CarTemplateStore } from '../src/trains/car-template-store';
import { FormationTemplateStore } from '../src/trains/formation-template-store';

describe('scene serialization — templates', () => {
    it('round-trips car templates through serialize/hydrate', () => {
        const store = new CarTemplateStore();
        store.add({
            id: 'tpl-1',
            name: 'Local Coach',
            bogieOffsets: [12],
            edgeToBogie: 2.5,
            bogieToEdge: 2.5,
            width: 2.7,
        });
        store.add({
            id: 'tpl-2',
            bogieOffsets: [10, 10],
            edgeToBogie: 2.0,
            bogieToEdge: 2.0,
            width: 3.0,
        });

        const serialized = [...store.getAll()];
        const restored = new CarTemplateStore();
        restored.hydrate(serialized);

        expect(restored.count).toBe(2);
        expect(restored.getById('tpl-1')?.name).toBe('Local Coach');
        expect(restored.getById('tpl-2')?.bogieOffsets).toEqual([10, 10]);
    });

    it('round-trips formation templates through serialize/hydrate', () => {
        const store = new FormationTemplateStore();
        store.add({
            id: 'ftpl-1',
            name: 'Express',
            slots: [
                { carTemplateId: 'tpl-1' },
                { carTemplateId: 'tpl-2' },
                { carTemplateId: 'tpl-1' },
            ],
        });

        const serialized = [...store.getAll()];
        const restored = new FormationTemplateStore();
        restored.hydrate(serialized);

        expect(restored.count).toBe(1);
        const tpl = restored.getById('ftpl-1');
        expect(tpl?.name).toBe('Express');
        expect(tpl?.slots.length).toBe(3);
        expect(tpl?.slots[1].carTemplateId).toBe('tpl-2');
    });
});

describe('validateSerializedSceneData — templates', () => {
    // Minimum valid scene shape for the validator.
    // - tracks requires { joints: [], segments: [] }
    // - trains requires { cars: [], formations: [], carStockIds: [], formationManagerIds: [], placedTrains: [] }
    function baseScene(): Record<string, unknown> {
        return {
            tracks: { joints: [], segments: [] },
            trains: {
                cars: [],
                formations: [],
                carStockIds: [],
                formationManagerIds: [],
                placedTrains: [],
            },
        };
    }

    it('accepts a scene without template fields (backward compat)', () => {
        const result = validateSerializedSceneData(baseScene());
        expect(result.valid).toBe(true);
    });

    it('accepts a scene with valid carTemplates', () => {
        const result = validateSerializedSceneData({
            ...baseScene(),
            carTemplates: [
                {
                    id: 'tpl-1',
                    bogieOffsets: [10],
                    edgeToBogie: 2.5,
                    bogieToEdge: 2.5,
                    width: 2.5,
                },
            ],
        });
        expect(result.valid).toBe(true);
    });

    it('rejects a carTemplate missing id', () => {
        const result = validateSerializedSceneData({
            ...baseScene(),
            carTemplates: [
                {
                    bogieOffsets: [10],
                    edgeToBogie: 2.5,
                    bogieToEdge: 2.5,
                    width: 2.5,
                },
            ],
        });
        expect(result.valid).toBe(false);
        if (!result.valid) {
            expect(result.error).toContain('carTemplates');
            expect(result.error).toContain('id');
        }
    });

    it('rejects a carTemplate with invalid width', () => {
        const result = validateSerializedSceneData({
            ...baseScene(),
            carTemplates: [
                {
                    id: 'tpl-1',
                    bogieOffsets: [10],
                    edgeToBogie: 2.5,
                    bogieToEdge: 2.5,
                    width: -5,
                },
            ],
        });
        expect(result.valid).toBe(false);
    });

    it('accepts a scene with valid formationTemplates', () => {
        const result = validateSerializedSceneData({
            ...baseScene(),
            formationTemplates: [
                {
                    id: 'ftpl-1',
                    name: 'Express',
                    slots: [{ carTemplateId: 'tpl-1' }],
                },
            ],
        });
        expect(result.valid).toBe(true);
    });

    it('rejects a formationTemplate with empty slots', () => {
        const result = validateSerializedSceneData({
            ...baseScene(),
            formationTemplates: [{ id: 'ftpl-1', name: 'Empty', slots: [] }],
        });
        expect(result.valid).toBe(false);
        if (!result.valid) {
            expect(result.error).toContain('slots');
        }
    });

    it('rejects a formationTemplate with non-string carTemplateId in a slot', () => {
        const result = validateSerializedSceneData({
            ...baseScene(),
            formationTemplates: [
                {
                    id: 'ftpl-1',
                    name: 'Bad',
                    slots: [{ carTemplateId: 42 }],
                },
            ],
        });
        expect(result.valid).toBe(false);
    });
});
