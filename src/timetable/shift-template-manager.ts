/**
 * Manages shift templates for the timetable system.
 *
 * @module timetable/shift-template-manager
 */
import { Observable, SynchronousObservable } from '@ue-too/board';

import type { PlatformMigrationMap } from '@/stations/track-aligned-platform-migration';

import {
    type DayMask,
    DayOfWeek,
    type SerializedShiftTemplate,
    type ShiftTemplate,
    type ShiftTemplateId,
} from './types';

/** Payload emitted when the shift template collection changes. */
export type ShiftTemplateChangeEvent = {
    type: 'add' | 'update' | 'remove';
    shiftTemplateId: ShiftTemplateId;
};

/**
 * CRUD manager for {@link ShiftTemplate} objects.
 *
 * @example
 * ```typescript
 * const mgr = new ShiftTemplateManager();
 * mgr.addTemplate({
 *   id: 'morning-express',
 *   name: 'Morning Express',
 *   activeDays: weekdaysMask(),
 *   stops: [...],
 *   legs: [...],
 * });
 * ```
 */
export class ShiftTemplateManager {
    private _templates: Map<ShiftTemplateId, ShiftTemplate> = new Map();
    private _observable: Observable<[ShiftTemplateChangeEvent]> =
        new SynchronousObservable<[ShiftTemplateChangeEvent]>();

    // -----------------------------------------------------------------------
    // CRUD
    // -----------------------------------------------------------------------

    /**
     * Add a new shift template.
     *
     * @throws If a template with the same ID already exists.
     * @throws If the stops/legs invariant is violated (`stops.length !== legs.length + 1`).
     */
    addTemplate(template: ShiftTemplate): void {
        if (this._templates.has(template.id)) {
            throw new Error(
                `ShiftTemplate with id "${template.id}" already exists`
            );
        }
        ShiftTemplateManager._validateInvariant(template);
        this._templates.set(template.id, template);
        this._observable.notify({ type: 'add', shiftTemplateId: template.id });
    }

    /**
     * Replace an existing template with updated data.
     *
     * @throws If no template with the given ID exists.
     */
    updateTemplate(template: ShiftTemplate): void {
        if (!this._templates.has(template.id)) {
            throw new Error(
                `ShiftTemplate with id "${template.id}" does not exist`
            );
        }
        ShiftTemplateManager._validateInvariant(template);
        this._templates.set(template.id, template);
        this._observable.notify({
            type: 'update',
            shiftTemplateId: template.id,
        });
    }

    /**
     * Remove a template by ID.
     *
     * @returns `true` if the template existed and was removed.
     */
    removeTemplate(id: ShiftTemplateId): boolean {
        const deleted = this._templates.delete(id);
        if (deleted) {
            this._observable.notify({ type: 'remove', shiftTemplateId: id });
        }
        return deleted;
    }

    /** Retrieve a template by ID, or `null` if not found. */
    getTemplate(id: ShiftTemplateId): ShiftTemplate | null {
        return this._templates.get(id) ?? null;
    }

    /** Return all templates as an array. */
    getAllTemplates(): ShiftTemplate[] {
        return [...this._templates.values()];
    }

    /** Subscribe to template collection changes. Returns an unsubscribe function. */
    subscribe(listener: (event: ShiftTemplateChangeEvent) => void): () => void {
        return this._observable.subscribe(listener);
    }

    // -----------------------------------------------------------------------
    // Validation
    // -----------------------------------------------------------------------

    private static _validateInvariant(template: ShiftTemplate): void {
        if (template.stops.length !== template.legs.length + 1) {
            throw new Error(
                `ShiftTemplate "${template.id}": stops.length (${template.stops.length}) must equal legs.length + 1 (${template.legs.length + 1})`
            );
        }
    }

    /**
     * Rewrite `stopPositionIndex` and `platformId` on every `ScheduledStop`
     * that refers to a track-aligned platform listed in `map`.
     *
     * Intended for one-off migrations on scene load; does not emit change
     * events because the templates have not yet been observed by the UI.
     */
    remapTrackAlignedPlatformReferences(map: PlatformMigrationMap): void {
        if (map.size === 0) return;
        for (const template of this._templates.values()) {
            for (const stop of template.stops) {
                if (stop.platformKind !== 'trackAligned') continue;
                const entries = map.get(stop.platformId);
                if (entries === undefined) continue;
                const target = entries.get(stop.stopPositionIndex);
                if (target === undefined) continue;
                stop.platformId = target.newPlatformId;
                stop.stopPositionIndex = target.newStopIndex;
            }
        }
    }

    // -----------------------------------------------------------------------
    // Serialization
    // -----------------------------------------------------------------------

    serialize(): SerializedShiftTemplate[] {
        return this.getAllTemplates().map(t => ({
            id: t.id,
            name: t.name,
            activeDays: Object.fromEntries(
                Object.entries(t.activeDays).map(([k, v]) => [String(k), v])
            ),
            stops: t.stops.map(s => ({
                stationId: s.stationId,
                platformKind: s.platformKind,
                platformId: s.platformId,
                stopPositionIndex: s.stopPositionIndex,
                arrivalTime: s.arrivalTime,
                departureTime: s.departureTime,
            })),
            legs: t.legs.map(l => ({ routeId: l.routeId })),
        }));
    }

    static deserialize(data: SerializedShiftTemplate[]): ShiftTemplateManager {
        const manager = new ShiftTemplateManager();
        for (const st of data) {
            const activeDays = {} as DayMask;
            for (let d = DayOfWeek.Monday; d <= DayOfWeek.Sunday; d++) {
                activeDays[d as DayOfWeek] = st.activeDays[String(d)] ?? false;
            }
            manager._templates.set(st.id, {
                id: st.id,
                name: st.name,
                activeDays,
                stops: st.stops.map(s => ({
                    stationId: s.stationId,
                    platformKind: s.platformKind ?? 'island',
                    platformId: s.platformId,
                    stopPositionIndex: s.stopPositionIndex,
                    arrivalTime: s.arrivalTime,
                    departureTime: s.departureTime,
                })),
                legs: st.legs.map(l => ({ routeId: l.routeId })),
            });
        }
        return manager;
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a {@link DayMask} with all weekdays active. */
export function weekdaysMask(): DayMask {
    return {
        [DayOfWeek.Monday]: true,
        [DayOfWeek.Tuesday]: true,
        [DayOfWeek.Wednesday]: true,
        [DayOfWeek.Thursday]: true,
        [DayOfWeek.Friday]: true,
        [DayOfWeek.Saturday]: false,
        [DayOfWeek.Sunday]: false,
    };
}

/** Create a {@link DayMask} with all days active. */
export function everydayMask(): DayMask {
    return {
        [DayOfWeek.Monday]: true,
        [DayOfWeek.Tuesday]: true,
        [DayOfWeek.Wednesday]: true,
        [DayOfWeek.Thursday]: true,
        [DayOfWeek.Friday]: true,
        [DayOfWeek.Saturday]: true,
        [DayOfWeek.Sunday]: true,
    };
}
