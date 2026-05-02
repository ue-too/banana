import type { CarTemplate } from './car-template';

/**
 * Single slot inside a FormationTemplate. The wrapper object (rather than a
 * bare string) leaves room for future per-slot extras (e.g. flipped) without
 * a schema migration.
 */
export type FormationTemplateSlot = {
    carTemplateId: string;
};

/**
 * A reusable, named blueprint for building a depot Formation by manufacturing
 * fresh cars from existing CarTemplate recipes. References car templates by id;
 * unresolved references are surfaced as warnings rather than blocking edits.
 */
export type FormationTemplate = {
    id: string;
    name: string;
    /** Length must be >= 1; ordered head-to-tail. */
    slots: FormationTemplateSlot[];
};

let _formationTemplateIdCounter = 0;
export function generateFormationTemplateId(): string {
    return `ftpl-${_formationTemplateIdCounter++}`;
}

export type FormationTemplateResolution =
    | { ok: true; carTemplates: CarTemplate[] }
    | { ok: false; missingTemplateIds: string[] };

/**
 * Resolve every slot's `carTemplateId` against the available car templates.
 * On success, returns the resolved car templates in slot order (duplicates
 * preserved). On failure, returns the deduplicated, in-first-occurrence-order
 * list of unresolved ids.
 */
export function resolveFormationTemplate(
    tpl: FormationTemplate,
    available: readonly CarTemplate[]
): FormationTemplateResolution {
    const byId = new Map<string, CarTemplate>();
    for (const ct of available) byId.set(ct.id, ct);

    const missing: string[] = [];
    const seenMissing = new Set<string>();

    for (const slot of tpl.slots) {
        if (!byId.has(slot.carTemplateId)) {
            if (!seenMissing.has(slot.carTemplateId)) {
                seenMissing.add(slot.carTemplateId);
                missing.push(slot.carTemplateId);
            }
        }
    }

    if (missing.length > 0) {
        return { ok: false, missingTemplateIds: missing };
    }

    return {
        ok: true,
        carTemplates: tpl.slots.map(s => byId.get(s.carTemplateId)!),
    };
}
