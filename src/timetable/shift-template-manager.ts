/**
 * Manages shift templates for the timetable system.
 *
 * @module timetable/shift-template-manager
 */
import { Observable, SynchronousObservable } from '@ue-too/board';

import type { PlatformMigrationMap } from '@/stations/track-aligned-platform-migration';
import type { StationManager } from '@/stations/station-manager';
import type { TrackAlignedPlatformManager } from '@/stations/track-aligned-platform-manager';

import {
    type DayMask,
    DayOfWeek,
    type SerializedScheduledStop,
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

    // -----------------------------------------------------------------------
    // Serialization
    // -----------------------------------------------------------------------

    serialize(): SerializedShiftTemplate[] {
        return this.getAllTemplates().map((t) => ({
            id: t.id,
            name: t.name,
            activeDays: Object.fromEntries(
                Object.entries(t.activeDays).map(([k, v]) => [String(k), v]),
            ),
            stops: t.stops.map((s) => ({
                stationId: s.stationId,
                platformKind: s.platformKind,
                platformId: s.platformId,
                stopPositionId: s.stopPositionId,
                arrivalTime: s.arrivalTime,
                departureTime: s.departureTime,
            })),
            legs: t.legs.map((l) => ({ routeId: l.routeId })),
        }));
    }

    static deserialize(
        data: SerializedShiftTemplate[],
        stationManager: StationManager,
        trackAlignedPlatformManager: TrackAlignedPlatformManager,
        platformMigrationMap: PlatformMigrationMap = new Map(),
    ): ShiftTemplateManager {
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
                stops: st.stops.map((s) => {
                    const resolved = ShiftTemplateManager._resolveStopPositionId(
                        s,
                        stationManager,
                        trackAlignedPlatformManager,
                        platformMigrationMap,
                    );
                    return {
                        stationId: s.stationId,
                        platformKind: s.platformKind ?? 'island',
                        platformId: resolved.platformId,
                        stopPositionId: resolved.stopPositionId,
                        arrivalTime: s.arrivalTime,
                        departureTime: s.departureTime,
                    };
                }),
                legs: st.legs.map((l) => ({ routeId: l.routeId })),
            });
        }
        return manager;
    }

    /**
     * Resolve a serialized scheduled stop to a stable `{ platformId, stopPositionId }`.
     *
     * - If `stopPositionId` is present, it wins.
     * - Else if `stopPositionIndex` is present:
     *   - For track-aligned platforms, consult the migration map first
     *     (handles dual-spine split on scene load).
     *   - Otherwise look up the platform's `stopPositions[index].id`.
     * - Returns `-1` for stopPositionId to surface the reference as broken —
     *   the timetable UI / AutoDriver treat negative ids as "no stop".
     */
    private static _resolveStopPositionId(
        s: SerializedScheduledStop,
        stationManager: StationManager,
        trackAlignedPlatformManager: TrackAlignedPlatformManager,
        platformMigrationMap: PlatformMigrationMap,
    ): { platformId: number; stopPositionId: number } {
        // Direct id wins.
        if (typeof s.stopPositionId === 'number') {
            return { platformId: s.platformId, stopPositionId: s.stopPositionId };
        }

        if (typeof s.stopPositionIndex !== 'number') {
            return { platformId: s.platformId, stopPositionId: -1 };
        }

        const kind = s.platformKind ?? 'island';

        // Track-aligned: consult the migration map (handles dual-spine split).
        if (kind === 'trackAligned') {
            const migration = platformMigrationMap
                .get(s.platformId)
                ?.get(s.stopPositionIndex);
            if (migration) {
                if (migration.newStopId < 0) {
                    // Orphaned by the split — return the migrated platform id
                    // but leave the stop reference broken so the UI can flag it.
                    return { platformId: migration.newPlatformId, stopPositionId: -1 };
                }
                return {
                    platformId: migration.newPlatformId,
                    stopPositionId: migration.newStopId,
                };
            }
            // No migration entry: look up directly on the (un-split) platform.
            const tap = trackAlignedPlatformManager.getPlatform(s.platformId);
            const stop = tap?.stopPositions[s.stopPositionIndex];
            return {
                platformId: s.platformId,
                stopPositionId: stop?.id ?? -1,
            };
        }

        // Island platforms never participate in the dual-spine split.
        const station = stationManager.getStation(s.stationId);
        const platform = station?.platforms.find((p) => p.id === s.platformId);
        const stop = platform?.stopPositions[s.stopPositionIndex];
        return { platformId: s.platformId, stopPositionId: stop?.id ?? -1 };
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
