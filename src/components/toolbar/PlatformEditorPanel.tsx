import { useCallback, useState } from 'react';
import { Plus, Trash2 } from '@/assets/icons';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { DraggablePanel } from '@/components/ui/draggable-panel';
import { Separator } from '@/components/ui/separator';

import type { StationManager } from '@/stations/station-manager';
import type { TrackAlignedPlatformManager } from '@/stations/track-aligned-platform-manager';
import type { ShiftTemplateManager } from '@/timetable/shift-template-manager';
import type { TrackGraph } from '@/trains/tracks/track';
import type { SpineEntry } from '@/stations/track-aligned-platform-types';
import type { StopPosition, TrackDirection } from '@/stations/types';

import { normalizedToStop, stopToNormalized } from '@/stations/arc-length-resolver';

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
    trackAlignedPlatformManager: TrackAlignedPlatformManager,
): SpineEntry[] | null {
    if (target.kind === 'trackAligned') {
        const tap = trackAlignedPlatformManager.getPlatform(target.platformId);
        return tap?.spine ?? null;
    }
    const station = stationManager.getStation(target.stationId);
    const platform = station?.platforms.find((p) => p.id === target.platformId);
    if (!platform) return null;
    // Island platforms have a single segment covering [0, 1].
    return [{ trackSegment: platform.track, tStart: 0, tEnd: 1, side: 1 }];
}

function getStopPositions(
    target: PlatformTarget,
    stationManager: StationManager,
    trackAlignedPlatformManager: TrackAlignedPlatformManager,
): StopPosition[] {
    if (target.kind === 'trackAligned') {
        const tap = trackAlignedPlatformManager.getPlatform(target.platformId);
        return tap?.stopPositions ?? [];
    }
    const station = stationManager.getStation(target.stationId);
    const platform = station?.platforms.find((p) => p.id === target.platformId);
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
    trackAlignedPlatformManager: TrackAlignedPlatformManager,
): number[] {
    if (target.kind === 'trackAligned') {
        const tap = trackAlignedPlatformManager.getPlatform(target.platformId);
        return tap?.spine.map((e) => e.trackSegment) ?? [];
    }
    const station = stationManager.getStation(target.stationId);
    const platform = station?.platforms.find((p) => p.id === target.platformId);
    return platform ? [platform.track] : [];
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
    onClose,
    onStopChange,
}: PlatformEditorPanelProps) {
    const { t } = useTranslation();
    // Bump to force re-render after mutations.
    const [, setVersion] = useState(0);
    const bump = () => setVersion((v) => v + 1);

    // Pending deletion — if non-null, show the confirmation dialog.
    const [pendingDelete, setPendingDelete] = useState<{
        stopId: number;
        referencingShifts: string[];
    } | null>(null);

    const spine = getSpineForTarget(target, stationManager, trackAlignedPlatformManager);
    const stops = getStopPositions(target, stationManager, trackAlignedPlatformManager);
    const label = getLabel(target);
    const segmentIds = getSegmentIds(target, stationManager, trackAlignedPlatformManager);

    const getCurve = useCallback(
        (segmentId: number) => {
            const curve = trackGraph.getTrackSegmentCurve(segmentId);
            if (curve === null) throw new Error(`Missing curve for segment ${segmentId}`);
            return curve;
        },
        [trackGraph],
    );

    // --- Handlers ---

    const handleSliderChange = useCallback(
        (stopId: number, normalized: number) => {
            if (!spine) return;
            const resolved = normalizedToStop(spine, normalized, getCurve);
            if (target.kind === 'trackAligned') {
                trackAlignedPlatformManager.updateStopPosition(target.platformId, stopId, {
                    tValue: resolved.tValue,
                });
            } else {
                stationManager.updateStopPosition(target.stationId, target.platformId, stopId, {
                    tValue: resolved.tValue,
                });
            }
            onStopChange?.();
            bump();
        },
        [spine, getCurve, target, stationManager, trackAlignedPlatformManager, onStopChange],
    );

    const handleDirectionToggle = useCallback(
        (stopId: number, currentDirection: TrackDirection) => {
            const next: TrackDirection = currentDirection === 'tangent' ? 'reverseTangent' : 'tangent';
            if (target.kind === 'trackAligned') {
                trackAlignedPlatformManager.updateStopPosition(target.platformId, stopId, {
                    direction: next,
                });
            } else {
                stationManager.updateStopPosition(target.stationId, target.platformId, stopId, {
                    direction: next,
                });
            }
            onStopChange?.();
            bump();
        },
        [target, stationManager, trackAlignedPlatformManager, onStopChange],
    );

    const handleDelete = useCallback(
        (stopId: number) => {
            // Check for references.
            let refs: { id: string; name: string }[];
            if (target.kind === 'trackAligned') {
                refs = trackAlignedPlatformManager
                    .findShiftsReferencingStopPosition(target.platformId, stopId, shiftTemplateManager)
                    .map((s) => ({ id: s.id, name: s.name }));
            } else {
                refs = stationManager
                    .findShiftsReferencingStopPosition(target.stationId, target.platformId, stopId, shiftTemplateManager)
                    .map((s) => ({ id: s.id, name: s.name }));
            }

            if (refs.length > 0) {
                setPendingDelete({ stopId, referencingShifts: refs.map((r) => r.name) });
                return;
            }

            // No references — delete immediately.
            if (target.kind === 'trackAligned') {
                trackAlignedPlatformManager.removeStopPosition(target.platformId, stopId);
            } else {
                stationManager.removeStopPosition(target.stationId, target.platformId, stopId);
            }
            onStopChange?.();
            bump();
        },
        [target, stationManager, trackAlignedPlatformManager, shiftTemplateManager, onStopChange],
    );

    const handleConfirmDelete = useCallback(() => {
        if (!pendingDelete) return;
        if (target.kind === 'trackAligned') {
            trackAlignedPlatformManager.removeStopPosition(target.platformId, pendingDelete.stopId);
        } else {
            stationManager.removeStopPosition(target.stationId, target.platformId, pendingDelete.stopId);
        }
        setPendingDelete(null);
        onStopChange?.();
        bump();
    }, [pendingDelete, target, stationManager, trackAlignedPlatformManager, onStopChange]);

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
            stationManager.addStopPosition(target.stationId, target.platformId, {
                trackSegmentId: mid.trackSegmentId,
                direction: 'tangent',
                tValue: mid.tValue,
            });
        }
        onStopChange?.();
        bump();
    }, [spine, getCurve, target, stationManager, trackAlignedPlatformManager, onStopChange]);

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
                            ? stopToNormalized(spine, stop.trackSegmentId, stop.tValue, getCurve)
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
                                    onChange={(e) =>
                                        handleSliderChange(
                                            stop.id,
                                            parseFloat(e.target.value),
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
                                            stop.direction,
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
                                shifts: pendingDelete.referencingShifts.join(', '),
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
        </DraggablePanel>
    );
}

export type { PlatformTarget };
