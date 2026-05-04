# Proximity-Based Automatic Coupling

**Date:** 2026-05-04
**Branch:** `feat/proximity-based-coupling`
**Status:** Design — awaiting review

## Problem

Today, coupling two trains requires both to be stopped and the user to click a manual "Couple" button surfaced by the formation editor. Driving a train toward another to couple it isn't supported — `CollisionGuard` emergency-stops the moving train ~5 world units short of contact, and `ProximityDetector` skips moving trains entirely (`proximity-detector.ts:112`). The user experience for shunting is awkward: drive close, get force-stopped, wait for the lock to clear, click manual couple.

We want shunting to feel natural: a player drives a train at low speed toward a stopped formation, the trains touch, and they couple automatically.

## Goals

- A moving train approaching a stopped train at low speed, with its leading endpoint aligned to one of the stopped train's endpoints, auto-couples on contact.
- The collision-guard "approach corridor" must allow the moving train to actually reach coupling distance (it currently stops it short).
- Manual coupling between two stopped trains continues to work exactly as today.
- Decoupling does not trigger immediate auto-recoupling.

## Non-goals (v1)

- Two moving trains coupling (catching-up case).
- Auto-coupling above the shunt speed threshold.
- Coupling animations, sound, or visual approach indicators beyond toasts.
- A user-facing toggle to disable auto-coupling.
- Any distinction between manually-driven and timetable-auto-driven trains — the trigger is purely geometric/kinematic.

## Decisions (from brainstorming)

| # | Question | Choice |
|---|----------|--------|
| 1 | Speed regime | One stopped, one moving (v1). Designed so v2 (both moving, low relative speed) and v3 (any speed) extend the same components. |
| 2 | Endpoint orientation | Strict — moving train's *leading* endpoint must be the one approaching. |
| 3 | Post-couple motion | Stop on contact (existing `coupleTrains` already calls `resetMotionState`). |
| 4 | Multiple candidates | Closest endpoint distance wins. |
| 5 | User feedback | Always toast on success and on failure. |
| 6 | Failed couple (depth exceeded) | Reject couple → toast → existing collision-guard handles the stop ~5 units later. No new force-stop code. |
| Approach | Where logic lives | Approach 2 — separate `CouplingApproachDetector` alongside the existing `ProximityDetector`. |
| Collision | How to allow approach | New "coupling approach" exemption in `CollisionGuard`. Exempt pairs skip Tier 1 + Tier 2 intervention. |
| Exemption gate | When is exemption active | Alignment + low speed (≤ shunt threshold) + within 2× coupling-proximity envelope. |

## Architecture

### Components

**1. `CouplingApproachDetector`** — new, `src/trains/coupling-approach-detector.ts`

Per-frame classifier of colocated train pairs. Walks `OccupancyRegistry.getColocatedPairs()` (same broad-phase filter `ProximityDetector` uses) and classifies each pair as:

- `'in-range'` — aligned approach AND endpoint distance ≤ coupling proximity threshold (`headCouplerA + tailCouplerB + COUPLING_GAP_TOLERANCE`). These trigger auto-couple.
- `'aligned-approach'` — aligned approach but distance still > coupling threshold. These suppress collision-guard but do not yet trigger couple.
- `null` — no exemption, no auto-couple.

Public API:
- `update(trains, occupancyRegistry)` — recompute classifications.
- `getInRangeMatches(): readonly ProximityMatch[]` — sorted by `distance` ascending. Reuses existing `ProximityMatch` shape so `AutoCoupler` can hand matches directly to `trainManager.coupleTrains()` with no translation.
- `isExempt(idA: number, idB: number): boolean` — true when the pair is `'in-range'` or `'aligned-approach'`. Used by `CollisionGuard`.

Owned by `TrainRenderSystem` next to `ProximityDetector`, exposed via getter.

**2. `CollisionGuard`** — modified, `src/trains/collision-guard.ts`

In `_checkSameTrack`, before applying any tier intervention, consult the new detector:

```ts
if (this._couplingApproachDetector?.isExempt(idA, idB)) return;
```

No change to crossing detection. The detector dependency is set via a setter to mirror how `proximityDetector` is wired in `train-manager.ts:46`.

**3. `AutoCoupler`** — new, `src/trains/auto-coupler.ts`

Tiny orchestrator. Reads `couplingApproachDetector.getInRangeMatches()` each frame, iterates in distance-ascending order, and for each match calls `trainManager.coupleTrains(match)`. Tracks merged train IDs in a per-frame `Set<number>` so a second match involving an already-merged train is skipped (handles closest-wins among multiple simultaneous candidates).

Per result:
- `success: true` → toast `couplingAutoSuccess`.
- `success: false, reason: 'depth_exceeded'` → toast `couplingDepthExceeded` (existing string).
- `success: false, reason: 'invalid'` → no toast (this is a transient race-condition state, not a user-actionable failure).

Owned at `init-app.ts` level — needs `trainManager`, the i18n `t()` function, and the toast service. Invoked from inside the existing `timeManager.subscribe` callback (`init-app.ts:1004`) immediately after `trainRenderSystem.update(deltaTime)`.

**4. `track-arc-utils.ts`** — new shared helper, `src/trains/track-arc-utils.ts`

Extracts the closing-speed and effective-distance logic currently inside `CollisionGuard` (`_closingSpeed` at line 374, `_effectiveDistance` at line 279). Both `CollisionGuard` and `CouplingApproachDetector` need this geometry; centralizing avoids drift.

This is targeted in-scope cleanup — no broader refactoring.

### Tick order

In `TrainRenderSystem.update(deltaTime)`:

```
1. trains move (existing physics)
2. occupancyRegistry.updateFromTrains()       [existing]
3. proximityDetector.update()                 [existing — stopped-stopped, drives manual UI]
4. couplingApproachDetector.update()          [NEW]
5. collisionGuard.update()                    [MODIFIED — consults #4 for exemption]
```

Then in `init-app.ts` `timeManager.subscribe` callback, immediately after `trainRenderSystem.update(deltaTime)`:

```
6. autoCoupler.update()                       [NEW]
```

Auto-coupler runs *after* `collisionGuard` so we don't try to couple a pair that collision-guard has just emergency-stopped (in the unlikely event the exemption logic and collision logic ever disagree).

### Alignment rules

`CouplingApproachDetector` classifies a pair `(A, B)` as an aligned approach when **all** of:

1. **Exactly one is moving.** `(speedA > 0) XOR (speedB > 0)`. Both moving or both stopped → `null`.
2. **Moving train at or below shunt speed.** `movingTrain.speed <= SHUNT_SPEED_THRESHOLD` (default `2` world units / sec).
3. **Leading endpoint determined by motion direction:**
   - `position.direction === 'tangent'` → leading = head.
   - `position.direction === 'reverseTangent'` → leading = tail.
4. **Endpoint pairing.** For the moving train's leading endpoint, evaluate both the stopped train's head and tail endpoints. A pair qualifies only if both endpoints lie on the same `trackSegment`. If both qualify, pick the one with smaller endpoint distance.
5. **Closing along the segment.** Reuse closing-speed helper from `track-arc-utils.ts`. The leading endpoint must be moving toward the chosen stopped endpoint along the segment's arc-length; closing speed must be `> 0`.
6. **Within approach envelope.** Endpoint distance ≤ `2 × couplingProximityThreshold` (~16 world units with default couplers).

Returns:
- `'in-range'` if (1)–(6) hold AND distance ≤ coupling proximity threshold.
- `'aligned-approach'` if (1)–(6) hold AND distance > coupling proximity threshold.
- `null` otherwise.

### Constants

In `coupling-approach-detector.ts` (kept local for tunability):

```ts
const SHUNT_SPEED_THRESHOLD = 2;        // world units / sec
const APPROACH_ENVELOPE_MULTIPLIER = 2; // × coupling proximity threshold
```

### i18n

Add to all four locale files (`en`, `zh-TW`, `ja`, `icon-handoff-en`):

- `couplingAutoSuccess` — success toast for auto-coupling. Wording matches the tone of existing strings; final copy decided during implementation.

`couplingDepthExceeded` already exists and is reused.

## What does *not* change

- `Train.coupleTrains` / `TrainManager.coupleTrains` — existing path handles depth check, formation merge, motion reset, train removal. No edits.
- `ProximityDetector` — continues to detect stopped-stopped pairs for the manual UI in `formation-editor.tsx`.
- `formation-editor.tsx` manual coupling button. Side-effect to be aware of: when a moving train auto-couples, the manual button briefly appears for one frame and then disappears with the merged formation. Acceptable.
- Decouple path. After decouple, both resulting trains are stopped → `CouplingApproachDetector` returns `null` (rule 1 fails) → no auto-recouple. Manual button still shows from `ProximityDetector`.
- Collision-guard crossing detection. Exemption applies only to same-track checks.

## Edge cases

| Scenario | Behavior |
|---|---|
| Moving train above shunt speed approaches stopped train | Collision-guard runs normally — Tier 1 brake → Tier 2 stop. No couple. Once stopped (and aligned), next frame is "both stopped" → manual couple available; nothing auto-fires. |
| Moving train approaches with trailing endpoint | Rule 4 fails (leading endpoint pointed elsewhere) → not exempt → collision-guard intervenes normally. |
| Two stopped trains side by side after decouple | Rule 1 fails → no auto-couple. Manual button surfaces via existing `ProximityDetector`. |
| Closest-wins among 2+ in-range matches | `getInRangeMatches()` returns sorted by distance; `AutoCoupler` skips matches involving already-merged trains. |
| Auto-couple fails (depth exceeded) | Toast `couplingDepthExceeded`. Train continues briefly, collision-guard Tier 2 stops it ~5 units past contact. No toast spam: once stopped, rule 1 fails next frame → detector returns `null` → toast does not re-fire. |
| Approach across a junction | Rule 3 (same track segment for both endpoints) fails until both are on the same segment. Exemption activates only inside the final segment. |

## Testing

### Unit tests (Bun test runner)

**`coupling-approach-detector.test.ts`** — pure classifier:
- Two stopped trains in proximity → `null`.
- Stopped + moving below shunt speed, leading end aligned, on same segment, within proximity threshold → `'in-range'`.
- Same as above but distance just outside proximity threshold and within envelope → `'aligned-approach'`.
- Beyond envelope (> 2× threshold) → `null`.
- Moving train above shunt speed → `null`.
- Two moving trains → `null`.
- Moving train approaching with trailing endpoint → `null`.
- Trains diverging (closing speed ≤ 0) → `null`.
- Different track segments (colocated only via shared joint) → `null`.

**`auto-coupler.test.ts`** — orchestration with stub detector + stub `TrainManager`:
- Single in-range match → `coupleTrains` called once, success toast.
- Two in-range matches sharing a train → only the closest fires.
- Match yielding `depth_exceeded` → failure toast, no further calls.
- Match yielding `invalid` → no toast.
- Empty match list → no calls.

**`collision-guard.test.ts`** (existing — add cases):
- Pair flagged exempt → no Tier 1 or Tier 2 intervention applied for that pair.
- Pair not exempt → all existing behaviors unchanged (regression coverage).

**`track-arc-utils.test.ts`** — lock down behavior of extracted helpers before extraction.

### Manual / in-browser verification (`bun run dev`)

- Drive a single car at full throttle into a stopped formation → brakes (Tier 1) → emergency-stops short of contact (Tier 2). No couple.
- Drive at ≤ shunt speed toward stopped formation, leading end aligned → no braking, closes in, auto-couples on contact, success toast.
- Approach with trailing end → collision-guard intervenes; no couple.
- Decouple a long formation → two stopped trains; verify no auto-couple, manual button still appears.
- After successful auto-couple → resulting formation has zero speed; user can throttle up and drive away cleanly.
- Junction with multiple stopped trains nearby → closest one wins.
- Drive into a depth-saturated combined train → failure toast, train parks just before contact.

## Risks

- **`CollisionGuard` exemption is the riskiest change.** Collision-guard is safety-critical. Existing collision tests must pass without modification — additions only. The exemption check is a single early-return at the top of `_checkSameTrack`; the rest of the file is untouched.
- **Tick-order coupling.** `CouplingApproachDetector` must run before `CollisionGuard` so the exemption query is fresh, and `AutoCoupler` must run after `CollisionGuard` to avoid acting on pairs that have just been emergency-stopped. Both invariants need explicit comments at the call sites.
- **Future v2/v3 expansion.** Rule 1 (exactly one moving) and rule 2 (shunt speed cap) are the only knobs that need to change for v2 (both moving, low relative speed) and v3 (any speed). The classifier shape supports this without redesign.

## Files touched

**New:**
- `src/trains/coupling-approach-detector.ts`
- `src/trains/auto-coupler.ts`
- `src/trains/track-arc-utils.ts`
- `src/trains/coupling-approach-detector.test.ts`
- `src/trains/auto-coupler.test.ts`
- `src/trains/track-arc-utils.test.ts`

**Modified:**
- `src/trains/collision-guard.ts` — exemption check; geometry helpers extracted to `track-arc-utils.ts`.
- `src/trains/train-render-system.ts` — own and update `CouplingApproachDetector`; expose getter.
- `src/utils/init-app.ts` — construct and tick `AutoCoupler`.
- `src/i18n/locales/{en,zh-TW,ja,icon-handoff-en}.ts` — add `couplingAutoSuccess`.
