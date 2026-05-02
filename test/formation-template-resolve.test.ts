import { describe, expect, it } from 'bun:test';

import type { CarTemplate } from '../src/trains/car-template';
import {
    type FormationTemplate,
    resolveFormationTemplate,
} from '../src/trains/formation-template';

function tpl(id: string): CarTemplate {
    return {
        id,
        bogieOffsets: [10],
        edgeToBogie: 2.5,
        bogieToEdge: 2.5,
        width: 2.5,
    };
}

function ftpl(slots: { carTemplateId: string }[]): FormationTemplate {
    return { id: 'f1', name: 'F1', slots };
}

describe('resolveFormationTemplate', () => {
    it('returns ok with car templates in slot order when all slots resolve', () => {
        const a = tpl('a');
        const b = tpl('b');
        const result = resolveFormationTemplate(
            ftpl([
                { carTemplateId: 'b' },
                { carTemplateId: 'a' },
                { carTemplateId: 'b' },
            ]),
            [a, b]
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.carTemplates).toEqual([b, a, b]);
        }
    });

    it('returns missing ids in first-occurrence order, deduped', () => {
        const a = tpl('a');
        const result = resolveFormationTemplate(
            ftpl([
                { carTemplateId: 'a' },
                { carTemplateId: 'gone-1' },
                { carTemplateId: 'gone-2' },
                { carTemplateId: 'gone-1' },
            ]),
            [a]
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.missingTemplateIds).toEqual(['gone-1', 'gone-2']);
        }
    });

    it('returns ok for a single resolved slot', () => {
        const a = tpl('a');
        const result = resolveFormationTemplate(
            ftpl([{ carTemplateId: 'a' }]),
            [a]
        );
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.carTemplates).toEqual([a]);
    });

    it('returns the empty-string slot id as missing', () => {
        const result = resolveFormationTemplate(
            ftpl([{ carTemplateId: '' }]),
            []
        );
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.missingTemplateIds).toEqual(['']);
    });
});
