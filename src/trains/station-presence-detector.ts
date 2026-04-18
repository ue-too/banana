import { Observable, SynchronousObservable } from '@ue-too/board';

import type { StationManager } from '@/stations/station-manager';
import type { TrackAlignedPlatformManager } from '@/stations/track-aligned-platform-manager';

import { type ThrottleSteps, isStoppedCommand } from './formation';
import type { OccupancyRegistry } from './occupancy-registry';
import type { TrackGraph } from './tracks/track';
import type { PlacedTrainEntry } from './train-manager';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single indexed stop-position entry, pre-built from platform data. */
export type StopIndexEntry = {
    stationId: number;
    platformId: number;
    platformKind: 'island' | 'trackAligned';
    stopPositionId: number;
    tValue: number;
    direction: 'tangent' | 'reverseTangent';
};

/** Which station/platform/stop a train is currently near. */
export type StationPresence = {
    stationId: number;
    platformId: number;
    platformKind: 'island' | 'trackAligned';
    stopPositionId: number;
};

export type StationPresenceEvent =
    | { type: 'arrived'; trainId: number; presence: StationPresence }
    | { type: 'departed'; trainId: number; previousPresence: StationPresence };

// ---------------------------------------------------------------------------
// Stop index builder
// ---------------------------------------------------------------------------

/**
 * Build a segment-keyed spatial index of all stop positions across all
 * platforms (both island and track-aligned).
 *
 * Rebuilt when platforms are added/removed/modified.
 */
export function buildStopIndex(
    stationManager: StationManager,
    trackAlignedPlatformManager: TrackAlignedPlatformManager
): Map<number, StopIndexEntry[]> {
    const index = new Map<number, StopIndexEntry[]>();

    function addEntry(segmentId: number, entry: StopIndexEntry): void {
        let list = index.get(segmentId);
        if (!list) {
            list = [];
            index.set(segmentId, list);
        }
        list.push(entry);
    }

    // Island platforms
    for (const { id: stationId, station } of stationManager.getStations()) {
        for (const platform of station.platforms) {
            for (const stop of platform.stopPositions) {
                addEntry(stop.trackSegmentId, {
                    stationId,
                    platformId: platform.id,
                    platformKind: 'island',
                    stopPositionId: stop.id,
                    tValue: stop.tValue,
                    direction: stop.direction,
                });
            }
        }
    }

    // Track-aligned platforms
    for (const { platform } of trackAlignedPlatformManager.getAllPlatforms()) {
        for (const stop of platform.stopPositions) {
            addEntry(stop.trackSegmentId, {
                stationId: platform.stationId,
                platformId: platform.id,
                platformKind: 'trackAligned',
                stopPositionId: stop.id,
                tValue: stop.tValue,
                direction: stop.direction,
            });
        }
    }

    return index;
}

// ---------------------------------------------------------------------------
// Proximity check
// ---------------------------------------------------------------------------

type CurveLike = { fullLength: number; lengthAtT: (t: number) => number };

/**
 * Find the nearest stop position to a train's head on a given segment.
 *
 * @param entries - Stop index entries for this segment.
 * @param trainT - The train's t-value on the segment.
 * @param segmentId - The segment id (for curve lookup).
 * @param getCurve - Returns the curve for a segment.
 * @param threshold - Maximum arc-length distance (world units) to consider "at" a stop.
 * @returns The matching `StationPresence`, or `null` if nothing is close enough.
 */
export function findNearestStop(
    entries: readonly StopIndexEntry[],
    trainT: number,
    segmentId: number,
    getCurve: (segmentId: number) => CurveLike,
    threshold: number
): StationPresence | null {
    const curve = getCurve(segmentId);
    const trainArc = curve.lengthAtT(trainT);

    let best: StationPresence | null = null;
    let bestDist = Infinity;

    for (const entry of entries) {
        const stopArc = curve.lengthAtT(entry.tValue);
        const dist = Math.abs(trainArc - stopArc);
        if (dist <= threshold && dist < bestDist) {
            bestDist = dist;
            best = {
                stationId: entry.stationId,
                platformId: entry.platformId,
                platformKind: entry.platformKind,
                stopPositionId: entry.stopPositionId,
            };
        }
    }

    return best;
}

// ---------------------------------------------------------------------------
// Detector class
// ---------------------------------------------------------------------------

/** Default proximity threshold in world units (meters). */
const DEFAULT_THRESHOLD = 5;

/**
 * Returns true only when the train is genuinely stopped: speed is exactly zero
 * and the throttle is neutral or a brake notch (not a power notch).
 */
function isTrainStoppedAtPlatform(train: {
    speed: number;
    throttleStep: ThrottleSteps;
}): boolean {
    return train.speed === 0 && isStoppedCommand(train.throttleStep);
}

/**
 * Continuously tracks which trains are near a station stop position.
 *
 * Call `update()` each frame after trains have moved and the occupancy
 * registry has been rebuilt. Subscribe to the observable for arrive/depart
 * events; use `getPresenceForTrain()` for point-in-time queries.
 */
export class StationPresenceDetector {
    private _stopIndex: Map<number, StopIndexEntry[]> = new Map();
    private _presence: Map<number, StationPresence> = new Map();
    private _observable: Observable<[StationPresenceEvent]> =
        new SynchronousObservable<[StationPresenceEvent]>();
    private _threshold: number;

    private _stationManager: StationManager;
    private _trackAlignedPlatformManager: TrackAlignedPlatformManager;
    private _trackGraph: TrackGraph;

    constructor(
        stationManager: StationManager,
        trackAlignedPlatformManager: TrackAlignedPlatformManager,
        trackGraph: TrackGraph,
        threshold: number = DEFAULT_THRESHOLD
    ) {
        this._stationManager = stationManager;
        this._trackAlignedPlatformManager = trackAlignedPlatformManager;
        this._trackGraph = trackGraph;
        this._threshold = threshold;
        this.rebuildIndex();
    }

    /** Rebuild the segment → stop-position spatial index. */
    rebuildIndex(): void {
        this._stopIndex = buildStopIndex(
            this._stationManager,
            this._trackAlignedPlatformManager
        );
    }

    /**
     * Per-frame update. Checks each train's head position against the stop
     * index, updates the presence map, and fires arrive/depart events.
     */
    update(
        trains: readonly PlacedTrainEntry[],
        occupancyRegistry: OccupancyRegistry
    ): void {
        const getCurve = (segmentId: number) => {
            const curve = this._trackGraph.getTrackSegmentCurve(segmentId);
            if (curve === null) {
                return { fullLength: 0, lengthAtT: () => 0 };
            }
            return curve;
        };

        // Track which trains are still present this frame.
        const seen = new Set<number>();

        for (const { id, train } of trains) {
            const pos = train.position;
            if (pos === null) continue;

            // Only genuinely stopped trains can be "at" a station.
            if (!isTrainStoppedAtPlatform(train)) continue;

            const entries = this._stopIndex.get(pos.trackSegment);
            if (!entries || entries.length === 0) continue;

            const match = findNearestStop(
                entries,
                pos.tValue,
                pos.trackSegment,
                getCurve,
                this._threshold
            );

            if (match) {
                seen.add(id);
                const prev = this._presence.get(id);
                if (!prev) {
                    // Arrived.
                    this._presence.set(id, match);
                    this._observable.notify({
                        type: 'arrived',
                        trainId: id,
                        presence: match,
                    });
                } else if (
                    prev.stationId !== match.stationId ||
                    prev.platformId !== match.platformId ||
                    prev.stopPositionId !== match.stopPositionId
                ) {
                    // Moved to a different stop — depart old, arrive new.
                    this._observable.notify({
                        type: 'departed',
                        trainId: id,
                        previousPresence: prev,
                    });
                    this._presence.set(id, match);
                    this._observable.notify({
                        type: 'arrived',
                        trainId: id,
                        presence: match,
                    });
                }
                // else: same stop, no event.
            }
        }

        // Departed trains: in the old presence map but not seen this frame.
        for (const [trainId, presence] of this._presence) {
            if (!seen.has(trainId)) {
                this._presence.delete(trainId);
                this._observable.notify({
                    type: 'departed',
                    trainId,
                    previousPresence: presence,
                });
            }
        }
    }

    // -----------------------------------------------------------------------
    // Queries
    // -----------------------------------------------------------------------

    /** Which station/platform/stop is this train near, if any? */
    getPresenceForTrain(trainId: number): StationPresence | null {
        return this._presence.get(trainId) ?? null;
    }

    /** Which train IDs are currently at a given station? */
    getTrainsAtStation(stationId: number): number[] {
        const result: number[] = [];
        for (const [trainId, presence] of this._presence) {
            if (presence.stationId === stationId) {
                result.push(trainId);
            }
        }
        return result;
    }

    /** Subscribe to arrive/depart events. Returns an unsubscribe function. */
    subscribe(listener: (event: StationPresenceEvent) => void): () => void {
        return this._observable.subscribe(listener);
    }
}
