# Car Maker — Image Crop and Width-from-Image Coupling

Date: 2026-05-02

## Goal

Add a crop tool to the train (car) editor and bind per-car body width to the imported image's world-space height, so the image and the car's declared width stay in sync without manual reconciliation.

## Background

The car maker (`src/train-editor/`) lets the user import an image, drag it, and proportionally resize it via four corner handles. PR #9 added a per-car body `width` attribute (default `2.5`) that is rendered in the bogie editor and exported in `CarDefinitionData`.

Today the import flow scales the image so `max(width, height) = 10` world units, and `width` is edited as a free-standing number input. There is no relationship between the image's dimensions and the car's declared width, so the two can drift arbitrarily.

## Scope

In scope:
- A new "Crop" tool in the train-editor toolbar with handle-driven cropping that destructively re-encodes the image.
- Continuous bidirectional coupling between the image's world-space height and the car body width.
- Tests and minimal toolbar / wiring changes to support the above.

Out of scope:
- Non-rectangular crops, rotation, fixed aspect locking, undo/redo.
- Real-world unit calibration (e.g. "this image is N meters tall").
- Reworking how bogies relate to width beyond hooking the bogie editor's width to the new observable flow.

## Coupling rule (width ↔ image)

Single rule when an image is present: `imageHeight (world) === carBodyWidth`.

| User action | Effect |
| --- | --- |
| Import image | Image scaled so `height = currentCarWidth`, aspect preserved. Width input value unchanged. |
| Drag-resize image (corner handle, proportional) | `imageHeight` changes → `carBodyWidth` follows live; bogie-editor visual width follows; toolbar input value follows. |
| Type a new width in the toolbar input | If an image is present, the engine rescales the image so `height = newWidth`, aspect preserved, position centered as before. If no image, behaves as today. |
| Crop image (commit) | Image's new world-height = the crop rect's world-height → width follows automatically. |
| Remove / replace image | Width input becomes manually editable as today. |

There is no separate "deduction" branching — it is one source of truth (`EditorImage.height`) flowing through `ImageEditorEngine` and observed by both the toolbar input and the bogie editor. Resize remains corner-only and proportional, matching today's behavior.

## Crop tool architecture

### Toolbar

A new `Crop` icon button is added between "Import image" and "Edit image" in `src/train-editor/train-editor-toolbar.tsx`. Disabled when no image is loaded, active-styled while crop mode is on. While in crop mode the toolbar shows two extra buttons (Check / X) bound to `commitCrop` / `cancelCrop`.

The "Edit image" button is disabled while crop mode is active. The width input is also disabled while crop mode is active, since the crop rect is derived from the image's current world dimensions and rescaling mid-crop would invalidate it. Switching to any other tool while in crop mode auto-cancels the crop.

Any required Lucide icons (e.g. `Crop`, `Check`, `X`) that are not already exported are added to `src/assets/icons/lucide.ts` per `CLAUDE.md`; icons are never imported directly from `lucide-react`.

### State machine

`src/train-editor/image-crop-state-machine.ts`, mirroring `image-edit-state-machine.ts` and the `@ue-too/being` patterns referenced in `CLAUDE.md`.

States: `INACTIVE`, `IDLE`, `RESIZING`.

Events: `startCrop`, `endCrop`, `commitCrop`, `cancelCrop`, `leftPointerDown`, `leftPointerUp`, `leftPointerMove`, `pointerMove`.

Transitions:
- `INACTIVE --startCrop--> IDLE`
- `IDLE --leftPointerDown[hitHandle]--> RESIZING`
- `RESIZING --leftPointerUp--> IDLE`
- `IDLE --commitCrop--> INACTIVE` (engine commits, image is replaced)
- `IDLE --cancelCrop--> INACTIVE`
- `IDLE --endCrop--> INACTIVE` (auto-cancel on external tool switch)

Context: `{ cropEngine: ImageCropEngine }`.

### Engine

`src/train-editor/image-crop-engine.ts`. Holds:
- A reference to `ImageEditorEngine` for reading the current image and writing the cropped result.
- A `CropRect` in world space `{ x, y, width, height }` for the area inside the image to keep. Initialized to the full image bounds when crop mode starts.
- Hit-testing for four corner crop handles, using the same screen-pixel radius convention as the edit handles (`HANDLE_HIT_RADIUS_PX`).
- `startResize(handle)`, `updateResize(worldPos)`, `endInteraction()` — clamped so the rect stays inside the image and never collapses below the existing `0.1` world-unit floor.
- `commit()`: maps the world-space crop rect to source-pixel coordinates, draws the crop region onto an offscreen `HTMLCanvasElement`, and re-encodes via `toDataURL('image/png')`. Then calls `imageEditorEngine.setImage(newSrc, cropRect.width, cropRect.height)` and centers position on the cropped region's world center. The width-coupling observable picks up the new height automatically.
- `cancel()`: discards the rect, leaves the image untouched.
- An observable for the rect so the render system can draw it live.

PNG is chosen to preserve transparency on cutouts. Source bitmap is loaded via `new Image(); img.src = editorImage.src;` and awaited via `img.decode()` before drawing.

### Render system

`ImageRenderSystem` is extended with a `showCropRect` toggle (parallel to the existing `showHandles`). When the toggle is on it draws:
- A semi-transparent dim overlay over the parts of the image outside the crop rect.
- The crop rect border.
- Four inner corner handles in a distinct color (orange) so the mode is visually unambiguous.

Edit handles and crop handles never appear simultaneously — toggling crop mode flips both flags.

### Wiring

`train-editor-kmt-extension.ts` and `train-editor-tool-switcher.ts` get a new `EDIT_IMAGE_CROP` state forwarding pointer events into the crop state machine, in the same shape as the existing image-edit wiring. The toolbar's `TrainEditorMode` union gains `'crop-image'`.

## Data and persistence

`EditorImage { src, position, width, height }` is unchanged. Crop rewrites `src` (new data URL) and updates `width` / `height` / `position`. `CarDefinitionData` schema is untouched, so saved library entries and exported JSON continue to work without a migration.

## Edge cases and guards

- Crop rect clamped to image bounds during drag (no negative or out-of-image regions).
- Minimum crop size `0.1` world units per dimension, matching the existing resize floor.
- Cancel-on-tool-switch: any transition out of `EDIT_IMAGE_CROP` while in crop mode discards the rect.
- If `setImage` is called externally during crop mode (e.g. user re-imports), crop mode auto-exits.
- Image load failure during commit (decode error) is logged; state is not mutated and crop mode stays active so the user can retry or cancel.

## Testing

Bun test runner per `CLAUDE.md`.

- `image-crop-state-machine.test.ts` — pointer-driven state transitions: `IDLE → RESIZING → IDLE` on handle drag; `commitCrop` / `cancelCrop` from `IDLE`; auto-cancel on `endCrop`. Engine is mocked.
- `image-crop-engine.test.ts` — rect clamping, world↔pixel coordinate conversion, commit produces a new `EditorImage` with expected dimensions and centered position. The `toDataURL` step is exercised through a small fake or stubbed at the boundary; the unit under test is the dimension and position math, not the encoder.
- `image-editor-engine.test.ts` (extend) — new `rescaleToWidth(width)` method preserves aspect ratio and position; resize-drag emits a new height that consumers can bind to.

Existing tests must stay green.

## Open questions

None at design time — to be revisited during implementation if encoder availability in test environment forces a different boundary.
