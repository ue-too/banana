# Remove Bogie Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated **Remove Bogie** tool to the train editor (a.k.a. car maker) toolbar so users can delete existing bogies by clicking on them.

**Architecture:** Mirror the existing **Add Bogie** triple — dedicated state machine + tool-switcher state + toolbar button. The bogie-edit (drag) state machine stays untouched. The engine gets a new `removeBogieAt(position)` method that hit-tests + removes in one call so the new state machine doesn't tangle with the edit machine's selection state.

**Tech Stack:** TypeScript, `@ue-too/being` state machines, `@ue-too/math` Point type, React + Tailwind toolbar UI (lucide `Trash2` icon via `@/assets/icons`), Bun test runner (`bun:test`).

**Spec reference:** `docs/superpowers/specs/2026-05-02-remove-bogie-tool-design.md`.

**Conventions:**

- 4-space indentation, single quotes, trailing comma `es5` (Prettier).
- Conventional commits scoped to area: `feat(train-editor): ...`.
- All icons imported from `@/assets/icons`, never directly from `lucide-react`.
- Tests use `bun:test` (`import { describe, it, expect } from 'bun:test'`).
- State machine files follow the existing pattern in `src/train-editor/bogie-add-state-machine.ts`.

**Out of scope (do NOT do these in this plan):**

- Undo / confirmation dialog.
- `Delete`/`Backspace` keyboard shortcut while in Edit Bogie mode.
- Bulk select, marquee removal, click-and-drag erasing.
- State-machine unit tests (no precedent — neither `bogie-add-state-machine` nor `bogie-kmt-state-machine` have tests).

---

## File Structure

**New files:**

- `src/train-editor/bogie-remove-state-machine.ts` — `INACTIVE` / `READY` state machine; `leftPointerDown` calls `removeBogieAt`.

**Modified files:**

- `src/train-editor/bogie-editor-engine.ts` — add public `removeBogieAt(position): boolean` method.
- `src/train-editor/train-editor-tool-switcher.ts` — add `REMOVE_BOGIE` state, `switchToRemoveBogie` event, `ToolRemoveBogieState`, factory parameter.
- `src/train-editor/train-editor-toolbar.tsx` — extend `TrainEditorMode`, add `Trash2` button + handler.
- `src/train-editor/index.ts` — re-export the new state-machine factory and types.
- `src/pages/train-editor.tsx` — instantiate `bogieRemoveStateMachine`, pass to tool-switcher factory.
- `src/i18n/locales/en.ts`, `src/i18n/locales/zh-TW.ts`, `src/i18n/locales/ja.ts` — add `removeBogie` and `endRemove` keys.

**Test files (modified):**

- `test/bogie-editor-engine.test.ts` — add a `describe` block for `removeBogieAt` (engine has existing tests for `exportCarDefinition`; this matches that bar).

---

## Task 1: Engine — `removeBogieAt` (TDD)

**Files:**

- Modify: `src/train-editor/bogie-editor-engine.ts`
- Modify: `test/bogie-editor-engine.test.ts`

- [ ] **Step 1: Write failing tests**

Append the following block at the end of `test/bogie-editor-engine.test.ts` (after the existing `describe('BogieEditorEngine.exportCarDefinition', ...)` block — keep the existing imports, do not duplicate them):

```ts
describe('BogieEditorEngine.removeBogieAt', () => {
    it('removes the bogie under the pointer and returns true', () => {
        const engine = makeEngine();
        engine.addBogie({ x: 0, y: 0 });
        engine.addBogie({ x: 10, y: 0 });

        const removed = engine.removeBogieAt({ x: 10, y: 0 });

        expect(removed).toBe(true);
        expect(engine.getBogies()).toEqual([{ x: 0, y: 0 }]);
    });

    it('returns false and changes nothing when no bogie is under the pointer', () => {
        const engine = makeEngine();
        engine.addBogie({ x: 0, y: 0 });
        engine.addBogie({ x: 10, y: 0 });

        const removed = engine.removeBogieAt({ x: 5, y: 0 });

        expect(removed).toBe(false);
        expect(engine.getBogies()).toHaveLength(2);
    });

    it('hits a bogie within the BOGIE_RADIUS (0.5) tolerance', () => {
        const engine = makeEngine();
        engine.addBogie({ x: 0, y: 0 });

        // Within 0.5 units of the bogie at (0,0)
        const removed = engine.removeBogieAt({ x: 0.4, y: 0 });

        expect(removed).toBe(true);
        expect(engine.getBogies()).toHaveLength(0);
    });

    it('notifies bogieRemoved subscribers with the removed index', () => {
        const engine = makeEngine();
        engine.addBogie({ x: 0, y: 0 });
        engine.addBogie({ x: 10, y: 0 });
        engine.addBogie({ x: 20, y: 0 });

        const removedIndices: number[] = [];
        engine.onBogieRemoved(index => removedIndices.push(index));

        engine.removeBogieAt({ x: 10, y: 0 });

        expect(removedIndices).toEqual([1]);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/bogie-editor-engine.test.ts`
Expected: 4 new tests fail with `engine.removeBogieAt is not a function` (or similar TypeError). Existing 4 tests still pass.

- [ ] **Step 3: Implement `removeBogieAt`**

In `src/train-editor/bogie-editor-engine.ts`, add the following method to the `BogieEditorEngine` class, immediately after the existing `removeBogie` method (around line 201):

```ts
/**
 * Hit-tests a world-space position against all bogies and removes the
 * matching one if any. Uses the same BOGIE_RADIUS tolerance as projectOnBogie
 * but does not mutate the edit-mode selection state (`_currentBogie`).
 */
removeBogieAt(position: Point): boolean {
    const index = this._bogies.findIndex(
        bogie =>
            PointCal.distanceBetweenPoints(position, bogie) < BOGIE_RADIUS
    );
    if (index === -1) return false;
    return this.removeBogie(index);
}
```

(`Point` and `PointCal` are already imported at the top of the file; `BOGIE_RADIUS` is the module-level constant on line 18.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/bogie-editor-engine.test.ts`
Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/train-editor/bogie-editor-engine.ts test/bogie-editor-engine.test.ts
git commit -m "feat(train-editor): add BogieEditorEngine.removeBogieAt"
```

---

## Task 2: Bogie remove state machine

**Files:**

- Create: `src/train-editor/bogie-remove-state-machine.ts`

- [ ] **Step 1: Create the state machine file**

Create `src/train-editor/bogie-remove-state-machine.ts` with the following exact content (this mirrors `bogie-add-state-machine.ts` swapping `add` for `remove`):

```ts
import {
    BaseContext,
    EventReactions,
    NO_OP,
    StateMachine,
    TemplateState,
    TemplateStateMachine,
} from '@ue-too/being';
import { Point } from '@ue-too/math';

export type BogieRemoveStates = 'INACTIVE' | 'READY';

export type BogieRemoveEvents = {
    startRemoving: {};
    endRemoving: {};
    leftPointerDown: Point;
    leftPointerUp: Point;
    pointerMove: Point;
};

export type BogieRemoveContext = BaseContext & {
    removeBogieAt: (position: Point) => boolean;
    convert2WorldPosition: (pointInWindow: Point) => Point;
};

export type BogieRemoveStateMachine = StateMachine<
    BogieRemoveEvents,
    BogieRemoveContext,
    BogieRemoveStates
>;

class BogieRemoveInactiveState extends TemplateState<
    BogieRemoveEvents,
    BogieRemoveContext,
    BogieRemoveStates
> {
    protected _eventReactions = {
        startRemoving: {
            action: NO_OP,
            defaultTargetState: 'READY' as const,
        },
    } as EventReactions<BogieRemoveEvents, BogieRemoveContext, BogieRemoveStates>;
}

class BogieRemoveReadyState extends TemplateState<
    BogieRemoveEvents,
    BogieRemoveContext,
    BogieRemoveStates
> {
    protected _eventReactions = {
        leftPointerDown: {
            action: this.leftPointerDown.bind(this),
        },
        endRemoving: {
            action: NO_OP,
            defaultTargetState: 'INACTIVE' as const,
        },
    } as EventReactions<BogieRemoveEvents, BogieRemoveContext, BogieRemoveStates>;

    leftPointerDown(context: BogieRemoveContext, payload: Point): void {
        const worldPos = context.convert2WorldPosition(payload);
        context.removeBogieAt(worldPos);
    }
}

export const createBogieRemoveStateMachine = (
    context: BogieRemoveContext
): BogieRemoveStateMachine => {
    return new TemplateStateMachine<
        BogieRemoveEvents,
        BogieRemoveContext,
        BogieRemoveStates
    >(
        {
            INACTIVE: new BogieRemoveInactiveState(),
            READY: new BogieRemoveReadyState(),
        },
        'INACTIVE',
        context
    );
};
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `bun run build`
Expected: build succeeds. (No consumers yet, so this only proves the file itself type-checks.)

- [ ] **Step 3: Commit**

```bash
git add src/train-editor/bogie-remove-state-machine.ts
git commit -m "feat(train-editor): add bogie remove state machine"
```

---

## Task 3: Wire `REMOVE_BOGIE` into the tool switcher

**Files:**

- Modify: `src/train-editor/train-editor-tool-switcher.ts`

- [ ] **Step 1: Add the type import**

In `src/train-editor/train-editor-tool-switcher.ts`, add the new type import alongside the existing ones (after the `BogieAddStateMachine` import, around line 11):

```ts
import type { BogieRemoveStateMachine } from './bogie-remove-state-machine';
```

- [ ] **Step 2: Extend the states tuple and events type**

Replace the `TRAIN_EDITOR_TOOL_STATES` constant (around lines 16-22) with:

```ts
export const TRAIN_EDITOR_TOOL_STATES = [
    'IDLE',
    'EDIT_BOGIE',
    'ADD_BOGIE',
    'REMOVE_BOGIE',
    'EDIT_IMAGE',
    'EDIT_IMAGE_CROP',
] as const;
```

Replace the `TrainEditorToolEvents` type (around lines 26-32) with:

```ts
export type TrainEditorToolEvents = {
    switchToEditBogie: {};
    switchToAddBogie: {};
    switchToRemoveBogie: {};
    switchToEditImage: {};
    switchToCropImage: {};
    switchToIdle: {};
};
```

- [ ] **Step 3: Add `switchToRemoveBogie` reactions to every existing state**

In `ToolIdleState._eventReactions` (around line 51), add the new reaction between `switchToAddBogie` and `switchToEditImage`:

```ts
        switchToRemoveBogie: {
            action: NO_OP,
            defaultTargetState: 'REMOVE_BOGIE',
        },
```

In `ToolEditBogieState._eventReactions` (around line 115), add the same reaction between `switchToAddBogie` and `switchToEditImage`:

```ts
        switchToRemoveBogie: {
            action: NO_OP,
            defaultTargetState: 'REMOVE_BOGIE',
        },
```

In `ToolAddBogieState._eventReactions` (around line 179), add the same reaction between `switchToAddBogie` (which is the self-no-op) and `switchToEditImage`:

```ts
        switchToRemoveBogie: {
            action: NO_OP,
            defaultTargetState: 'REMOVE_BOGIE',
        },
```

In `ToolEditImageState._eventReactions` (around line 243), add the same reaction between `switchToAddBogie` and `switchToEditImage`:

```ts
        switchToRemoveBogie: {
            action: NO_OP,
            defaultTargetState: 'REMOVE_BOGIE',
        },
```

In `ToolCropImageState._eventReactions` (around line 307), add the same reaction between `switchToAddBogie` and `switchToEditImage`:

```ts
        switchToRemoveBogie: {
            action: NO_OP,
            defaultTargetState: 'REMOVE_BOGIE',
        },
```

- [ ] **Step 4: Add the `ToolRemoveBogieState` class**

Insert the following class definition immediately after `ToolAddBogieState` ends (around line 200, before `ToolEditImageState`):

```ts
class ToolRemoveBogieState extends TemplateState<
    TrainEditorToolEvents,
    TrainEditorToolContext,
    TrainEditorToolStates
> {
    private _bogieRemoveStateMachine: BogieRemoveStateMachine;

    constructor(bogieRemoveStateMachine: BogieRemoveStateMachine) {
        super();
        this._bogieRemoveStateMachine = bogieRemoveStateMachine;
    }

    uponEnter(): void {
        this._bogieRemoveStateMachine.happens('startRemoving');
    }

    beforeExit(): void {
        this._bogieRemoveStateMachine.happens('endRemoving');
    }

    protected _defer: Defer<
        TrainEditorToolContext,
        TrainEditorToolEvents,
        TrainEditorToolStates
    > = {
        action: (_context, event, eventKey) => {
            const result = this._bogieRemoveStateMachine.happens(
                eventKey as string,
                event
            );
            if (result.handled) {
                return { handled: true, output: result.output };
            }
            return { handled: false };
        },
    };

    protected _eventReactions: EventReactions<
        TrainEditorToolEvents,
        TrainEditorToolContext,
        TrainEditorToolStates
    > = {
        switchToEditBogie: {
            action: NO_OP,
            defaultTargetState: 'EDIT_BOGIE',
        },
        switchToAddBogie: {
            action: NO_OP,
            defaultTargetState: 'ADD_BOGIE',
        },
        switchToRemoveBogie: {
            action: NO_OP,
        },
        switchToEditImage: {
            action: NO_OP,
            defaultTargetState: 'EDIT_IMAGE',
        },
        switchToCropImage: {
            action: NO_OP,
            defaultTargetState: 'EDIT_IMAGE_CROP',
        },
        switchToIdle: {
            action: NO_OP,
            defaultTargetState: 'IDLE',
        },
    };
}
```

- [ ] **Step 5: Update the factory signature and state map**

Replace the `createTrainEditorToolSwitcher` function (around lines 330-351) with:

```ts
export const createTrainEditorToolSwitcher = (
    bogieEditStateMachine: BogieEditStateMachine,
    bogieAddStateMachine: BogieAddStateMachine,
    bogieRemoveStateMachine: BogieRemoveStateMachine,
    imageEditStateMachine: ImageEditStateMachine,
    imageCropStateMachine: ImageCropStateMachine
): TrainEditorToolStateMachine => {
    return new TemplateStateMachine<
        TrainEditorToolEvents,
        TrainEditorToolContext,
        TrainEditorToolStates
    >(
        {
            IDLE: new ToolIdleState(),
            EDIT_BOGIE: new ToolEditBogieState(bogieEditStateMachine),
            ADD_BOGIE: new ToolAddBogieState(bogieAddStateMachine),
            REMOVE_BOGIE: new ToolRemoveBogieState(bogieRemoveStateMachine),
            EDIT_IMAGE: new ToolEditImageState(imageEditStateMachine),
            EDIT_IMAGE_CROP: new ToolCropImageState(imageCropStateMachine),
        },
        'IDLE',
        { setup: () => {}, cleanup: () => {} }
    );
};
```

- [ ] **Step 6: Verify TypeScript compiles (build will fail downstream — that is expected)**

Run: `bunx tsc --noEmit`
Expected: errors only in `src/pages/train-editor.tsx` complaining about a missing 5th argument to `createTrainEditorToolSwitcher`. Task 4 fixes that. The tool-switcher file itself must have **no** errors — if it does, fix them before moving on.

- [ ] **Step 7: Commit**

```bash
git add src/train-editor/train-editor-tool-switcher.ts
git commit -m "feat(train-editor): add REMOVE_BOGIE tool-switcher state"
```

---

## Task 4: Wire the remove state machine in `pages/train-editor.tsx`

**Files:**

- Modify: `src/pages/train-editor.tsx`

- [ ] **Step 1: Add the import**

In `src/pages/train-editor.tsx`, add the import alongside the existing add-state-machine import (after line 8):

```ts
import { createBogieRemoveStateMachine } from '@/train-editor/bogie-remove-state-machine';
```

- [ ] **Step 2: Instantiate the remove state machine**

In `initTrainEditor`, find the existing `bogieAddStateMachine` line (around line 77):

```ts
    const bogieAddStateMachine = createBogieAddStateMachine(bogieEditorEngine);
```

Add immediately after it:

```ts
    const bogieRemoveStateMachine =
        createBogieRemoveStateMachine(bogieEditorEngine);
```

`BogieEditorEngine` already implements `convert2WorldPosition` and now (after Task 1) `removeBogieAt`, so it satisfies `BogieRemoveContext` directly — no adapter needed.

- [ ] **Step 3: Pass it into the tool switcher factory**

Replace the `createTrainEditorToolSwitcher` call (around lines 84-89) with:

```ts
    const toolSwitcher = createTrainEditorToolSwitcher(
        bogieEditStateMachine,
        bogieAddStateMachine,
        bogieRemoveStateMachine,
        imageEditStateMachine,
        imageCropStateMachine
    );
```

- [ ] **Step 4: Verify TypeScript compiles end-to-end**

Run: `bunx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/train-editor.tsx
git commit -m "feat(train-editor): wire bogie remove state machine into editor page"
```

---

## Task 5: Re-export from train-editor barrel

**Files:**

- Modify: `src/train-editor/index.ts`

- [ ] **Step 1: Add the re-exports**

In `src/train-editor/index.ts`, add the following block immediately after the existing `createBogieAddStateMachine` re-export block (around line 14):

```ts
export { createBogieRemoveStateMachine } from './bogie-remove-state-machine';
export type {
    BogieRemoveContext,
    BogieRemoveStateMachine,
} from './bogie-remove-state-machine';
```

- [ ] **Step 2: Verify build**

Run: `bun run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/train-editor/index.ts
git commit -m "feat(train-editor): re-export bogie remove state machine"
```

---

## Task 6: i18n strings

**Files:**

- Modify: `src/i18n/locales/en.ts`
- Modify: `src/i18n/locales/zh-TW.ts`
- Modify: `src/i18n/locales/ja.ts`

- [ ] **Step 1: Add English keys**

In `src/i18n/locales/en.ts`, find the lines (around 228-229):

```ts
        addBogie: 'Add Bogie',
        endAdd: 'End Add',
```

Add immediately after them:

```ts
        removeBogie: 'Remove Bogie',
        endRemove: 'End Remove',
```

- [ ] **Step 2: Add Traditional Chinese keys**

In `src/i18n/locales/zh-TW.ts`, find the lines (around 220-221):

```ts
        addBogie: '新增轉向架',
        endAdd: '結束新增',
```

Add immediately after them:

```ts
        removeBogie: '移除轉向架',
        endRemove: '結束移除',
```

- [ ] **Step 3: Add Japanese keys**

In `src/i18n/locales/ja.ts`, find the lines (around 225-226):

```ts
        addBogie: '台車を追加',
        endAdd: '追加終了',
```

Add immediately after them:

```ts
        removeBogie: '台車を削除',
        endRemove: '削除終了',
```

- [ ] **Step 4: Verify build**

Run: `bun run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/locales/en.ts src/i18n/locales/zh-TW.ts src/i18n/locales/ja.ts
git commit -m "feat(train-editor): add i18n strings for remove bogie tool"
```

---

## Task 7: Toolbar button

**Files:**

- Modify: `src/train-editor/train-editor-toolbar.tsx`

- [ ] **Step 1: Add the `Trash2` icon import**

In `src/train-editor/train-editor-toolbar.tsx`, find the icon import block (lines 5-17). Add `Trash2` to the imports — replace the block with:

```tsx
import {
    Check,
    Crop,
    Download,
    FolderOpen,
    GripHorizontal,
    Image,
    MousePointer2,
    Plus,
    Save,
    Trash2,
    Upload,
    X,
} from '@/assets/icons';
```

- [ ] **Step 2: Extend the `TrainEditorMode` union**

Replace the `TrainEditorMode` type (around lines 49-54) with:

```tsx
type TrainEditorMode =
    | 'idle'
    | 'edit-bogie'
    | 'add-bogie'
    | 'remove-bogie'
    | 'edit-image'
    | 'crop-image';
```

- [ ] **Step 3: Add the toggle handler**

After `handleAddBogieToggle` (which ends around line 205), insert:

```tsx
    const handleRemoveBogieToggle = useCallback(() => {
        if (!app) return;
        if (mode === 'remove-bogie') {
            app.trainEditorKmtStateMachine.happens('switchToIdle');
            setMode('idle');
        } else {
            exitAllModes();
            app.trainEditorKmtStateMachine.happens('switchToRemoveBogie');
            setMode('remove-bogie');
        }
    }, [app, mode, exitAllModes]);
```

- [ ] **Step 4: Add the toolbar button**

Find the existing Add Bogie `ToolbarButton` (around lines 480-488):

```tsx
                    {/* Add bogie */}
                    <ToolbarButton
                        tooltip={
                            mode === 'add-bogie' ? t('endAdd') : t('addBogie')
                        }
                        active={mode === 'add-bogie'}
                        onClick={handleAddBogieToggle}
                    >
                        <Plus />
                    </ToolbarButton>
```

Insert this block immediately after it (and before the `<Separator />` on line 490):

```tsx
                    {/* Remove bogie */}
                    <ToolbarButton
                        tooltip={
                            mode === 'remove-bogie'
                                ? t('endRemove')
                                : t('removeBogie')
                        }
                        active={mode === 'remove-bogie'}
                        onClick={handleRemoveBogieToggle}
                    >
                        <Trash2 />
                    </ToolbarButton>
```

- [ ] **Step 5: Verify build**

Run: `bun run build`
Expected: build succeeds.

- [ ] **Step 6: Run all tests**

Run: `bun test`
Expected: all tests pass (including the four new `removeBogieAt` cases from Task 1).

- [ ] **Step 7: Commit**

```bash
git add src/train-editor/train-editor-toolbar.tsx
git commit -m "feat(train-editor): add Remove Bogie toolbar button"
```

---

## Task 8: Manual verification

**Files:** none

- [ ] **Step 1: Start the dev server**

Run: `bun run dev`
Expected: dev server starts on a local port.

- [ ] **Step 2: Open the train editor in a browser**

Navigate to the train editor route. The toolbar on the left should now show, in order: Edit Bogie (cursor) → Add Bogie (plus) → **Remove Bogie (trash)** → separator → Car Type / Width inputs → ...

- [ ] **Step 3: Test the golden path**

  1. Click Add Bogie. Click in the canvas three times to drop three bogies on the constraint line.
  2. Click Remove Bogie (trash icon) — it should highlight as active and the tooltip should say "End Remove" on hover.
  3. Click directly on one of the bogies — it disappears.
  4. Click again on another bogie — it disappears.
  5. Click in empty canvas space — nothing happens (no errors in the devtools console).
  6. Click the Remove Bogie button again — it deactivates, tooltip switches back to "Remove Bogie".

- [ ] **Step 4: Test edge cases**

  - With no bogies on canvas: enter Remove mode, click anywhere — no errors, nothing happens.
  - Switch directly from Edit Bogie → Remove Bogie → Edit Bogie. Each mode highlights correctly; only one is active at a time.
  - Switch directly from Remove Bogie → Add Bogie. Add Bogie should activate; Remove Bogie should deactivate. Click adds a new bogie.
  - Switch Remove Bogie → Edit Image / Crop Image (with an image loaded). Tools toggle correctly with no stuck state.
  - Remove all bogies until zero remain. Export (Download icon) and Save-to-Library should auto-disable (existing behavior — verify it still works after this change).

- [ ] **Step 5: Test in two locales**

Switch language to Traditional Chinese (or Japanese) via whatever existing language switcher exists. Hover over the trash button — tooltip should display the localized "Remove Bogie" / "移除轉向架" / "台車を削除".

- [ ] **Step 6: Run formatter and tests**

Run:

```bash
bun run format
bun run format:check
bun test
bun run build
```

Expected: format succeeds with no diff, format:check passes, all tests pass, build succeeds.

- [ ] **Step 7: Commit anything formatter touched (if any)**

```bash
git status
# if there are changes from `bun run format`:
git add -A
git commit -m "chore: prettier formatting"
```

(Skip if `bun run format` produced no diff.)
