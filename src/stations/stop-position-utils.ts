import type { StopPosition } from './types';

/**
 * Pure helpers shared between `StationManager` (island platforms) and
 * `TrackAlignedPlatformManager` (track-aligned platforms) for managing the
 * per-platform id space of `StopPosition` entries.
 */

/**
 * Returns the next available id for a stop position on a platform.
 *
 * IDs are unique within the owning platform's `stopPositions` array but
 * may be sparse (e.g. after deletions). Callers should treat the returned
 * id as a fresh slot — assign it to a new `StopPosition` and append.
 */
export function nextStopPositionId(stops: readonly StopPosition[]): number {
    let max = -1;
    for (const stop of stops) {
        if (stop.id > max) max = stop.id;
    }
    return max + 1;
}

/**
 * Assigns sequential ids (starting at 0) to a list of stop-position
 * descriptors. Used by callers that build `StopPosition` arrays from
 * scratch (e.g. station-factory, the spine-utils midpoint helper, the
 * placement state machines).
 *
 * The returned array contains fresh objects; the input is not mutated.
 */
export function assignStopPositionIds(
    inputs: readonly Omit<StopPosition, 'id'>[]
): StopPosition[] {
    return inputs.map((input, i) => ({ id: i, ...input }));
}
