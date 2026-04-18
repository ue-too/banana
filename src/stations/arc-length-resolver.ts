import type { SpineEntry } from './track-aligned-platform-types';

/**
 * Minimal curve interface for arc-length resolution.
 * The resolver only needs `fullLength` — not the full BCurve.
 */
type CurveLike = { fullLength: number };

/**
 * Convert a normalized slider value `[0, 1]` to a `(trackSegmentId, tValue)` pair.
 *
 * The platform's extent is defined by `spine` entries. The slider's `0` maps
 * to the first entry's `tStart` and `1` to the last entry's `tEnd`. Arc
 * length is used to interpolate within and across entries.
 *
 * @param spine - One or more spine entries defining the platform's extent.
 * @param normalized - Slider position, clamped internally to `[0, 1]`.
 * @param getCurve - Lookup returning (at minimum) the curve's `fullLength`.
 */
export function normalizedToStop(
    spine: readonly SpineEntry[],
    normalized: number,
    getCurve: (segmentId: number) => CurveLike
): { trackSegmentId: number; tValue: number } {
    const n = Math.max(0, Math.min(1, normalized));

    // Compute per-entry arc lengths.
    const entryLengths: number[] = [];
    let totalLength = 0;
    for (const entry of spine) {
        const curve = getCurve(entry.trackSegment);
        const tRange = Math.abs(entry.tEnd - entry.tStart);
        const length = curve.fullLength * tRange;
        entryLengths.push(length);
        totalLength += length;
    }

    if (totalLength < 1e-9 || spine.length === 0) {
        const first = spine[0];
        return {
            trackSegmentId: first?.trackSegment ?? 0,
            tValue: first?.tStart ?? 0,
        };
    }

    const targetArc = n * totalLength;
    let accumulated = 0;

    for (let i = 0; i < spine.length; i++) {
        const entry = spine[i];
        const entryLength = entryLengths[i];

        if (accumulated + entryLength >= targetArc || i === spine.length - 1) {
            const fraction =
                entryLength > 1e-9
                    ? (targetArc - accumulated) / entryLength
                    : 0;
            const clampedFraction = Math.max(0, Math.min(1, fraction));
            const tValue =
                entry.tStart + (entry.tEnd - entry.tStart) * clampedFraction;
            return { trackSegmentId: entry.trackSegment, tValue };
        }

        accumulated += entryLength;
    }

    // Fallback (should not reach here).
    const last = spine[spine.length - 1];
    return { trackSegmentId: last.trackSegment, tValue: last.tEnd };
}

/**
 * Convert a `(trackSegmentId, tValue)` pair back to a normalized `[0, 1]`
 * slider value.
 *
 * @returns `0` if the segment is not in the spine.
 */
export function stopToNormalized(
    spine: readonly SpineEntry[],
    trackSegmentId: number,
    tValue: number,
    getCurve: (segmentId: number) => CurveLike
): number {
    const entryLengths: number[] = [];
    let totalLength = 0;
    for (const entry of spine) {
        const curve = getCurve(entry.trackSegment);
        const tRange = Math.abs(entry.tEnd - entry.tStart);
        const length = curve.fullLength * tRange;
        entryLengths.push(length);
        totalLength += length;
    }

    if (totalLength < 1e-9) return 0;

    let accumulated = 0;
    for (let i = 0; i < spine.length; i++) {
        const entry = spine[i];
        if (entry.trackSegment === trackSegmentId) {
            const tRange = entry.tEnd - entry.tStart;
            const fraction =
                Math.abs(tRange) > 1e-9 ? (tValue - entry.tStart) / tRange : 0;
            const clampedFraction = Math.max(0, Math.min(1, fraction));
            const arc = accumulated + clampedFraction * entryLengths[i];
            return arc / totalLength;
        }
        accumulated += entryLengths[i];
    }

    return 0; // Segment not in spine.
}
