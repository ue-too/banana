import {
    Observable,
    type SubscriptionOptions,
    SynchronousObservable,
} from '@ue-too/board';
import type { Point } from '@ue-too/math';

import { GenericEntityManager } from '@/utils';

import type {
    AnySerializedTrackAlignedPlatformData,
    LegacySerializedTrackAlignedPlatform,
    SerializedTrackAlignedPlatform,
    SerializedTrackAlignedPlatformData,
    TrackAlignedPlatform,
} from './track-aligned-platform-types';
import { isLegacySerializedPlatform } from './track-aligned-platform-types';
import {
    splitLegacyDualSpinePlatform,
    type PlatformMigrationMap,
} from './track-aligned-platform-migration';
import { nextStopPositionId } from './stop-position-utils';
import type { TrackDirection } from './types';
import type { ShiftTemplateManager } from '@/timetable/shift-template-manager';
import type { ShiftTemplate } from '@/timetable/types';

export class TrackAlignedPlatformManager {
    private _manager: GenericEntityManager<TrackAlignedPlatform>;
    private _changeObservable: Observable<[]> = new SynchronousObservable<[]>();

    constructor(initialCount = 10) {
        this._manager = new GenericEntityManager<TrackAlignedPlatform>(
            initialCount
        );
    }

    /** Subscribe to notifications when platforms are created or destroyed. */
    onChange(callback: () => void, options?: SubscriptionOptions) {
        return this._changeObservable.subscribe(callback, options);
    }

    // -----------------------------------------------------------------------
    // CRUD
    // -----------------------------------------------------------------------

    createPlatformWithId(
        id: number,
        platform: Omit<TrackAlignedPlatform, 'id'>
    ): void {
        this._manager.createEntityWithId(id, {
            ...platform,
            id,
        } as TrackAlignedPlatform);
        this._changeObservable.notify();
    }

    getAllPlatforms(): { id: number; platform: TrackAlignedPlatform }[] {
        return this._manager
            .getLivingEntitiesWithIndex()
            .map(({ index, entity }) => ({ id: index, platform: entity }));
    }

    createPlatform(platform: Omit<TrackAlignedPlatform, 'id'>): number {
        const id = this._manager.createEntity({
            ...platform,
            id: -1,
        } as TrackAlignedPlatform);
        const entity = this._manager.getEntity(id);
        if (entity) entity.id = id;
        this._changeObservable.notify();
        return id;
    }

    getPlatform(id: number): TrackAlignedPlatform | null {
        return this._manager.getEntity(id);
    }

    destroyPlatform(id: number): void {
        this._manager.destroyEntity(id);
        this._changeObservable.notify();
    }

    destroyPlatformsForStation(stationId: number): void {
        const toDestroy = this._manager
            .getLivingEntitiesWithIndex()
            .filter(({ entity }) => entity.stationId === stationId)
            .map(({ index }) => index);
        for (const id of toDestroy) {
            this._manager.destroyEntity(id);
        }
        if (toDestroy.length > 0) this._changeObservable.notify();
    }

    /** Manually trigger change notifications (e.g. after updating station references). */
    notifyChange(): void {
        this._changeObservable.notify();
    }

    // -----------------------------------------------------------------------
    // Lookups
    // -----------------------------------------------------------------------

    getPlatformsByStation(
        stationId: number
    ): { id: number; platform: TrackAlignedPlatform }[] {
        return this._manager
            .getLivingEntitiesWithIndex()
            .filter(({ entity }) => entity.stationId === stationId)
            .map(({ index, entity }) => ({ id: index, platform: entity }));
    }

    getPlatformsBySegment(
        segmentId: number
    ): { id: number; platform: TrackAlignedPlatform }[] {
        return this._manager
            .getLivingEntitiesWithIndex()
            .filter(({ entity }) =>
                entity.spine.some(e => e.trackSegment === segmentId)
            )
            .map(({ index, entity }) => ({ id: index, platform: entity }));
    }

    // -----------------------------------------------------------------------
    // Stop position CRUD
    // -----------------------------------------------------------------------

    addStopPosition(
        platformId: number,
        input: { trackSegmentId: number; direction: TrackDirection; tValue: number },
    ): number {
        const platform = this._getPlatformOrThrow(platformId);
        this._validateStop(platform, input);
        const id = nextStopPositionId(platform.stopPositions);
        platform.stopPositions.push({ id, ...input });
        this._changeObservable.notify();
        return id;
    }

    updateStopPosition(
        platformId: number,
        stopId: number,
        patch: { trackSegmentId?: number; direction?: TrackDirection; tValue?: number },
    ): void {
        const platform = this._getPlatformOrThrow(platformId);
        const stop = platform.stopPositions.find((s) => s.id === stopId);
        if (!stop) {
            throw new Error(
                `TrackAlignedPlatformManager.updateStopPosition: stop ${stopId} not found on platform ${platformId}`,
            );
        }
        const next = {
            trackSegmentId: patch.trackSegmentId ?? stop.trackSegmentId,
            direction: patch.direction ?? stop.direction,
            tValue: patch.tValue ?? stop.tValue,
        };
        this._validateStop(platform, next);
        stop.trackSegmentId = next.trackSegmentId;
        stop.direction = next.direction;
        stop.tValue = next.tValue;
        this._changeObservable.notify();
    }

    removeStopPosition(platformId: number, stopId: number): void {
        const platform = this._getPlatformOrThrow(platformId);
        const before = platform.stopPositions.length;
        platform.stopPositions = platform.stopPositions.filter((s) => s.id !== stopId);
        if (platform.stopPositions.length !== before) {
            this._changeObservable.notify();
        }
    }

    private _getPlatformOrThrow(platformId: number): TrackAlignedPlatform {
        const platform = this._manager.getEntity(platformId);
        if (!platform) {
            throw new Error(
                `TrackAlignedPlatformManager: platform ${platformId} not found`,
            );
        }
        return platform;
    }

    private _validateStop(
        platform: TrackAlignedPlatform,
        input: { trackSegmentId: number; tValue: number },
    ): void {
        const entry = platform.spine.find((e) => e.trackSegment === input.trackSegmentId);
        if (!entry) {
            throw new Error(
                `TrackAlignedPlatformManager: trackSegmentId ${input.trackSegmentId} is not on platform ${platform.id}`,
            );
        }
        const lo = Math.min(entry.tStart, entry.tEnd);
        const hi = Math.max(entry.tStart, entry.tEnd);
        if (input.tValue < lo || input.tValue > hi) {
            throw new Error(
                `TrackAlignedPlatformManager: tValue ${input.tValue} is outside spine entry range [${lo}, ${hi}] for segment ${input.trackSegmentId}`,
            );
        }
    }

    findShiftsReferencingStopPosition(
        platformId: number,
        stopPositionId: number,
        shiftTemplateManager: ShiftTemplateManager,
    ): ShiftTemplate[] {
        const result: ShiftTemplate[] = [];
        for (const template of shiftTemplateManager.getAllTemplates()) {
            for (const stop of template.stops) {
                if (
                    stop.platformKind === 'trackAligned' &&
                    stop.platformId === platformId &&
                    stop.stopPositionId === stopPositionId
                ) {
                    result.push(template);
                    break;
                }
            }
        }
        return result;
    }

    // -----------------------------------------------------------------------
    // Serialization
    // -----------------------------------------------------------------------

    serialize(): SerializedTrackAlignedPlatformData {
        const platforms: SerializedTrackAlignedPlatform[] = this._manager
            .getLivingEntitiesWithIndex()
            .map(({ index, entity }) => ({
                id: index,
                stationId: entity.stationId,
                spine: entity.spine.map(e => ({
                    trackSegment: e.trackSegment,
                    tStart: e.tStart,
                    tEnd: e.tEnd,
                    side: e.side,
                })),
                offset: entity.offset,
                outerVertices: entity.outerVertices.map(v => ({
                    x: v.x,
                    y: v.y,
                })),
                stopPositions: entity.stopPositions.map(sp => ({ ...sp })),
            }));

        return { platforms };
    }

    static deserialize(
        data: SerializedTrackAlignedPlatformData
    ): TrackAlignedPlatformManager {
        const maxId = data.platforms.reduce(
            (max, p) => Math.max(max, p.id),
            -1
        );
        const manager = new TrackAlignedPlatformManager(
            Math.max(maxId + 1, 10)
        );
        for (const p of data.platforms) {
            manager._manager.createEntityWithId(p.id, {
                id: p.id,
                stationId: p.stationId,
                spine: p.spine.map(e => ({
                    trackSegment: e.trackSegment,
                    tStart: e.tStart,
                    tEnd: e.tEnd,
                    side: e.side,
                })),
                offset: p.offset,
                outerVertices: p.outerVertices.map(v => ({ x: v.x, y: v.y })),
                stopPositions: p.stopPositions.map((sp, i) => ({
                    id: typeof sp.id === 'number' ? sp.id : i,
                    trackSegmentId: sp.trackSegmentId,
                    direction: sp.direction,
                    tValue: sp.tValue,
                })),
            });
        }
        return manager;
    }

    /**
     * Deserialize a serialized platforms payload that may contain legacy
     * dual-spine entries.  Dual-spine platforms are split into two single-spine
     * platforms and `migrationMap` records where each legacy stop-position
     * index landed, so the caller can rewrite timetable references.
     *
     * For new-format payloads, the migration map is empty and platform IDs are
     * preserved unchanged.
     *
     * @param data - Serialized payload in legacy or new format.
     * @param getMidline - Callback that returns the midline polyline used as
     *   each split face's `outerVertices`. The scene loader supplies a real
     *   geometric midline via `computeDualSpineMidline`; tests can inject a
     *   stub polyline.
     */
    static deserializeAny(
        data: AnySerializedTrackAlignedPlatformData,
        getMidline: (legacy: LegacySerializedTrackAlignedPlatform) => Point[],
    ): { manager: TrackAlignedPlatformManager; migrationMap: PlatformMigrationMap; splitIds: Map<number, [number, number]> } {
        const migrationMap: PlatformMigrationMap = new Map();
        const splitIds: Map<number, [number, number]> = new Map();

        // Pre-compute the maximum id so assigned new ids do not collide with
        // existing ones.
        let maxId = data.platforms.reduce((max, p) => Math.max(max, p.id), -1);
        const manager = new TrackAlignedPlatformManager(Math.max(maxId + 1, 10));

        const nextId = () => ++maxId;

        for (const p of data.platforms) {
            if (!isLegacySerializedPlatform(p)) {
                // Already new format.
                manager._manager.createEntityWithId(p.id, {
                    id: p.id,
                    stationId: p.stationId,
                    spine: p.spine.map(e => ({ ...e })),
                    offset: p.offset,
                    outerVertices: p.outerVertices.map(v => ({ x: v.x, y: v.y })),
                    stopPositions: p.stopPositions.map((sp, i) => ({
                        id: typeof sp.id === 'number' ? sp.id : i,
                        trackSegmentId: sp.trackSegmentId,
                        direction: sp.direction,
                        tValue: sp.tValue,
                    })),
                });
                continue;
            }

            // Legacy path.
            if (p.spineB === null) {
                // Legacy single-spine: flatten outerVertices and keep the id.
                const verts =
                    p.outerVertices.kind === 'single'
                        ? p.outerVertices.vertices.map(v => ({ x: v.x, y: v.y }))
                        : [];
                manager._manager.createEntityWithId(p.id, {
                    id: p.id,
                    stationId: p.stationId,
                    spine: p.spineA.map(e => ({ ...e })),
                    offset: p.offset,
                    outerVertices: verts,
                    stopPositions: p.stopPositions.map((sp, i) => ({
                        id: typeof sp.id === 'number' ? sp.id : i,
                        trackSegmentId: sp.trackSegmentId,
                        direction: sp.direction,
                        tValue: sp.tValue,
                    })),
                });
                continue;
            }

            // Legacy dual-spine: split into two platforms.
            const { faceA, faceB, stopIndexMap } = splitLegacyDualSpinePlatform(
                p,
                () => getMidline(p),
            );
            const idA = nextId();
            const idB = nextId();
            manager._manager.createEntityWithId(idA, { ...faceA, id: idA });
            manager._manager.createEntityWithId(idB, { ...faceB, id: idB });
            splitIds.set(p.id, [idA, idB]);

            const entries = new Map<number, { newPlatformId: number; newStopIndex: number; newStopId: number }>();
            for (let i = 0; i < stopIndexMap.length; i++) {
                const mapEntry = stopIndexMap[i];
                entries.set(i, {
                    newPlatformId: mapEntry.face === 'A' ? idA : idB,
                    newStopIndex: mapEntry.newIndex,
                    newStopId: mapEntry.newId,
                });
            }
            migrationMap.set(p.id, entries);
        }

        return { manager, migrationMap, splitIds };
    }
}
