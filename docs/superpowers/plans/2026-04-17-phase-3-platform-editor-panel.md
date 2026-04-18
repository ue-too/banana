# Phase 3 — Platform Editor Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `PlatformEditorPanel` UI that lets users add, move (via slider), flip direction, and remove stop positions on any platform — completing the stop-position-editing feature.

**Architecture:** A new `PlatformEditorPanel` component (a `DraggablePanel`) renders when the user clicks a platform chip in `StationListPanel`. It lists each stop position as a row with a `[0→1]` slider (normalized arc length along the platform), a direction toggle, and a delete button. A shared pure helper (`arc-length-resolver.ts`) converts between the slider's `[0, 1]` range and the underlying `(trackSegmentId, tValue)` pair for both island and track-aligned platforms. Deletion of a referenced stop shows a confirmation dialog listing the affected shifts.

**Tech Stack:** TypeScript, React (functional components, hooks), Zustand (toolbar-ui-store), Bun test runner, Vite.

---

## Context every task depends on

- **Spec**: `docs/superpowers/specs/2026-04-16-stop-position-editing-design.md` — "PlatformEditorPanel" section.
- **Phase 2 CRUD surface** (all tests passing):
    - `StationManager.addStopPosition(stationId, platformId, input)` / `updateStopPosition(stationId, platformId, stopId, patch)` / `removeStopPosition(stationId, platformId, stopId)`
    - `TrackAlignedPlatformManager.addStopPosition(platformId, input)` / `updateStopPosition(platformId, stopId, patch)` / `removeStopPosition(platformId, stopId)`
    - Both managers' `findShiftsReferencingStopPosition(...)` for the deletion guard.
- **Platform types**:
    - Island `Platform`: `{ id, track, width, offset, side, stopPositions: StopPosition[] }` — single `track` segment, `tValue ∈ [0, 1]`.
    - Track-aligned `TrackAlignedPlatform`: `{ id, stationId, spine: SpineEntry[], offset, outerVertices, stopPositions: StopPosition[] }` — spine may have N entries, each with `[tStart, tEnd]` on a segment.
    - `StopPosition`: `{ id, trackSegmentId, direction: TrackDirection, tValue }`.
    - `SpineEntry`: `{ trackSegment, tStart, tEnd, side }`.
- **Existing UI patterns**: `StationListPanel.tsx` (the launch point), `DraggablePanel` component (the panel shell), `BananaToolbar.tsx` (the panel orchestrator using Zustand store `useToolbarUIStore`). Panels are opened via `setPanel(name, true/false)` or local state. New panels follow the same pattern.
- **i18n**: `src/i18n/locales/en.ts` and `src/i18n/locales/zh-TW.ts`. New keys added under the relevant section.
- **Debug overlay**: `TrackAlignedPlatformManager._changeObservable` already notifies subscribers (including the debug overlay) on stop-position mutations. `StationManager` does not have an observable, so island-platform stop changes need an explicit `app.debugOverlayRenderSystem.refresh()` call after mutation.

## File structure

**New files:**

- `src/stations/arc-length-resolver.ts` — pure helpers to convert between a normalized `[0, 1]` slider position and `(trackSegmentId, tValue)` for any spine-described platform extent.
- `test/arc-length-resolver.test.ts` — unit tests for the resolver.
- `src/components/toolbar/PlatformEditorPanel.tsx` — the editor UI component.

**Modified files:**

- `src/components/toolbar/StationListPanel.tsx` — add platform chips under each station; add `onEditPlatform` callback prop.
- `src/components/toolbar/BananaToolbar.tsx` — local state for the currently-edited platform; render `PlatformEditorPanel` when non-null.
- `src/i18n/locales/en.ts` — new translation keys.
- `src/i18n/locales/zh-TW.ts` — same.

---

## Task 1: Arc-length resolver + tests

**Files:**

- Create: `src/stations/arc-length-resolver.ts`
- Create: `test/arc-length-resolver.test.ts`

A pure helper that converts between a normalized slider value `[0, 1]` and the `(trackSegmentId, tValue)` pair that `StopPosition` uses. Works for both island platforms (trivially — single segment, full `[0, 1]` range) and track-aligned platforms (walks the spine's arc-length fractions).

The editor uses this in two directions:

- **Slider → stop**: user drags slider to `0.3` → resolver returns `{ trackSegmentId: 10, tValue: 0.45 }`.
- **Stop → slider**: existing stop has `{ trackSegmentId: 10, tValue: 0.45 }` → resolver returns `0.3`.

- [ ] **Step 1: Write the failing tests.**

Create `test/arc-length-resolver.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';

import {
    normalizedToStop,
    stopToNormalized,
} from '../src/stations/arc-length-resolver';
import type { SpineEntry } from '../src/stations/track-aligned-platform-types';

// Stub BCurve: fullLength = 100, linear (t maps directly to length fraction).
const makeCurve = (fullLength: number) => ({ fullLength });

const getCurve = (segmentId: number) => {
    if (segmentId === 10) return makeCurve(100);
    if (segmentId === 11) return makeCurve(50);
    if (segmentId === 12) return makeCurve(200);
    throw new Error(`Unknown segment ${segmentId}`);
};

describe('normalizedToStop', () => {
    it('resolves 0.5 on a single full-range segment to tValue=0.5', () => {
        const spine: SpineEntry[] = [
            { trackSegment: 10, tStart: 0, tEnd: 1, side: 1 },
        ];
        const result = normalizedToStop(spine, 0.5, getCurve);
        expect(result.trackSegmentId).toBe(10);
        expect(result.tValue).toBeCloseTo(0.5, 5);
    });

    it('resolves 0.0 to the start of the first segment', () => {
        const spine: SpineEntry[] = [
            { trackSegment: 10, tStart: 0.2, tEnd: 0.8, side: 1 },
        ];
        const result = normalizedToStop(spine, 0, getCurve);
        expect(result.trackSegmentId).toBe(10);
        expect(result.tValue).toBeCloseTo(0.2, 5);
    });

    it('resolves 1.0 to the end of the last segment', () => {
        const spine: SpineEntry[] = [
            { trackSegment: 10, tStart: 0.2, tEnd: 0.8, side: 1 },
        ];
        const result = normalizedToStop(spine, 1, getCurve);
        expect(result.trackSegmentId).toBe(10);
        expect(result.tValue).toBeCloseTo(0.8, 5);
    });

    it('crosses segment boundaries on a multi-segment spine', () => {
        // seg 10: fullLength=100, tStart=0, tEnd=1 → arc=100
        // seg 11: fullLength=50,  tStart=0, tEnd=1 → arc=50
        // total arc = 150. normalized 0.8 → target arc = 120 → in seg 11 at arc offset 20/50 = 0.4
        const spine: SpineEntry[] = [
            { trackSegment: 10, tStart: 0, tEnd: 1, side: 1 },
            { trackSegment: 11, tStart: 0, tEnd: 1, side: 1 },
        ];
        const result = normalizedToStop(spine, 0.8, getCurve);
        expect(result.trackSegmentId).toBe(11);
        expect(result.tValue).toBeCloseTo(0.4, 5);
    });
});

describe('stopToNormalized', () => {
    it('returns 0.5 for tValue=0.5 on a single full-range segment', () => {
        const spine: SpineEntry[] = [
            { trackSegment: 10, tStart: 0, tEnd: 1, side: 1 },
        ];
        expect(stopToNormalized(spine, 10, 0.5, getCurve)).toBeCloseTo(0.5, 5);
    });

    it('returns 0 for tValue at spine start', () => {
        const spine: SpineEntry[] = [
            { trackSegment: 10, tStart: 0.2, tEnd: 0.8, side: 1 },
        ];
        expect(stopToNormalized(spine, 10, 0.2, getCurve)).toBeCloseTo(0, 5);
    });

    it('returns 1 for tValue at spine end', () => {
        const spine: SpineEntry[] = [
            { trackSegment: 10, tStart: 0.2, tEnd: 0.8, side: 1 },
        ];
        expect(stopToNormalized(spine, 10, 0.8, getCurve)).toBeCloseTo(1, 5);
    });

    it('resolves a stop on the second segment of a multi-segment spine', () => {
        const spine: SpineEntry[] = [
            { trackSegment: 10, tStart: 0, tEnd: 1, side: 1 },
            { trackSegment: 11, tStart: 0, tEnd: 1, side: 1 },
        ];
        // seg 10 arc=100, seg 11 arc=50, total=150.
        // Stop at seg 11, tValue=0.4 → arc from start = 100 + 0.4*50 = 120 → normalized = 120/150 = 0.8
        expect(stopToNormalized(spine, 11, 0.4, getCurve)).toBeCloseTo(0.8, 5);
    });

    it('returns 0 when segment is not in the spine', () => {
        const spine: SpineEntry[] = [
            { trackSegment: 10, tStart: 0, tEnd: 1, side: 1 },
        ];
        expect(stopToNormalized(spine, 99, 0.5, getCurve)).toBe(0);
    });
});
```

- [ ] **Step 2: Run the tests and confirm they fail.**

Run: `bun test test/arc-length-resolver.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the resolver.**

Create `src/stations/arc-length-resolver.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests and confirm they pass.**

Run: `bun test test/arc-length-resolver.test.ts`
Expected: PASS (9 cases).

- [ ] **Step 5: Run full suite and build.**

Run: `bun test && bun run build`
Expected: all green.

- [ ] **Step 6: Commit.**

```bash
git add src/stations/arc-length-resolver.ts test/arc-length-resolver.test.ts
git commit -m "feat(stations): add arc-length resolver for slider ↔ stop-position conversion"
```

---

## Task 2: i18n keys + platform chips in StationListPanel

**Files:**

- Modify: `src/i18n/locales/en.ts`
- Modify: `src/i18n/locales/zh-TW.ts`
- Modify: `src/components/toolbar/StationListPanel.tsx`

Add platform chips under each station entry in `StationListPanel` and a new `onEditPlatform` callback prop. Also add all the i18n keys needed by the editor panel (Task 3).

- [ ] **Step 1: Add i18n keys.**

In `src/i18n/locales/en.ts`, find the section near `platformPlaceholder` / `stopPositionPlaceholder` and add these keys (you can place them in a new subsection comment `// Platform Editor Panel`):

```ts
// Platform Editor Panel
platformEditor: 'Platform Editor',
stopPositions: 'Stop Positions',
addStopPosition: '+ Stop',
deleteStopPosition: 'Delete',
directionTangent: '→',
directionReverseTangent: '←',
position: 'Position',
noStopPositions: 'No stop positions',
confirmDeleteStopTitle: 'Delete stop position?',
confirmDeleteStopMessage: 'This stop is referenced by {{count}} shift(s): {{shifts}}. Removing it will leave those shifts with a broken reference.',
confirmDeleteStopConfirm: 'Delete anyway',
confirmDeleteStopCancel: 'Cancel',
```

In `src/i18n/locales/zh-TW.ts`, add the equivalent keys:

```ts
// Platform Editor Panel
platformEditor: '月台編輯',
stopPositions: '停車位置',
addStopPosition: '+ 停車位置',
deleteStopPosition: '刪除',
directionTangent: '→',
directionReverseTangent: '←',
position: '位置',
noStopPositions: '沒有停車位置',
confirmDeleteStopTitle: '刪除停車位置？',
confirmDeleteStopMessage: '此停車位置被 {{count}} 個班次引用：{{shifts}}。刪除後會使這些班次的引用失效。',
confirmDeleteStopConfirm: '仍然刪除',
confirmDeleteStopCancel: '取消',
```

- [ ] **Step 2: Add platform chips and `onEditPlatform` callback to StationListPanel.**

Edit `src/components/toolbar/StationListPanel.tsx`.

Add a new callback prop to `StationListPanelProps`:

```ts
/** Open the platform editor for a specific platform. */
onEditPlatform?: (stationId: number, platformId: number, platformKind: 'island' | 'trackAligned') => void;
```

Destructure it in the component function params.

Inside the station entry JSX (the `stations.map(({ id, station }) => { ... })` block), after the `<div className="mt-1 flex gap-1">` block that holds the "Add single/dual spine platform" buttons, insert a new row of platform chips:

```tsx
{
    /* Platform chips — click to edit */
}
{
    (station.platforms.length > 0 ||
        station.trackAlignedPlatforms.length > 0) && (
        <div className="mt-1 flex flex-wrap gap-0.5">
            {station.platforms.map(p => (
                <button
                    key={`island-${p.id}`}
                    type="button"
                    className="bg-muted hover:bg-foreground/20 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors"
                    onClick={() => onEditPlatform?.(id, p.id, 'island')}
                >
                    P{p.id}
                </button>
            ))}
            {station.trackAlignedPlatforms.map(tapId => (
                <button
                    key={`ta-${tapId}`}
                    type="button"
                    className="bg-muted hover:bg-foreground/20 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors"
                    onClick={() => onEditPlatform?.(id, tapId, 'trackAligned')}
                >
                    T{tapId}
                </button>
            ))}
        </div>
    );
}
```

- [ ] **Step 3: Run `bun test && bun run build`.**

Expected: all green.

- [ ] **Step 4: Commit.**

```bash
git add \
    src/i18n/locales/en.ts \
    src/i18n/locales/zh-TW.ts \
    src/components/toolbar/StationListPanel.tsx
git commit -m "feat(stations): add i18n keys and platform chips to StationListPanel"
```

---

## Task 3: PlatformEditorPanel component

**Files:**

- Create: `src/components/toolbar/PlatformEditorPanel.tsx`

The main editor panel. For each stop position on the selected platform, renders a row with:

- Array-index label `[0]`, `[1]`, ... (matches debug overlay)
- A slider `[0 → 1]` for position (normalized arc length)
- A direction toggle button (`→` / `←`)
- A delete button

A footer "Add stop" button appends a new stop at the midpoint with `direction: 'tangent'`.

The component accepts platform details as props and calls the Phase 2 manager CRUD methods directly. It re-renders on every change because each mutation produces a new `stopPositions` array (the manager mutates in place and the component re-reads via the manager).

- [ ] **Step 1: Create the component.**

Create `src/components/toolbar/PlatformEditorPanel.tsx`:

```tsx
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Plus, Trash2 } from '@/assets/icons';
import { Button } from '@/components/ui/button';
import { DraggablePanel } from '@/components/ui/draggable-panel';
import { Separator } from '@/components/ui/separator';
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
        </DraggablePanel>
    );
}

export type { PlatformTarget };
```

- [ ] **Step 2: Verify the file compiles.**

Run: `bun run build`
Expected: success (the component isn't rendered anywhere yet, but it should compile).

- [ ] **Step 3: Commit.**

```bash
git add src/components/toolbar/PlatformEditorPanel.tsx
git commit -m "feat(stations): add PlatformEditorPanel component"
```

---

## Task 4: Wire PlatformEditorPanel into BananaToolbar

**Files:**

- Modify: `src/components/toolbar/BananaToolbar.tsx`

When `StationListPanel` fires `onEditPlatform`, store the target in local state. Render `PlatformEditorPanel` when the target is non-null. Closing the editor clears the target.

- [ ] **Step 1: Add local state and the render block.**

Edit `src/components/toolbar/BananaToolbar.tsx`.

Add imports near the top:

```ts
import {
    PlatformEditorPanel,
    type PlatformTarget,
} from './PlatformEditorPanel';
```

Inside the `BananaToolbar` component function, add local state:

```ts
const [editingPlatform, setEditingPlatform] = useState<PlatformTarget | null>(
    null
);
```

(Add `useState` to the existing React import if not already there.)

In the `StationListPanel` JSX (around line 1304), add the `onEditPlatform` prop:

```tsx
onEditPlatform={(stationId, platformId, platformKind) => {
    if (platformKind === 'trackAligned') {
        setEditingPlatform({ kind: 'trackAligned', platformId });
    } else {
        setEditingPlatform({ kind: 'island', stationId, platformId });
    }
}}
```

After the `StationListPanel` render block (around line 1319), add:

```tsx
{
    editingPlatform && (
        <PlatformEditorPanel
            target={editingPlatform}
            stationManager={app.stationManager}
            trackAlignedPlatformManager={app.trackAlignedPlatformManager}
            shiftTemplateManager={app.timetableManager.shiftTemplateManager}
            trackGraph={app.curveEngine.trackGraph}
            onClose={() => setEditingPlatform(null)}
            onStopChange={() => app.debugOverlayRenderSystem.refresh()}
        />
    );
}
```

- [ ] **Step 2: Verify the build compiles and tests pass.**

Run: `bun test && bun run build`
Expected: all green.

- [ ] **Step 3: Manual verification.**

Run: `bun run dev`. Open the station list panel. Click a platform chip (e.g. `P0` or `T3`). Confirm the `PlatformEditorPanel` opens beside the station list, showing the platform's stop positions with sliders and direction toggles.

Test the golden path:

1. Drag a slider → the debug overlay's stop marker moves in real time.
2. Click the direction toggle → the debug overlay arrow flips.
3. Click "Add stop" → a new row appears at the midpoint.
4. Click the trash icon on a stop that's NOT referenced by any shift → it disappears.
5. Click the trash icon on a stop that IS referenced by a shift → the deletion guard appears with the shift name(s). Click "Delete anyway" → the stop is removed.
6. Close the editor → it disappears. Re-click the chip → it reappears.

- [ ] **Step 4: Commit.**

```bash
git add \
    src/components/toolbar/BananaToolbar.tsx
git commit -m "feat(stations): wire PlatformEditorPanel into BananaToolbar"
```

---

## Closing checklist

After completing the tasks above, verify:

- [ ] `bun test` — full suite passes.
- [ ] `bun run build` — production build succeeds.
- [ ] `bun run dev` (manual) — full golden-path walkthrough:
    - Open station list → see platform chips under each station.
    - Click a chip → PlatformEditorPanel opens.
    - Drag slider → stop position moves; debug overlay updates in real time.
    - Toggle direction → arrow flips.
    - Add a stop → new row at midpoint.
    - Delete an unreferenced stop → immediate removal.
    - Delete a referenced stop → confirmation dialog → confirm → removal.
    - Close the editor → panel disappears.
- [ ] Load a saved scene with pre-existing stop positions → editor shows them correctly.
- [ ] Timetable still functions: create a shift referencing a stop position → auto-driver stops at the correct location.
