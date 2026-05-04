import type { ProximityMatch } from './proximity-detector';
import type { CoupleResult } from './train-manager';

interface MatchSource {
    getInRangeMatches(): readonly ProximityMatch[];
    markRejected(idA: number, idB: number): void;
}

interface CouplerTarget {
    coupleTrains(match: ProximityMatch): CoupleResult;
}

interface AutoCouplerCallbacks {
    onSuccess: () => void;
    onFailure: (reason: 'depth_exceeded') => void;
}

/**
 * Per-frame orchestrator that consumes in-range coupling-approach matches
 * and triggers `coupleTrains()` on the train manager. Matches are processed
 * closest-first; any subsequent match involving a train that has already
 * been merged this frame is skipped.
 *
 * Toast / i18n routing is delegated to `onSuccess` / `onFailure` callbacks
 * so this class stays UI-agnostic and easy to unit-test.
 *
 * @group Train System
 */
export class AutoCoupler {
    private _matchSource: MatchSource;
    private _coupler: CouplerTarget;
    private _callbacks: AutoCouplerCallbacks;
    /** Reusable per-frame set of train ids already processed this update. */
    private _merged: Set<number> = new Set();

    constructor(
        matchSource: MatchSource,
        coupler: CouplerTarget,
        callbacks: AutoCouplerCallbacks
    ) {
        this._matchSource = matchSource;
        this._coupler = coupler;
        this._callbacks = callbacks;
    }

    /**
     * Process in-range matches for the current frame.
     * Call once per frame, after the detector has been updated and after
     * collision-guard has run.
     */
    update(): void {
        const matches = this._matchSource.getInRangeMatches();
        if (matches.length === 0) return;

        this._merged.clear();
        for (const match of matches) {
            if (
                this._merged.has(match.trainA.id) ||
                this._merged.has(match.trainB.id)
            ) {
                continue;
            }
            const result = this._coupler.coupleTrains(match);
            if (result.success) {
                this._merged.add(match.trainA.id);
                this._merged.add(match.trainB.id);
                this._callbacks.onSuccess();
            } else if (result.reason === 'depth_exceeded') {
                this._merged.add(match.trainA.id);
                this._merged.add(match.trainB.id);
                this._matchSource.markRejected(
                    match.trainA.id,
                    match.trainB.id
                );
                this._callbacks.onFailure('depth_exceeded');
            }
            // 'invalid' is a transient race state — leave the trains free
            // to be re-attempted later in the same frame.
        }
    }
}
