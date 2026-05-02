# Remove Bogie Tool — Design

## Goal

Let users delete existing bogies in the train editor (a.k.a. car maker). Today the editor exposes Edit Bogie (drag) and Add Bogie (click to place) but offers no UI for removing a bogie that was placed by mistake or imported from a definition that no longer fits. Users currently have to clear the canvas (e.g. by reimporting) to get rid of an unwanted bogie.

## Scope

In scope:

- A new dedicated **Remove Bogie** toolbar tool: while active, clicking on an existing bogie deletes it; the tool stays active for repeated removals until toggled off.
- The supporting state machine, tool-switcher integration, engine-level hit-test+remove method, and i18n strings.

Out of scope:

- Undo / confirmation dialogs. Removal is silent and immediate, matching the rest of the editor (e.g. the file import path already silently clears all bogies).
- A keyboard shortcut (e.g. `Delete` while in Edit Bogie mode). The user explicitly picked the dedicated-tool approach.
- Bulk select + delete, marquee removal, or click-and-drag-to-erase. Single-click removal only.
- Tests. Neither the existing `bogie-add-state-machine` nor `BogieEditorEngine.removeBogie` have unit tests; staying consistent with that bar rather than introducing a new convention here.

## Architecture

The feature mirrors the **Add Bogie** pattern exactly. Add Bogie consists of:

1. A small dedicated state machine (`bogie-add-state-machine.ts`) with `INACTIVE` / `READY` states.
2. A `ToolAddBogieState` in the tool switcher that delegates events to that machine.
3. A toolbar button that toggles the tool switcher into / out of `ADD_BOGIE`.

Remove Bogie gets its own equivalent triple. The bogie-edit state machine (drag) is **not** modified — keeping responsibilities separated means the edit machine continues to own selection-during-drag and the remove machine owns hit-test-and-delete.

## Components

### 1. `src/train-editor/bogie-remove-state-machine.ts` (new)

Direct sibling of `bogie-add-state-machine.ts`. Contract:

```ts
export type BogieRemoveStates = 'INACTIVE' | 'READY';

export type BogieRemoveEvents = {
    startRemoving: {};
    endRemoving: {};
    leftPointerDown: Point;
};

export type BogieRemoveContext = BaseContext & {
    removeBogieAt: (position: Point) => boolean;
    convert2WorldPosition: (pointInWindow: Point) => Point;
};
```

`INACTIVE` transitions to `READY` on `startRemoving`. `READY` handles `leftPointerDown` by converting the window point to world space and calling `removeBogieAt`. The return value is ignored (a click that misses every bogie is a no-op). `READY` transitions back to `INACTIVE` on `endRemoving`.

### 2. `BogieEditorEngine.removeBogieAt(position): boolean` (new)

A small public method that hit-tests a world-space position against existing bogies using the same `BOGIE_RADIUS` distance check as `projectOnBogie`, then calls the existing private `removeBogie(index)` if a bogie is hit. Returns `true` on a successful removal, `false` if nothing was under the pointer.

Why a new method (instead of letting the remove state machine call `projectOnBogie` then `removeBogie`): `projectOnBogie` is purpose-built for the edit machine — it has the side effect of writing to `_currentBogie` to prime the subsequent drag. Reusing it from the remove path would tangle the two machines' selection states. A separate method also keeps `_currentBogie` private rather than exposing it.

### 3. `src/train-editor/train-editor-tool-switcher.ts` (modified)

- Extend `TRAIN_EDITOR_TOOL_STATES` with `'REMOVE_BOGIE'`.
- Extend `TrainEditorToolEvents` with `switchToRemoveBogie: {}`.
- Add a `ToolRemoveBogieState` class — a copy of `ToolAddBogieState` that holds a `BogieRemoveStateMachine`, fires `startRemoving` on enter, `endRemoving` on exit, and defers events to the remove machine.
- Add `switchToRemoveBogie` reactions to every other state (`IDLE`, `EDIT_BOGIE`, `ADD_BOGIE`, `EDIT_IMAGE`, `EDIT_IMAGE_CROP`) so transitions are bidirectional, matching the existing pattern.
- In `ToolRemoveBogieState`, add reactions for the four other `switchTo*` events plus a no-op `switchToRemoveBogie` reaction (mirroring the self-no-op pattern used by every other tool state).
- Extend `createTrainEditorToolSwitcher` to take a `bogieRemoveStateMachine: BogieRemoveStateMachine` parameter and instantiate `REMOVE_BOGIE: new ToolRemoveBogieState(bogieRemoveStateMachine)`.

### 4. `src/pages/train-editor.tsx` (modified)

Instantiate the remove state machine alongside the existing ones and pass it into the tool switcher factory:

```ts
const bogieRemoveStateMachine = createBogieRemoveStateMachine(bogieEditorEngine);
// ...
const toolSwitcher = createTrainEditorToolSwitcher(
    bogieEditStateMachine,
    bogieAddStateMachine,
    bogieRemoveStateMachine,
    imageEditStateMachine,
    imageCropStateMachine
);
```

`BogieEditorEngine` already implements `convert2WorldPosition`, and after step 2 it implements `removeBogieAt`, so it satisfies `BogieRemoveContext` directly — no adapter needed (same as the add machine).

### 5. `src/train-editor/train-editor-toolbar.tsx` (modified)

- Extend the `TrainEditorMode` union with `'remove-bogie'`.
- Add a `handleRemoveBogieToggle` callback that mirrors `handleAddBogieToggle`: if currently in `'remove-bogie'` mode, switch the KMT machine to idle and set local mode to `'idle'`; otherwise call `exitAllModes()` then `switchToRemoveBogie` and set mode to `'remove-bogie'`.
- Import `Trash2` from `@/assets/icons` (already re-exported there).
- Add a `ToolbarButton` immediately below the existing Add Bogie button (and before the first `<Separator>`):

  ```tsx
  <ToolbarButton
      tooltip={mode === 'remove-bogie' ? t('endRemove') : t('removeBogie')}
      active={mode === 'remove-bogie'}
      onClick={handleRemoveBogieToggle}
  >
      <Trash2 />
  </ToolbarButton>
  ```

### 6. `src/train-editor/index.ts` (modified)

Re-export `createBogieRemoveStateMachine` and its types alongside the existing add-machine exports.

### 7. i18n (`src/i18n/locales/en.ts`, `zh-TW.ts`, `ja.ts`)

Add two keys next to `addBogie` / `endAdd`:

| key | en | zh-TW | ja |
| --- | --- | --- | --- |
| `removeBogie` | Remove Bogie | 移除轉向架 | 台車を削除 |
| `endRemove` | End Remove | 結束移除 | 削除終了 |

## Data flow

```
window pointerdown
  └─> KMT extension idle state
        └─> defers to tool switcher
              └─> REMOVE_BOGIE state defers to bogieRemoveStateMachine
                    └─> READY.leftPointerDown
                          └─> convert2WorldPosition(window)
                          └─> bogieEditorEngine.removeBogieAt(world)
                                ├─ hit  → removeBogie(index)
                                │         └─ _bogieRemovedObservable.notify(index)
                                │             └─ BogieEditorRenderSystem updates (already wired)
                                └─ miss → no-op
```

## Risks / interactions

- **Interaction with image-edit hit-testing**: the image edit and crop tools have their own pointer handling and aren't reachable from `REMOVE_BOGIE` (the tool switcher routes events to one tool at a time). No conflict.
- **Interaction with Edit Bogie's `_currentBogie` selection**: removed, because Remove Bogie doesn't touch `projectOnBogie`. If the user removes a bogie while a previous Edit Bogie session had cached a selection index, that index is stale — but Edit Bogie's drag state already calls `dropCurrentBogie` on `leftPointerUp` and re-resolves on the next `leftPointerDown`, so the staleness window cannot be observed by users.
- **Empty-canvas state**: removing the last bogie just leaves the canvas with zero bogies. Export and Save-to-Library are already gated on `hasBogies` (`bogies.length >= 2`), so they self-disable.
