import type { BCurve } from '@ue-too/curve';
import type { Point } from '@ue-too/math';

import { sampleSpineEdge } from './spine-utils';
import type {
    LegacySerializedTrackAlignedPlatform,
    SerializedSpineEntry,
    TrackAlignedPlatform,
} from './track-aligned-platform-types';
import type { StopPosition } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-stop entry in the migration mapping for one dual-spine platform. */
export type StopIndexMapEntry = { face: 'A' | 'B'; newIndex: number; newId: number };

/**
 * Result of splitting a legacy dual-spine serialized platform into two new
 * single-spine platforms.
 *
 * `faceA` and `faceB` are ready to be inserted into the manager; they carry
 * the `id: number` slot as `-1` to be assigned by the caller when it mints
 * fresh IDs. `stopIndexMap[i]` describes where the legacy stop at position
 * `i` has landed.
 */
export type DualSpineSplitResult = {
    faceA: Omit<TrackAlignedPlatform, 'id'>;
    faceB: Omit<TrackAlignedPlatform, 'id'>;
    stopIndexMap: StopIndexMapEntry[];
};

/** Mapping from an old platform+stop-index to the new platform+stop-index. */
export type PlatformMigrationEntry = {
    newPlatformId: number;
    newStopIndex: number;
    newStopId: number;
};

/** oldPlatformId -> oldStopIndex -> new location. */
export type PlatformMigrationMap = Map<
    number,
    Map<number, PlatformMigrationEntry>
>;

// ---------------------------------------------------------------------------
// Split helper
// ---------------------------------------------------------------------------

/**
 * Compute the midline between two spines by sampling both offset edges and
 * averaging paired points.
 *
 * The returned polyline runs from spine END back to spine START — matching
 * the convention used by `_buildSingleSpineStripMesh`, which reverses the
 * outer-vertex polyline before pairing it with the spine's start-to-end
 * samples. Storing the midline reversed lets it round-trip through the
 * same renderer used for user-drawn single-spine platforms.
 *
 * @param spineA - First spine entries.
 * @param spineB - Second spine entries.
 * @param offset - Lateral offset in world units.
 * @param getCurve - Curve lookup for each segment id.
 * @returns A polyline (in end→start order) suitable for assigning as a
 *   single-spine platform's `outerVertices`.
 */
export function computeDualSpineMidline(
    spineA: SerializedSpineEntry[],
    spineB: SerializedSpineEntry[],
    offset: number,
    getCurve: (segmentId: number) => BCurve
): Point[] {
    // Use a single shared per-segment step count so both edges sample to
    // arrays of equal length. Without this, `sampleSpineEdge` chooses the
    // step count from each curve's own `fullLength`, so two spines with
    // even slightly-different segment lengths produce mismatched arrays
    // and `Math.min` truncates the longer one — the midline then ends
    // short of the spine endpoint, producing a visible notch in the mesh.
    let maxLength = 0;
    for (const entry of spineA) {
        maxLength = Math.max(maxLength, getCurve(entry.trackSegment).fullLength);
    }
    for (const entry of spineB) {
        maxLength = Math.max(maxLength, getCurve(entry.trackSegment).fullLength);
    }
    const stepsPerSegment = Math.max(2, Math.ceil(maxLength / 2));
    const edgeA = sampleSpineEdge(spineA, offset, getCurve, stepsPerSegment);
    const edgeB = sampleSpineEdge(spineB, offset, getCurve, stepsPerSegment);
    const n = Math.min(edgeA.length, edgeB.length);
    const midline: Point[] = [];
    for (let i = n - 1; i >= 0; i--) {
        midline.push({
            x: (edgeA[i].x + edgeB[i].x) / 2,
            y: (edgeA[i].y + edgeB[i].y) / 2,
        });
    }
    return midline;
}

/**
 * Split a legacy dual-spine serialized platform into two new single-spine
 * platform records.
 *
 * @param legacy - The legacy platform to split. Must have `spineB !== null`
 *   and `outerVertices.kind === 'dual'`.
 * @param getMidline - Callback that returns the midline polyline used as
 *   each face's `outerVertices`. Taking this as a parameter keeps the helper
 *   pure (no curve lookup dependency) and lets the scene loader supply real
 *   geometry while tests can inject a stub.
 */
export function splitLegacyDualSpinePlatform(
    legacy: LegacySerializedTrackAlignedPlatform,
    getMidline: () => Point[]
): DualSpineSplitResult {
    if (legacy.spineB === null) {
        throw new Error(
            `splitLegacyDualSpinePlatform: legacy.spineB is null for platform ${legacy.id}`
        );
    }

    const midline = getMidline();

    const spineASegmentIds = new Set(legacy.spineA.map(e => e.trackSegment));
    const spineBSegmentIds = new Set(legacy.spineB.map(e => e.trackSegment));

    const stopsA: StopPosition[] = [];
    const stopsB: StopPosition[] = [];
    const stopIndexMap: StopIndexMapEntry[] = new Array(
        legacy.stopPositions.length
    );

    for (let i = 0; i < legacy.stopPositions.length; i++) {
        const stop = legacy.stopPositions[i];
        if (spineASegmentIds.has(stop.trackSegmentId)) {
            const newId = stopsA.length;
            stopIndexMap[i] = { face: 'A', newIndex: stopsA.length, newId };
            stopsA.push({
                id: newId,
                trackSegmentId: stop.trackSegmentId,
                direction: stop.direction,
                tValue: stop.tValue,
            });
        } else if (spineBSegmentIds.has(stop.trackSegmentId)) {
            const newId = stopsB.length;
            stopIndexMap[i] = { face: 'B', newIndex: stopsB.length, newId };
            stopsB.push({
                id: newId,
                trackSegmentId: stop.trackSegmentId,
                direction: stop.direction,
                tValue: stop.tValue,
            });
        } else {
            // Stop references a segment on neither spine — drop it. The
            // corresponding map entry points to face A at `-1` so downstream
            // code can recognise 'no longer reachable'.
            stopIndexMap[i] = { face: 'A', newIndex: -1, newId: -1 };
        }
    }

    const faceA: Omit<TrackAlignedPlatform, 'id'> = {
        stationId: legacy.stationId,
        spine: legacy.spineA.map(e => ({ ...e })),
        offset: legacy.offset,
        outerVertices: midline.map(v => ({ x: v.x, y: v.y })),
        stopPositions: stopsA,
    };

    const faceB: Omit<TrackAlignedPlatform, 'id'> = {
        stationId: legacy.stationId,
        spine: legacy.spineB.map(e => ({ ...e })),
        offset: legacy.offset,
        outerVertices: midline.map(v => ({ x: v.x, y: v.y })),
        stopPositions: stopsB,
    };

    return { faceA, faceB, stopIndexMap };
}
