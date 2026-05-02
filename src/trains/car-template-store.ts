import type { CarTemplate } from './car-template';

/**
 * Manages a collection of car templates (blueprints).
 * Templates are stored in a map and can be added, updated, removed, and queried.
 * Supports subscriptions for external stores (e.g. useSyncExternalStore).
 */
export class CarTemplateStore {
    private _templates: Map<string, CarTemplate> = new Map();
    private _listeners: (() => void)[] = [];
    private _snapshot: readonly CarTemplate[] = [];

    /** Stable-reference array for use with useSyncExternalStore. */
    getAll(): readonly CarTemplate[] {
        return this._snapshot;
    }

    /** Get a specific template by its ID, or null if not found. */
    getById(id: string): CarTemplate | null {
        return this._templates.get(id) ?? null;
    }

    /** Whether a template with the given ID exists. */
    has(id: string): boolean {
        return this._templates.has(id);
    }

    /** Insert a new template. Throws if id collides. */
    add(template: CarTemplate): void {
        if (this._templates.has(template.id)) {
            throw new Error(
                `Template with ID ${template.id} is already in the store`
            );
        }
        this._templates.set(template.id, template);
        this._rebuildSnapshot();
        this._notify();
    }

    /** Remove a template. No-op when id is unknown. */
    remove(id: string): void {
        if (!this._templates.has(id)) return;
        this._templates.delete(id);
        this._rebuildSnapshot();
        this._notify();
    }

    /** Shallow-merge `patch` into the template; throws when the id is unknown. */
    update(id: string, patch: Partial<Omit<CarTemplate, 'id'>>): void {
        const template = this._templates.get(id);
        if (template === undefined) {
            throw new Error(`Template ${id} is not in the store`);
        }
        // Shallow merge patch into the existing template
        Object.assign(template, patch);
        this._rebuildSnapshot();
        this._notify();
    }

    /** Number of templates currently in the store. */
    get count(): number {
        return this._templates.size;
    }

    /** Subscribe to any store change. Returns unsubscribe function. */
    subscribe(listener: () => void): () => void {
        this._listeners.push(listener);
        return () => {
            const i = this._listeners.indexOf(listener);
            if (i >= 0) this._listeners.splice(i, 1);
        };
    }

    /** Bulk replace, used when hydrating a scene file. */
    hydrate(templates: readonly CarTemplate[]): void {
        this._templates.clear();
        for (const tpl of templates) {
            this._templates.set(tpl.id, tpl);
        }
        this._rebuildSnapshot();
        this._notify();
    }

    /** Clear all templates. Used when loading a scene with no templates field. */
    clearForLoad(): void {
        this._templates.clear();
        this._rebuildSnapshot();
        this._notify();
    }

    private _rebuildSnapshot(): void {
        this._snapshot = Array.from(this._templates.values());
    }

    private _notify(): void {
        for (const fn of this._listeners) fn();
    }
}
