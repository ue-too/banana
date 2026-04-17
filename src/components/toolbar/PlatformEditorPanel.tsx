import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Plus, Trash2 } from '@/assets/icons';
import { Button } from '@/components/ui/button';
import { DraggablePanel } from '@/components/ui/draggable-panel';
import { Separator } from '@/components/ui/separator';
import {
    type PlatformBufferStore,
    type PlatformHandle,
    type PlatformRole,
    RESOURCE_TYPES,
    type ResourceTypeId,
} from '@/resources';
import {
    normalizedToStop,
    stopToNormalized,
} from '@/stations/arc-length-resolver';
import type { StationManager } from '@/stations/station-manager';
import type { TrackAlignedPlatformManager } from '@/stations/track-aligned-platform-manager';
import type { SpineEntry } from '@/stations/track-aligned-platform-types';
import type { StopPosition, TrackDirection } from '@/stations/types';
import type { ShiftTemplateManager } from '@/timetable/shift-template-manager';
import type { TrackGraph } from '@/trains/tracks/track';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PlatformTarget =
    | { kind: 'island'; stationId: number; platformId: number }
    | { kind: 'trackAligned'; platformId: number };

type PlatformEditorPanelProps = {
    target: PlatformTarget;
    stationManager: StationManager;
    trackAlignedPlatformManager: TrackAlignedPlatformManager;
    shiftTemplateManager: ShiftTemplateManager;
    trackGraph: TrackGraph;
    platformBufferStore: PlatformBufferStore;
    onClose: () => void;
    /** Called after any stop mutation so the caller can refresh debug overlays etc. */
    onStopChange?: () => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSpineForTarget(
    target: PlatformTarget,
    stationManager: StationManager,
    trackAlignedPlatformManager: TrackAlignedPlatformManager
): SpineEntry[] | null {
    if (target.kind === 'trackAligned') {
        const tap = trackAlignedPlatformManager.getPlatform(target.platformId);
        return tap?.spine ?? null;
    }
    const station = stationManager.getStation(target.stationId);
    const platform = station?.platforms.find(p => p.id === target.platformId);
    if (!platform) return null;
    // Island platforms have a single segment covering [0, 1].
    return [{ trackSegment: platform.track, tStart: 0, tEnd: 1, side: 1 }];
}

function getStopPositions(
    target: PlatformTarget,
    stationManager: StationManager,
    trackAlignedPlatformManager: TrackAlignedPlatformManager
): StopPosition[] {
    if (target.kind === 'trackAligned') {
        const tap = trackAlignedPlatformManager.getPlatform(target.platformId);
        return tap?.stopPositions ?? [];
    }
    const station = stationManager.getStation(target.stationId);
    const platform = station?.platforms.find(p => p.id === target.platformId);
    return platform?.stopPositions ?? [];
}

function getLabel(target: PlatformTarget): string {
    return target.kind === 'trackAligned'
        ? `T${target.platformId}`
        : `P${target.platformId}`;
}

function getSegmentIds(
    target: PlatformTarget,
    stationManager: StationManager,
    trackAlignedPlatformManager: TrackAlignedPlatformManager
): number[] {
    if (target.kind === 'trackAligned') {
        const tap = trackAlignedPlatformManager.getPlatform(target.platformId);
        return tap?.spine.map(e => e.trackSegment) ?? [];
    }
    const station = stationManager.getStation(target.stationId);
    const platform = station?.platforms.find(p => p.id === target.platformId);
    return platform ? [platform.track] : [];
}

// ---------------------------------------------------------------------------
// Resources subcomponent
// ---------------------------------------------------------------------------

type PlatformResourcesSectionProps = {
    handle: PlatformHandle;
    store: PlatformBufferStore;
};

function PlatformResourcesSection({
    handle,
    store,
}: PlatformResourcesSectionProps) {
    const { t } = useTranslation();
    // Poll-driven re-render: buffer contents change every tick.
    // Using a tick counter rather than store subscription because
    // SourceSinkTicker mutates the buffer without firing an event.
    const [, setTick] = useState(0);
    useEffect(() => {
        const id = setInterval(() => setTick(x => x + 1), 250);
        return () => clearInterval(id);
    }, []);

    const config = store.getConfig(handle);
    const buffer = store.getEffectiveBuffer(handle);

    return (
        <section className="flex flex-col gap-2 p-2">
            <h4 className="text-sm font-semibold">
                {t('panel.platform.resources.title')}
            </h4>
            <label className="flex items-center gap-2 text-sm">
                <input
                    type="checkbox"
                    checked={config.bufferMode === 'sharedWithStation'}
                    onChange={e => {
                        store.setBufferMode(
                            handle,
                            e.target.checked ? 'sharedWithStation' : 'private'
                        );
                        setTick(x => x + 1);
                    }}
                />
                {t('panel.platform.resources.bufferShared')}
            </label>
            <ul className="flex flex-col gap-1">
                {RESOURCE_TYPES.map(rt => (
                    <li
                        key={rt.id}
                        className="grid grid-cols-[1fr_auto_auto] items-center gap-2 text-sm"
                    >
                        <span>{t(rt.displayNameKey)}</span>
                        <span className="tabular-nums">
                            {Math.floor(buffer[rt.id] ?? 0)}
                        </span>
                        <select
                            className="bg-background rounded border px-1 py-0.5"
                            value={store.getRole(handle, rt.id)}
                            onChange={e => {
                                store.setRole(
                                    handle,
                                    rt.id as ResourceTypeId,
                                    e.target.value as PlatformRole | 'neither'
                                );
                                setTick(x => x + 1);
                            }}
                        >
                            <option value="neither">
                                {t('panel.platform.resources.roleNeither')}
                            </option>
                            <option value="source">
                                {t('panel.platform.resources.roleSource')}
                            </option>
                            <option value="sink">
                                {t('panel.platform.resources.roleSink')}
                            </option>
                        </select>
                    </li>
                ))}
            </ul>
        </section>
    );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PlatformEditorPanel({
    target,
    stationManager,
    trackAlignedPlatformManager,
    shiftTemplateManager,
    trackGraph,
    platformBufferStore,
    onClose,
    onStopChange,
}: PlatformEditorPanelProps) {
    const { t } = useTranslation();
    // Bump to force re-render after mutations.
    const [, setVersion] = useState(0);
    const bump = () => setVersion(v => v + 1);

    // Pending deletion — if non-null, show the confirmation dialog.
    const [pendingDelete, setPendingDelete] = useState<{
        stopId: number;
        referencingShifts: string[];
    } | null>(null);

    const spine = getSpineForTarget(
        target,
        stationManager,
        trackAlignedPlatformManager
    );
    const stops = getStopPositions(
        target,
        stationManager,
        trackAlignedPlatformManager
    );
    const label = getLabel(target);
    const segmentIds = getSegmentIds(
        target,
        stationManager,
        trackAlignedPlatformManager
    );

    // Derive a PlatformHandle for the resources section.
    // trackAligned platforms store their stationId on the entity itself.
    const platformHandle: PlatformHandle | null =
        target.kind === 'island'
            ? {
                  kind: 'island',
                  stationId: target.stationId,
                  platformId: target.platformId,
              }
            : (() => {
                  const tap = trackAlignedPlatformManager.getPlatform(
                      target.platformId
                  );
                  if (!tap) return null;
                  return {
                      kind: 'trackAligned' as const,
                      stationId: tap.stationId,
                      platformId: target.platformId,
                  };
              })();

    const getCurve = useCallback(
        (segmentId: number) => {
            const curve = trackGraph.getTrackSegmentCurve(segmentId);
            if (curve === null)
                throw new Error(`Missing curve for segment ${segmentId}`);
            return curve;
        },
        [trackGraph]
    );

    // --- Handlers ---

    const handleSliderChange = useCallback(
        (stopId: number, normalized: number) => {
            if (!spine) return;
            const resolved = normalizedToStop(spine, normalized, getCurve);
            if (target.kind === 'trackAligned') {
                trackAlignedPlatformManager.updateStopPosition(
                    target.platformId,
                    stopId,
                    {
                        trackSegmentId: resolved.trackSegmentId,
                        tValue: resolved.tValue,
                    }
                );
            } else {
                stationManager.updateStopPosition(
                    target.stationId,
                    target.platformId,
                    stopId,
                    {
                        tValue: resolved.tValue,
                    }
                );
            }
            onStopChange?.();
            bump();
        },
        [
            spine,
            getCurve,
            target,
            stationManager,
            trackAlignedPlatformManager,
            onStopChange,
        ]
    );

    const handleDirectionToggle = useCallback(
        (stopId: number, currentDirection: TrackDirection) => {
            const next: TrackDirection =
                currentDirection === 'tangent' ? 'reverseTangent' : 'tangent';
            if (target.kind === 'trackAligned') {
                trackAlignedPlatformManager.updateStopPosition(
                    target.platformId,
                    stopId,
                    {
                        direction: next,
                    }
                );
            } else {
                stationManager.updateStopPosition(
                    target.stationId,
                    target.platformId,
                    stopId,
                    {
                        direction: next,
                    }
                );
            }
            onStopChange?.();
            bump();
        },
        [target, stationManager, trackAlignedPlatformManager, onStopChange]
    );

    const handleDelete = useCallback(
        (stopId: number) => {
            // Check for references.
            let refs: { id: string; name: string }[];
            if (target.kind === 'trackAligned') {
                refs = trackAlignedPlatformManager
                    .findShiftsReferencingStopPosition(
                        target.platformId,
                        stopId,
                        shiftTemplateManager
                    )
                    .map(s => ({ id: s.id, name: s.name }));
            } else {
                refs = stationManager
                    .findShiftsReferencingStopPosition(
                        target.stationId,
                        target.platformId,
                        stopId,
                        shiftTemplateManager
                    )
                    .map(s => ({ id: s.id, name: s.name }));
            }

            if (refs.length > 0) {
                setPendingDelete({
                    stopId,
                    referencingShifts: refs.map(r => r.name),
                });
                return;
            }

            // No references — delete immediately.
            if (target.kind === 'trackAligned') {
                trackAlignedPlatformManager.removeStopPosition(
                    target.platformId,
                    stopId
                );
            } else {
                stationManager.removeStopPosition(
                    target.stationId,
                    target.platformId,
                    stopId
                );
            }
            onStopChange?.();
            bump();
        },
        [
            target,
            stationManager,
            trackAlignedPlatformManager,
            shiftTemplateManager,
            onStopChange,
        ]
    );

    const handleConfirmDelete = useCallback(() => {
        if (!pendingDelete) return;
        if (target.kind === 'trackAligned') {
            trackAlignedPlatformManager.removeStopPosition(
                target.platformId,
                pendingDelete.stopId
            );
        } else {
            stationManager.removeStopPosition(
                target.stationId,
                target.platformId,
                pendingDelete.stopId
            );
        }
        setPendingDelete(null);
        onStopChange?.();
        bump();
    }, [
        pendingDelete,
        target,
        stationManager,
        trackAlignedPlatformManager,
        onStopChange,
    ]);

    const handleAddStop = useCallback(() => {
        if (!spine) return;
        // Default: midpoint, tangent direction.
        const mid = normalizedToStop(spine, 0.5, getCurve);
        if (target.kind === 'trackAligned') {
            trackAlignedPlatformManager.addStopPosition(target.platformId, {
                trackSegmentId: mid.trackSegmentId,
                direction: 'tangent',
                tValue: mid.tValue,
            });
        } else {
            stationManager.addStopPosition(
                target.stationId,
                target.platformId,
                {
                    trackSegmentId: mid.trackSegmentId,
                    direction: 'tangent',
                    tValue: mid.tValue,
                }
            );
        }
        onStopChange?.();
        bump();
    }, [
        spine,
        getCurve,
        target,
        stationManager,
        trackAlignedPlatformManager,
        onStopChange,
    ]);

    // --- Render ---

    return (
        <DraggablePanel
            title={`${t('platformEditor')} — ${label}`}
            onClose={onClose}
            className="w-64"
        >
            <span className="text-muted-foreground text-[10px]">
                {t('platform', { count: 1 })} · S{segmentIds.join(',')}
            </span>
            <Separator className="my-1" />

            <div className="flex items-center justify-between">
                <span className="text-xs font-medium">
                    {t('stopPositions')}
                </span>
            </div>

            {stops.length === 0 ? (
                <span className="text-muted-foreground py-2 text-center text-xs">
                    {t('noStopPositions')}
                </span>
            ) : (
                <div className="flex max-h-48 flex-col gap-1 overflow-y-auto py-1">
                    {stops.map((stop, arrayIndex) => {
                        const normalized = spine
                            ? stopToNormalized(
                                  spine,
                                  stop.trackSegmentId,
                                  stop.tValue,
                                  getCurve
                              )
                            : 0;
                        return (
                            <div
                                key={stop.id}
                                className="bg-muted/50 flex items-center gap-1 rounded px-1.5 py-1"
                            >
                                <span className="text-muted-foreground w-6 shrink-0 text-[10px]">
                                    [{arrayIndex}]
                                </span>
                                <input
                                    type="range"
                                    min={0}
                                    max={1}
                                    step={0.001}
                                    value={normalized}
                                    onChange={e =>
                                        handleSliderChange(
                                            stop.id,
                                            parseFloat(e.target.value)
                                        )
                                    }
                                    className="h-1 flex-1"
                                />
                                <button
                                    type="button"
                                    className="bg-muted hover:bg-foreground/20 w-6 shrink-0 rounded text-center text-[10px] transition-colors"
                                    onClick={() =>
                                        handleDirectionToggle(
                                            stop.id,
                                            stop.direction
                                        )
                                    }
                                    title={stop.direction}
                                >
                                    {stop.direction === 'tangent'
                                        ? t('directionTangent')
                                        : t('directionReverseTangent')}
                                </button>
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    onClick={() => handleDelete(stop.id)}
                                    title={t('deleteStopPosition')}
                                >
                                    <Trash2 className="size-3" />
                                </Button>
                            </div>
                        );
                    })}
                </div>
            )}

            <Button
                variant="ghost"
                size="xs"
                className="mt-1 w-full"
                onClick={handleAddStop}
            >
                <Plus className="mr-1 size-3" />
                {t('addStopPosition')}
            </Button>

            {/* Deletion guard dialog */}
            {pendingDelete && (
                <>
                    <Separator className="my-1" />
                    <div className="bg-destructive/10 rounded p-2">
                        <p className="text-destructive text-xs font-medium">
                            {t('confirmDeleteStopTitle')}
                        </p>
                        <p className="text-muted-foreground mt-1 text-[10px]">
                            {t('confirmDeleteStopMessage', {
                                count: pendingDelete.referencingShifts.length,
                                shifts: pendingDelete.referencingShifts.join(
                                    ', '
                                ),
                            })}
                        </p>
                        <div className="mt-2 flex gap-1">
                            <Button
                                variant="destructive"
                                size="xs"
                                onClick={handleConfirmDelete}
                            >
                                {t('confirmDeleteStopConfirm')}
                            </Button>
                            <Button
                                variant="ghost"
                                size="xs"
                                onClick={() => setPendingDelete(null)}
                            >
                                {t('confirmDeleteStopCancel')}
                            </Button>
                        </div>
                    </div>
                </>
            )}

            {platformHandle && (
                <>
                    <Separator className="my-1" />
                    <PlatformResourcesSection
                        handle={platformHandle}
                        store={platformBufferStore}
                    />
                </>
            )}
        </DraggablePanel>
    );
}

export type { PlatformTarget };
