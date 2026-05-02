import { describe, expect, it } from 'bun:test';

import type { FormationTemplate } from '../src/trains/formation-template';
import { FormationTemplateStore } from '../src/trains/formation-template-store';

describe('FormationTemplateStore', () => {
    it('add then getAll returns the template; count === 1', () => {
        const store = new FormationTemplateStore();
        const tpl: FormationTemplate = {
            id: 'f1',
            name: 'Local Express',
            slots: [{ carTemplateId: 'a' }, { carTemplateId: 'b' }],
        };
        store.add(tpl);
        expect(store.getAll()).toEqual([tpl]);
        expect(store.count).toBe(1);
    });

    it('add with a colliding id throws', () => {
        const store = new FormationTemplateStore();
        const tpl: FormationTemplate = {
            id: 'f1',
            name: 'Local Express',
            slots: [{ carTemplateId: 'a' }],
        };
        store.add(tpl);
        expect(() => store.add(tpl)).toThrow();
    });

    it('getById returns null for unknown id, the template for known id', () => {
        const store = new FormationTemplateStore();
        const tpl: FormationTemplate = {
            id: 'f1',
            name: 'Local Express',
            slots: [{ carTemplateId: 'a' }],
        };
        expect(store.getById('f1')).toBeNull();
        store.add(tpl);
        expect(store.getById('f1')).toEqual(tpl);
    });

    it('has returns true/false correctly', () => {
        const store = new FormationTemplateStore();
        const tpl: FormationTemplate = {
            id: 'f1',
            name: 'Local Express',
            slots: [{ carTemplateId: 'a' }],
        };
        expect(store.has('f1')).toBe(false);
        store.add(tpl);
        expect(store.has('f1')).toBe(true);
    });

    it('remove deletes; subsequent has/getById reflect it; removing unknown id is a no-op', () => {
        const store = new FormationTemplateStore();
        const tpl: FormationTemplate = {
            id: 'f1',
            name: 'Local Express',
            slots: [{ carTemplateId: 'a' }],
        };
        store.add(tpl);
        expect(store.has('f1')).toBe(true);
        store.remove('f1');
        expect(store.has('f1')).toBe(false);
        expect(store.getById('f1')).toBeNull();
        expect(store.count).toBe(0);

        // Removing unknown id is a no-op
        store.remove('unknown');
        expect(store.count).toBe(0);
    });

    it('update shallow-merges patch; update on unknown id throws', () => {
        const store = new FormationTemplateStore();
        const tpl: FormationTemplate = {
            id: 'f1',
            name: 'Original',
            slots: [{ carTemplateId: 'a' }],
        };
        store.add(tpl);
        store.update('f1', { name: 'Updated' });
        const updated = store.getById('f1');
        expect(updated).not.toBeNull();
        expect(updated!.name).toBe('Updated');
        // Verify other fields are preserved
        expect(updated!.slots).toEqual([{ carTemplateId: 'a' }]);

        expect(() => store.update('unknown', { name: 'Test' })).toThrow();
    });

    it('update can modify slots', () => {
        const store = new FormationTemplateStore();
        const tpl: FormationTemplate = {
            id: 'f1',
            name: 'Original',
            slots: [{ carTemplateId: 'a' }],
        };
        store.add(tpl);
        store.update('f1', {
            slots: [{ carTemplateId: 'c' }, { carTemplateId: 'd' }],
        });
        const updated = store.getById('f1');
        expect(updated).not.toBeNull();
        expect(updated!.slots).toEqual([
            { carTemplateId: 'c' },
            { carTemplateId: 'd' },
        ]);
        // Verify other fields are preserved
        expect(updated!.name).toBe('Original');
    });

    it('subscribe listener fires after add/remove/update/hydrate/clearForLoad', () => {
        const store = new FormationTemplateStore();
        const calls: number[] = [];
        const unsubscribe = store.subscribe(() => calls.push(calls.length));

        const tpl: FormationTemplate = {
            id: 'f1',
            name: 'Local Express',
            slots: [{ carTemplateId: 'a' }],
        };

        // Test add notification
        store.add(tpl);
        expect(calls).toEqual([0]);

        // Test update notification
        store.update('f1', { name: 'Updated' });
        expect(calls).toEqual([0, 1]);

        // Test remove notification
        store.remove('f1');
        expect(calls).toEqual([0, 1, 2]);

        // Test hydrate notification
        const tpl2: FormationTemplate = {
            id: 'f2',
            name: 'Express',
            slots: [{ carTemplateId: 'b' }],
        };
        store.hydrate([tpl2]);
        expect(calls).toEqual([0, 1, 2, 3]);

        // Test clearForLoad notification
        store.clearForLoad();
        expect(calls).toEqual([0, 1, 2, 3, 4]);

        // Test unsubscribe stops notifications
        unsubscribe();
        store.add(tpl);
        expect(calls).toEqual([0, 1, 2, 3, 4]);
    });

    it('getAll returns a stable reference until a mutation', () => {
        const store = new FormationTemplateStore();
        const tpl: FormationTemplate = {
            id: 'f1',
            name: 'Local Express',
            slots: [{ carTemplateId: 'a' }],
        };

        // Two calls without mutation should return same reference
        const ref1 = store.getAll();
        const ref2 = store.getAll();
        expect(ref1).toBe(ref2);

        // After add, reference should change
        store.add(tpl);
        const ref3 = store.getAll();
        expect(ref3).not.toBe(ref1);

        // Two calls after mutation should return same reference
        const ref4 = store.getAll();
        expect(ref4).toBe(ref3);
    });

    it('hydrate([a, b, c]) replaces existing contents and fires one notification', () => {
        const store = new FormationTemplateStore();
        const tpl1: FormationTemplate = {
            id: 'initial',
            name: 'Initial',
            slots: [{ carTemplateId: 'x' }],
        };
        store.add(tpl1);

        const calls: number[] = [];
        store.subscribe(() => calls.push(calls.length));

        const tpl2: FormationTemplate = {
            id: 'f1',
            name: 'Formation A',
            slots: [{ carTemplateId: 'a' }],
        };
        const tpl3: FormationTemplate = {
            id: 'f2',
            name: 'Formation B',
            slots: [{ carTemplateId: 'b' }],
        };
        const tpl4: FormationTemplate = {
            id: 'f3',
            name: 'Formation C',
            slots: [{ carTemplateId: 'c' }],
        };

        store.hydrate([tpl2, tpl3, tpl4]);

        // Should fire exactly one notification
        expect(calls).toEqual([0]);

        // Should have exactly those three templates
        expect(store.count).toBe(3);
        expect(store.getById('f1')).toEqual(tpl2);
        expect(store.getById('f2')).toEqual(tpl3);
        expect(store.getById('f3')).toEqual(tpl4);
        // Initial template should be gone
        expect(store.getById('initial')).toBeNull();
    });

    it('clearForLoad empties the store and fires a notification', () => {
        const store = new FormationTemplateStore();
        const tpl1: FormationTemplate = {
            id: 'f1',
            name: 'Formation A',
            slots: [{ carTemplateId: 'a' }],
        };
        const tpl2: FormationTemplate = {
            id: 'f2',
            name: 'Formation B',
            slots: [{ carTemplateId: 'b' }],
        };
        store.add(tpl1);
        store.add(tpl2);
        expect(store.count).toBe(2);

        const calls: number[] = [];
        store.subscribe(() => calls.push(calls.length));

        store.clearForLoad();

        expect(store.count).toBe(0);
        expect(store.getAll()).toEqual([]);
        expect(calls).toEqual([0]);
    });
});
