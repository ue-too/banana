import { describe, expect, it } from 'bun:test';

import type { CarTemplate } from '../src/trains/car-template';
import { CarTemplateStore } from '../src/trains/car-template-store';

describe('CarTemplateStore', () => {
    it('add then getAll returns the template; count === 1', () => {
        const store = new CarTemplateStore();
        const tpl: CarTemplate = {
            id: 'a',
            bogieOffsets: [10],
            edgeToBogie: 2.5,
            bogieToEdge: 2.5,
            width: 2.5,
        };
        store.add(tpl);
        expect(store.getAll()).toEqual([tpl]);
        expect(store.count).toBe(1);
    });

    it('add with a colliding id throws', () => {
        const store = new CarTemplateStore();
        const tpl: CarTemplate = {
            id: 'a',
            bogieOffsets: [10],
            edgeToBogie: 2.5,
            bogieToEdge: 2.5,
            width: 2.5,
        };
        store.add(tpl);
        expect(() => store.add(tpl)).toThrow();
    });

    it('getById returns null for unknown id, the template for known id', () => {
        const store = new CarTemplateStore();
        const tpl: CarTemplate = {
            id: 'a',
            bogieOffsets: [10],
            edgeToBogie: 2.5,
            bogieToEdge: 2.5,
            width: 2.5,
        };
        expect(store.getById('a')).toBeNull();
        store.add(tpl);
        expect(store.getById('a')).toEqual(tpl);
    });

    it('has returns true/false correctly', () => {
        const store = new CarTemplateStore();
        const tpl: CarTemplate = {
            id: 'a',
            bogieOffsets: [10],
            edgeToBogie: 2.5,
            bogieToEdge: 2.5,
            width: 2.5,
        };
        expect(store.has('a')).toBe(false);
        store.add(tpl);
        expect(store.has('a')).toBe(true);
    });

    it('remove deletes; subsequent has/getById reflect it; removing unknown id is a no-op', () => {
        const store = new CarTemplateStore();
        const tpl: CarTemplate = {
            id: 'a',
            bogieOffsets: [10],
            edgeToBogie: 2.5,
            bogieToEdge: 2.5,
            width: 2.5,
        };
        store.add(tpl);
        expect(store.has('a')).toBe(true);
        store.remove('a');
        expect(store.has('a')).toBe(false);
        expect(store.getById('a')).toBeNull();
        expect(store.count).toBe(0);

        // Removing unknown id is a no-op
        store.remove('unknown');
        expect(store.count).toBe(0);
    });

    it('update shallow-merges patch; update on unknown id throws', () => {
        const store = new CarTemplateStore();
        const tpl: CarTemplate = {
            id: 'a',
            name: 'Original',
            bogieOffsets: [10],
            edgeToBogie: 2.5,
            bogieToEdge: 2.5,
            width: 2.5,
        };
        store.add(tpl);
        store.update('a', { name: 'Updated' });
        const updated = store.getById('a');
        expect(updated).not.toBeNull();
        expect(updated!.name).toBe('Updated');
        // Verify other fields are preserved
        expect(updated!.bogieOffsets).toEqual([10]);
        expect(updated!.edgeToBogie).toBe(2.5);
        expect(updated!.bogieToEdge).toBe(2.5);
        expect(updated!.width).toBe(2.5);

        expect(() => store.update('unknown', { name: 'Test' })).toThrow();
    });

    it('subscribe listener fires after add/remove/update/hydrate/clearForLoad', () => {
        const store = new CarTemplateStore();
        const calls: number[] = [];
        const unsubscribe = store.subscribe(() => calls.push(calls.length));

        const tpl: CarTemplate = {
            id: 'a',
            bogieOffsets: [10],
            edgeToBogie: 2.5,
            bogieToEdge: 2.5,
            width: 2.5,
        };

        // Test add notification
        store.add(tpl);
        expect(calls).toEqual([0]);

        // Test update notification
        store.update('a', { name: 'Updated' });
        expect(calls).toEqual([0, 1]);

        // Test remove notification
        store.remove('a');
        expect(calls).toEqual([0, 1, 2]);

        // Test hydrate notification
        const tpl2: CarTemplate = {
            id: 'b',
            bogieOffsets: [10],
            edgeToBogie: 2.5,
            bogieToEdge: 2.5,
            width: 2.5,
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
        const store = new CarTemplateStore();
        const tpl: CarTemplate = {
            id: 'a',
            bogieOffsets: [10],
            edgeToBogie: 2.5,
            bogieToEdge: 2.5,
            width: 2.5,
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
        const store = new CarTemplateStore();
        const tpl1: CarTemplate = {
            id: 'initial',
            bogieOffsets: [10],
            edgeToBogie: 2.5,
            bogieToEdge: 2.5,
            width: 2.5,
        };
        store.add(tpl1);

        const calls: number[] = [];
        store.subscribe(() => calls.push(calls.length));

        const tpl2: CarTemplate = {
            id: 'a',
            bogieOffsets: [10],
            edgeToBogie: 2.5,
            bogieToEdge: 2.5,
            width: 2.5,
        };
        const tpl3: CarTemplate = {
            id: 'b',
            bogieOffsets: [10],
            edgeToBogie: 2.5,
            bogieToEdge: 2.5,
            width: 2.5,
        };
        const tpl4: CarTemplate = {
            id: 'c',
            bogieOffsets: [10],
            edgeToBogie: 2.5,
            bogieToEdge: 2.5,
            width: 2.5,
        };

        store.hydrate([tpl2, tpl3, tpl4]);

        // Should fire exactly one notification
        expect(calls).toEqual([0]);

        // Should have exactly those three templates
        expect(store.count).toBe(3);
        expect(store.getById('a')).toEqual(tpl2);
        expect(store.getById('b')).toEqual(tpl3);
        expect(store.getById('c')).toEqual(tpl4);
        // Initial template should be gone
        expect(store.getById('initial')).toBeNull();
    });

    it('clearForLoad empties the store and fires a notification', () => {
        const store = new CarTemplateStore();
        const tpl1: CarTemplate = {
            id: 'a',
            bogieOffsets: [10],
            edgeToBogie: 2.5,
            bogieToEdge: 2.5,
            width: 2.5,
        };
        const tpl2: CarTemplate = {
            id: 'b',
            bogieOffsets: [10],
            edgeToBogie: 2.5,
            bogieToEdge: 2.5,
            width: 2.5,
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
