import type { ProximityMatch } from './proximity-detector';
import type { CoupleResult } from './train-manager';

interface MatchSource {
    getInRangeMatches(): readonly ProximityMatch[];
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

        const merged: Set<number> = new Set();
        for (const match of matches) {
            if (merged.has(match.trainA.id) || merged.has(match.trainB.id)) {
                continue;
            }
            const result = this._coupler.coupleTrains(match);
            if (result.success) {
                merged.add(match.trainA.id);
                merged.add(match.trainB.id);
                this._callbacks.onSuccess();
            } else if (result.reason === 'depth_exceeded') {
                this._callbacks.onFailure('depth_exceeded');
            }
            // 'invalid' is a transient race state — ignore silently.
        }
    }
}
