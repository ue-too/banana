import type { Point } from '@ue-too/math';
import type { StopPosition } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Half the car body width in meters. Typical passenger car ~3m wide. */
export const DEFAULT_CAR_HALF_WIDTH = 1.5;

/** Safety gap between car body edge and platform edge (meters). */
export const DEFAULT_PLATFORM_CLEARANCE = 0.15;

/** Maximum distance (meters) from station position to platform start point. */
export const MAX_STATION_DISTANCE = 500;

// ---------------------------------------------------------------------------
// Spine
// ---------------------------------------------------------------------------

/** One segment of a platform spine — a slice of a track curve. */
export type SpineEntry = {
    trackSegment: number;
    tStart: number;
    tEnd: number;
    /**
     * Which side of this segment's curve the platform is on.
     * Per-segment because curve tangent direction can flip at joints.
     *  1 = positive-normal (left of tangent),
     * -1 = negative-normal (right of tangent).
     */
    side: 1 | -1;
};

// ---------------------------------------------------------------------------
// Entity (in-memory)
// ---------------------------------------------------------------------------

export type TrackAlignedPlatform = {
    id: number;
    /** Required — every track-aligned platform belongs to a station. */
    stationId: number;
    /** The single spine for this platform (track-side edge). */
    spine: SpineEntry[];
    /** Offset from track centerline to platform edge (meters). */
    offset: number;
    /** User-placed vertices defining the non-track side, ordered from spine end back to spine start. */
    outerVertices: Point[];
    stopPositions: StopPosition[];
};

// ---------------------------------------------------------------------------
// Serialization — new format
// ---------------------------------------------------------------------------

export type SerializedSpineEntry = {
    trackSegment: number;
    tStart: number;
    tEnd: number;
    side: 1 | -1;
};

export type SerializedTrackAlignedPlatform = {
    id: number;
    stationId: number;
    spine: SerializedSpineEntry[];
    offset: number;
    outerVertices: { x: number; y: number }[];
    stopPositions: StopPosition[];
};

export type SerializedTrackAlignedPlatformData = {
    platforms: SerializedTrackAlignedPlatform[];
};

// ---------------------------------------------------------------------------
// Serialization — legacy formats (read-only)
// ---------------------------------------------------------------------------

/**
 * Legacy outer-vertices union, kept so we can decode saved scenes that still
 * use the dual-spine representation.  New saves never write this shape.
 */
export type LegacySerializedOuterVertices =
    | { kind: 'single'; vertices: { x: number; y: number }[] }
    | { kind: 'dual'; capA: { x: number; y: number }[]; capB: { x: number; y: number }[] };

export type LegacySerializedTrackAlignedPlatform = {
    id: number;
    stationId: number;
    spineA: SerializedSpineEntry[];
    spineB: SerializedSpineEntry[] | null;
    offset: number;
    outerVertices: LegacySerializedOuterVertices;
    stopPositions: StopPosition[];
};

/**
 * A raw serialized platforms payload, which may be in either the new format
 * (`platform.spine` and `platform.outerVertices: Point[]`) or the legacy
 * format (`spineA` / `spineB` / `outerVertices: { kind: ... }`).
 */
export type AnySerializedTrackAlignedPlatform =
    | SerializedTrackAlignedPlatform
    | LegacySerializedTrackAlignedPlatform;

export type AnySerializedTrackAlignedPlatformData = {
    platforms: AnySerializedTrackAlignedPlatform[];
};

/** Type guard: does this entry use the legacy dual/single union shape? */
export function isLegacySerializedPlatform(
    p: AnySerializedTrackAlignedPlatform,
): p is LegacySerializedTrackAlignedPlatform {
    return (p as LegacySerializedTrackAlignedPlatform).spineA !== undefined;
}
