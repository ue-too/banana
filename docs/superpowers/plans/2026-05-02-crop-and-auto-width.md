# Car Maker — Image Crop and Width-from-Image Coupling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a destructive corner-handle "Crop" tool to the car maker, and bind the per-car body width bidirectionally to the imported image's world-space height so the two stay in sync without manual reconciliation.

**Architecture:** A new `ImageCropEngine` holds a world-space crop rect and re-encodes the image (canvas + `toDataURL('image/png')`) on commit, then calls `imageEditorEngine.setImage(...)` with the crop's world dimensions. A new `ImageCropStateMachine` (states `INACTIVE`, `IDLE`, `RESIZING`) follows the existing `image-edit-state-machine.ts` shape. The toolbar gains a Crop button + confirm/cancel buttons, plus a React effect that subscribes to `imageEditorEngine.onImageChanged` so any image-height change (import, drag-resize, crop commit) propagates into both the toolbar's `carWidth` state and `bogieEditorEngine.setWidth(...)`. Typing a new width with an image present rescales the image via a new `imageEditorEngine.rescaleToWidth(width)` method (preserves aspect + position).

**Tech Stack:** TypeScript, Bun test runner (`import from 'bun:test'`), `@ue-too/being` state machines, `@ue-too/board` for camera/canvas conversions, PIXI.js for rendering, React + Tailwind (toolbar UI).

**Spec reference:** `docs/superpowers/specs/2026-05-02-crop-and-auto-width-design.md`

**Conventions:**

- All icons imported from `@/assets/icons` (per `CLAUDE.md`).
- All human interaction logic uses `@ue-too/being` state machines (per `CLAUDE.md`).
- Tests use Bun's built-in test runner (`import { describe, expect, it } from 'bun:test'`).
- 4-space indentation, single quotes, `es5` trailing commas (Prettier config).
- Conventional commits scoped: `feat(train-editor): ...`, `test(train-editor): ...`, `chore(i18n): ...`.

**Out of scope:**

- Non-rectangular crops, rotation, fixed aspect lock, undo/redo.
- Real-world unit calibration (e.g. "this image represents N meters").
- Reworking how bogies relate to width beyond hooking the bogie editor's existing `setWidth` to the new flow.

---

## File Structure

**Modified files:**

- `src/train-editor/image-editor-engine.ts` — add `rescaleToWidth(width)`; let `setImage` accept an optional `position` parameter so crop commit can place the new image without a follow-up mutation.
- `src/train-editor/image-render-system.ts` — add `showCropRect` toggle; subscribe to crop engine's rect observable; draw dim overlay + crop border + four orange corner handles.
- `src/train-editor/train-editor-tool-switcher.ts` — add `EDIT_IMAGE_CROP` state and `switchToCropImage` event; route pointer events to the crop state machine.
- `src/train-editor/train-editor-toolbar.tsx` — add Crop / Confirm / Cancel buttons; add `'crop-image'` mode; add subscription effect for image→width coupling; rewrite import scaling so image height = current car width; keyboard shortcuts (Enter / Escape) gated on crop mode; disable width input + Edit-image button while in crop mode.
- `src/train-editor/types.ts` — add `imageCropEngine: ImageCropEngine` to `TrainEditorComponents`.
- `src/train-editor/index.ts` — export new engine + state machine + types.
- `src/pages/train-editor.tsx` — instantiate `ImageCropEngine` and `ImageCropStateMachine`; pass to tool switcher; auto-cancel crop on external `setImage`.
- `src/assets/icons/lucide.ts` — add `Crop` to the export list (Lucide React `Crop` icon).
- `src/i18n/locales/en.ts`, `zh-TW.ts`, `ja.ts` — add `cropImage`, `endCrop`, `confirmCrop`, `cancelCrop` keys.

**New files:**

- `src/train-editor/image-crop-engine.ts` — engine holding the world-space crop rect, hit-testing handles, and committing the crop via a swappable renderer.
- `src/train-editor/image-crop-state-machine.ts` — `INACTIVE`/`IDLE`/`RESIZING` state machine.

**New test files:**

- `test/image-editor-engine.test.ts` — covers the new `rescaleToWidth` (preserves aspect ratio, preserves position) and `setImage` with explicit position.
- `test/image-crop-engine.test.ts` — covers rect clamping, world↔pixel conversion math, commit returns expected dimensions/position with a stubbed renderer.
- `test/image-crop-state-machine.test.ts` — covers `INACTIVE → IDLE → RESIZING → IDLE`, `commitCrop`/`cancelCrop` from `IDLE`, auto-cancel on `endCrop`.

---

## Task 1: Extend `ImageEditorEngine` with `rescaleToWidth` and `setImage(position?)`

**Files:**

- Modify: `src/train-editor/image-editor-engine.ts`
- Test: `test/image-editor-engine.test.ts` (create)

The crop commit needs `setImage` to accept an explicit world position, and the width-input → image rescale path needs a method that preserves aspect ratio and position.

- [ ] **Step 1: Write failing tests for `rescaleToWidth` and `setImage(position)`**

Create `test/image-editor-engine.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';

import { ImageEditorEngine } from '../src/train-editor/image-editor-engine';

// Minimal stubs — we only exercise math, not the camera/canvas conversions.
const camera = {
    zoomLevel: 1,
    position: { x: 0, y: 0 },
    rotation: 0,
    on: () => {},
} as any;

const canvas = { width: 800, height: 600 } as any;

describe('ImageEditorEngine.setImage', () => {
    it('places image at origin by default', () => {
        const engine = new ImageEditorEngine(camera, canvas);
        engine.setImage('data:image/png;base64,abc', 4, 2);
        const img = engine.getImage();
        expect(img).not.toBeNull();
        expect(img!.position).toEqual({ x: 0, y: 0 });
        expect(img!.width).toBe(4);
        expect(img!.height).toBe(2);
    });

    it('places image at the given position when provided', () => {
        const engine = new ImageEditorEngine(camera, canvas);
        engine.setImage('data:image/png;base64,abc', 4, 2, { x: 5, y: -3 });
        const img = engine.getImage();
        expect(img!.position).toEqual({ x: 5, y: -3 });
    });
});

describe('ImageEditorEngine.rescaleToWidth', () => {
    it('does nothing when there is no image', () => {
        const engine = new ImageEditorEngine(camera, canvas);
        engine.rescaleToWidth(3);
        expect(engine.getImage()).toBeNull();
    });

    it('scales height to the requested value while preserving aspect and position', () => {
        const engine = new ImageEditorEngine(camera, canvas);
        engine.setImage('data:image/png;base64,abc', 8, 2, { x: 1, y: 2 });
        engine.rescaleToWidth(4);
        const img = engine.getImage()!;
        expect(img.height).toBe(4);
        expect(img.width).toBeCloseTo(16, 6); // aspect 8/2 = 4 → width = 4*4
        expect(img.position).toEqual({ x: 1, y: 2 });
    });

    it('is a no-op when requested height equals current height', () => {
        const engine = new ImageEditorEngine(camera, canvas);
        engine.setImage('data:image/png;base64,abc', 8, 2);
        let notifyCount = 0;
        engine.onImageChanged(() => {
            notifyCount++;
        });
        engine.rescaleToWidth(2);
        expect(notifyCount).toBe(0);
    });
});
```

- [ ] **Step 2: Run tests and confirm they fail**

Run: `bun test test/image-editor-engine.test.ts`
Expected: tests fail because `rescaleToWidth` is not defined and `setImage` only takes 3 arguments.

- [ ] **Step 3: Implement `setImage(position?)` and `rescaleToWidth`**

In `src/train-editor/image-editor-engine.ts`:

Replace the `setImage` method:

```ts
setImage(
    src: string,
    width: number,
    height: number,
    position: Point = { x: 0, y: 0 }
): void {
    this._image = {
        src,
        position: { ...position },
        width,
        height,
    };
    this._imageChangedObservable.notify(this._image);
}
```

Add a new method below `setImage`:

```ts
/**
 * Rescales the image so its world-space height equals `newHeight`,
 * preserving aspect ratio and current position. No-op without an image
 * or when the new height equals the current height.
 */
rescaleToWidth(newHeight: number): void {
    if (!this._image) return;
    if (newHeight <= 0) return;
    if (this._image.height === newHeight) return;
    const aspect = this._image.width / this._image.height;
    this._image.height = newHeight;
    this._image.width = newHeight * aspect;
    this._imageChangedObservable.notify(this._image);
}
```

Note on naming: the method is called `rescaleToWidth` because the _car body width_ is what the caller is matching, but mechanically it sets the _image's height_ (the world axis perpendicular to car length). The doc comment makes this explicit so future readers don't get confused.

- [ ] **Step 4: Run tests and confirm they pass**

Run: `bun test test/image-editor-engine.test.ts`
Expected: all three tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/train-editor/image-editor-engine.ts test/image-editor-engine.test.ts
git commit -m "feat(train-editor): add rescaleToWidth and positional setImage"
```

---

## Task 2: Add `Crop` icon to the icon barrel and i18n keys

**Files:**

- Modify: `src/assets/icons/lucide.ts`
- Modify: `src/i18n/locales/en.ts`, `src/i18n/locales/zh-TW.ts`, `src/i18n/locales/ja.ts`

- [ ] **Step 1: Add the Crop icon export**

In `src/assets/icons/lucide.ts`, add `Crop` to the alphabetized export list (insert between `Copy` and `Crosshair`):

```ts
    Copy,
    Crop,
    Crosshair,
```

(`Check` and `X` are already exported and reused as confirm/cancel icons.)

- [ ] **Step 2: Add i18n keys to en.ts**

In `src/i18n/locales/en.ts`, after the `endImageEdit` line (around line 232):

```ts
        endImageEdit: 'End Image Edit',
        cropImage: 'Crop Image',
        endCrop: 'End Crop',
        confirmCrop: 'Confirm Crop',
        cancelCrop: 'Cancel Crop',
```

- [ ] **Step 3: Add i18n keys to zh-TW.ts**

In `src/i18n/locales/zh-TW.ts`, after the `endImageEdit` line (around line 224):

```ts
        endImageEdit: '結束圖片編輯',
        cropImage: '裁切圖片',
        endCrop: '結束裁切',
        confirmCrop: '確認裁切',
        cancelCrop: '取消裁切',
```

- [ ] **Step 4: Add i18n keys to ja.ts**

In `src/i18n/locales/ja.ts`, after the `endImageEdit` line (around line 229):

```ts
        endImageEdit: '画像編集を終了',
        cropImage: '画像をトリミング',
        endCrop: 'トリミング終了',
        confirmCrop: 'トリミング確定',
        cancelCrop: 'トリミング取消',
```

- [ ] **Step 5: Verify formatting**

Run: `bun run format:check`
Expected: clean. If not, run `bun run format`.

- [ ] **Step 6: Commit**

```bash
git add src/assets/icons/lucide.ts src/i18n/locales
git commit -m "chore(i18n): add Crop icon export and crop labels"
```

---

## Task 3: Create `ImageCropEngine` (math + commit)

**Files:**

- Create: `src/train-editor/image-crop-engine.ts`
- Test: `test/image-crop-engine.test.ts`

The engine owns: the world-space crop rect, four corner handle hit-tests, drag-handle math (clamped, no aspect lock, min size `0.1`), and a `commit()` that calls a swappable `cropRenderer` (the default uses HTMLCanvas + `toDataURL`).

- [ ] **Step 1: Write failing tests for the engine**

Create `test/image-crop-engine.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';

import {
    type CropRenderer,
    ImageCropEngine,
} from '../src/train-editor/image-crop-engine';
import { ImageEditorEngine } from '../src/train-editor/image-editor-engine';

const camera = {
    zoomLevel: 1,
    position: { x: 0, y: 0 },
    rotation: 0,
    on: () => {},
} as any;
const canvas = { width: 800, height: 600 } as any;

const stubRenderer: CropRenderer = async ({ pxWidth, pxHeight }) => {
    return `data:image/png;base64,stub-${pxWidth}x${pxHeight}`;
};

function makeEngines() {
    const imageEngine = new ImageEditorEngine(camera, canvas);
    imageEngine.setImage('data:image/png;base64,orig', 8, 4, { x: 0, y: 0 });
    const cropEngine = new ImageCropEngine(imageEngine, stubRenderer);
    return { imageEngine, cropEngine };
}

describe('ImageCropEngine.beginCrop', () => {
    it('initializes the crop rect to the image bounds', () => {
        const { cropEngine } = makeEngines();
        cropEngine.beginCrop();
        const rect = cropEngine.getRect();
        expect(rect).toEqual({ x: -4, y: -2, width: 8, height: 4 });
    });

    it('does nothing when there is no image', () => {
        const imageEngine = new ImageEditorEngine(camera, canvas);
        const cropEngine = new ImageCropEngine(imageEngine, stubRenderer);
        cropEngine.beginCrop();
        expect(cropEngine.getRect()).toBeNull();
    });
});

describe('ImageCropEngine handle drag', () => {
    it('moves bottom-right inward when dragged toward image center', () => {
        const { cropEngine } = makeEngines();
        cropEngine.beginCrop();
        cropEngine.startResize('bottom-right');
        cropEngine.updateResize({ x: 2, y: 1 });
        const rect = cropEngine.getRect()!;
        expect(rect.x).toBe(-4);
        expect(rect.y).toBe(-2);
        expect(rect.width).toBeCloseTo(6, 6);
        expect(rect.height).toBeCloseTo(3, 6);
    });

    it('clamps to image bounds when dragging outside', () => {
        const { cropEngine } = makeEngines();
        cropEngine.beginCrop();
        cropEngine.startResize('top-left');
        cropEngine.updateResize({ x: -10, y: -10 }); // outside image
        const rect = cropEngine.getRect()!;
        expect(rect.x).toBe(-4); // clamped to image left
        expect(rect.y).toBe(-2); // clamped to image top
    });

    it('respects minimum size of 0.1 world units', () => {
        const { cropEngine } = makeEngines();
        cropEngine.beginCrop();
        cropEngine.startResize('bottom-right');
        cropEngine.updateResize({ x: -3.9999, y: -1.9999 }); // collapse toward top-left
        const rect = cropEngine.getRect()!;
        expect(rect.width).toBeGreaterThanOrEqual(0.1);
        expect(rect.height).toBeGreaterThanOrEqual(0.1);
    });
});

describe('ImageCropEngine.projectOnHandle', () => {
    it('returns the handle name when within the screen-space hit radius', () => {
        const { cropEngine } = makeEngines();
        cropEngine.beginCrop();
        // bottom-right corner of an 8×4 image at origin is (4, 2)
        expect(cropEngine.projectOnHandle({ x: 4, y: 2 })).toBe('bottom-right');
    });

    it('returns null far from any handle', () => {
        const { cropEngine } = makeEngines();
        cropEngine.beginCrop();
        expect(cropEngine.projectOnHandle({ x: 0, y: 0 })).toBeNull();
    });
});

describe('ImageCropEngine.commit', () => {
    it('replaces the image with cropped dimensions and centered position', async () => {
        const { imageEngine, cropEngine } = makeEngines();
        cropEngine.beginCrop();
        // Take the right half: x ∈ [0, 4], y ∈ [-2, 2]
        cropEngine.startResize('top-left');
        cropEngine.updateResize({ x: 0, y: -2 });
        cropEngine.endInteraction();

        const result = await cropEngine.commit({ pxWidth: 800, pxHeight: 400 });
        expect(result).toBe(true);

        const img = imageEngine.getImage()!;
        expect(img.width).toBeCloseTo(4, 6);
        expect(img.height).toBeCloseTo(4, 6);
        expect(img.position).toEqual({ x: 2, y: 0 });
        expect(img.src).toBe('data:image/png;base64,stub-400x400');
    });

    it('returns false and leaves the image untouched when there is no rect', async () => {
        const { imageEngine, cropEngine } = makeEngines();
        const before = imageEngine.getImage()!;
        const result = await cropEngine.commit({ pxWidth: 800, pxHeight: 400 });
        expect(result).toBe(false);
        expect(imageEngine.getImage()!.src).toBe(before.src);
    });
});

describe('ImageCropEngine.cancel', () => {
    it('discards the crop rect without touching the image', () => {
        const { imageEngine, cropEngine } = makeEngines();
        cropEngine.beginCrop();
        cropEngine.startResize('bottom-right');
        cropEngine.updateResize({ x: 1, y: 1 });
        cropEngine.cancel();
        expect(cropEngine.getRect()).toBeNull();
        expect(imageEngine.getImage()!.width).toBe(8);
    });
});
```

- [ ] **Step 2: Run tests and confirm they fail**

Run: `bun test test/image-crop-engine.test.ts`
Expected: file fails to import (`Cannot find module 'image-crop-engine'`).

- [ ] **Step 3: Implement `ImageCropEngine`**

Create `src/train-editor/image-crop-engine.ts`:

```ts
import {
    ObservableBoardCamera,
    Observer,
    SubscriptionOptions,
    SynchronousObservable,
} from '@ue-too/board';
import { Point, PointCal } from '@ue-too/math';

import type { ImageEditorEngine } from './image-editor-engine';

export type CropHandle =
    | 'top-left'
    | 'top-right'
    | 'bottom-left'
    | 'bottom-right';

export type CropRect = { x: number; y: number; width: number; height: number };

export type CropRenderArgs = {
    src: string;
    /** Source pixel rect inside the original bitmap. */
    sx: number;
    sy: number;
    sw: number;
    sh: number;
    /** Target pixel dimensions of the new image (== sw, sh rounded). */
    pxWidth: number;
    pxHeight: number;
};

/**
 * Re-encodes the source image to a new data URL. Swappable so tests can stub
 * the canvas / `toDataURL` boundary.
 */
export type CropRenderer = (args: CropRenderArgs) => Promise<string>;

/** Minimum crop size in world units. Matches the existing image resize floor. */
const MIN_CROP_SIZE = 0.1;
/** Screen-space hit radius for crop handles (pixels). */
const HANDLE_HIT_RADIUS_PX = 15;

export class ImageCropEngine {
    private _imageEngine: ImageEditorEngine;
    private _renderer: CropRenderer;
    private _camera: ObservableBoardCamera | null;
    private _rect: CropRect | null = null;
    private _selectedHandle: CropHandle | null = null;
    private _rectChangedObservable: SynchronousObservable<[CropRect | null]>;

    constructor(
        imageEngine: ImageEditorEngine,
        renderer: CropRenderer,
        camera?: ObservableBoardCamera
    ) {
        this._imageEngine = imageEngine;
        this._renderer = renderer;
        this._camera = camera ?? null;
        this._rectChangedObservable = new SynchronousObservable<
            [CropRect | null]
        >();
    }

    getRect(): CropRect | null {
        return this._rect;
    }

    onRectChanged(
        observer: Observer<[CropRect | null]>,
        options?: SubscriptionOptions
    ) {
        return this._rectChangedObservable.subscribe(observer, options);
    }

    /** Initialize the crop rect to the current image bounds. No-op without image. */
    beginCrop(): void {
        const img = this._imageEngine.getImage();
        if (!img) {
            this._rect = null;
            return;
        }
        this._rect = {
            x: img.position.x - img.width / 2,
            y: img.position.y - img.height / 2,
            width: img.width,
            height: img.height,
        };
        this._selectedHandle = null;
        this._rectChangedObservable.notify(this._rect);
    }

    /** Hit-test against handles. Uses screen-space radius if camera is supplied. */
    projectOnHandle(worldPos: Point): CropHandle | null {
        if (!this._rect) return null;
        const corners = this._cornersOfRect(this._rect);
        const radius = this._handleHitRadiusWorld();
        for (const [handle, corner] of Object.entries(corners) as [
            CropHandle,
            Point,
        ][]) {
            if (PointCal.distanceBetweenPoints(worldPos, corner) < radius) {
                return handle;
            }
        }
        return null;
    }

    startResize(handle: CropHandle): void {
        if (!this._rect) return;
        this._selectedHandle = handle;
    }

    updateResize(worldPos: Point): void {
        if (!this._rect || !this._selectedHandle) return;
        const img = this._imageEngine.getImage();
        if (!img) return;

        const imgLeft = img.position.x - img.width / 2;
        const imgTop = img.position.y - img.height / 2;
        const imgRight = img.position.x + img.width / 2;
        const imgBottom = img.position.y + img.height / 2;

        // Clamp pointer to image bounds
        const px = Math.max(imgLeft, Math.min(imgRight, worldPos.x));
        const py = Math.max(imgTop, Math.min(imgBottom, worldPos.y));

        let { x, y, width, height } = this._rect;
        const rectRight = x + width;
        const rectBottom = y + height;

        switch (this._selectedHandle) {
            case 'top-left': {
                const newX = Math.min(px, rectRight - MIN_CROP_SIZE);
                const newY = Math.min(py, rectBottom - MIN_CROP_SIZE);
                width = rectRight - newX;
                height = rectBottom - newY;
                x = newX;
                y = newY;
                break;
            }
            case 'top-right': {
                const newRight = Math.max(px, x + MIN_CROP_SIZE);
                const newY = Math.min(py, rectBottom - MIN_CROP_SIZE);
                width = newRight - x;
                height = rectBottom - newY;
                y = newY;
                break;
            }
            case 'bottom-left': {
                const newX = Math.min(px, rectRight - MIN_CROP_SIZE);
                const newBottom = Math.max(py, y + MIN_CROP_SIZE);
                width = rectRight - newX;
                height = newBottom - y;
                x = newX;
                break;
            }
            case 'bottom-right': {
                const newRight = Math.max(px, x + MIN_CROP_SIZE);
                const newBottom = Math.max(py, y + MIN_CROP_SIZE);
                width = newRight - x;
                height = newBottom - y;
                break;
            }
        }

        this._rect = { x, y, width, height };
        this._rectChangedObservable.notify(this._rect);
    }

    endInteraction(): void {
        this._selectedHandle = null;
    }

    /** Re-encode and replace the current image with the cropped region. */
    async commit(sourcePixelDims: {
        pxWidth: number;
        pxHeight: number;
    }): Promise<boolean> {
        const img = this._imageEngine.getImage();
        if (!img || !this._rect) return false;

        const { pxWidth, pxHeight } = sourcePixelDims;
        const scaleX = pxWidth / img.width;
        const scaleY = pxHeight / img.height;
        const imgLeft = img.position.x - img.width / 2;
        const imgTop = img.position.y - img.height / 2;

        const sx = Math.round((this._rect.x - imgLeft) * scaleX);
        const sy = Math.round((this._rect.y - imgTop) * scaleY);
        const sw = Math.round(this._rect.width * scaleX);
        const sh = Math.round(this._rect.height * scaleY);

        const newSrc = await this._renderer({
            src: img.src,
            sx,
            sy,
            sw,
            sh,
            pxWidth: sw,
            pxHeight: sh,
        });

        const newPos: Point = {
            x: this._rect.x + this._rect.width / 2,
            y: this._rect.y + this._rect.height / 2,
        };
        const newWidth = this._rect.width;
        const newHeight = this._rect.height;

        // Clear rect *before* calling setImage so any onImageChanged listener
        // (e.g. the auto-cancel-on-external-setImage hook in Task 9) sees a
        // null rect and does not try to cancel a crop that just committed.
        this._rect = null;
        this._selectedHandle = null;
        this._rectChangedObservable.notify(null);

        this._imageEngine.setImage(newSrc, newWidth, newHeight, newPos);
        return true;
    }

    cancel(): void {
        this._rect = null;
        this._selectedHandle = null;
        this._rectChangedObservable.notify(null);
    }

    setup(): void {}
    cleanup(): void {}

    /** Delegates to the wrapped image engine so the state machine does not
     * have to take a separate camera/canvas dependency. */
    convert2WorldPosition(pointInWindow: Point): Point {
        return this._imageEngine.convert2WorldPosition(pointInWindow);
    }

    private _cornersOfRect(rect: CropRect): Record<CropHandle, Point> {
        return {
            'top-left': { x: rect.x, y: rect.y },
            'top-right': { x: rect.x + rect.width, y: rect.y },
            'bottom-left': { x: rect.x, y: rect.y + rect.height },
            'bottom-right': {
                x: rect.x + rect.width,
                y: rect.y + rect.height,
            },
        };
    }

    private _handleHitRadiusWorld(): number {
        const zoom = this._camera ? this._camera.zoomLevel : 1;
        return HANDLE_HIT_RADIUS_PX / zoom;
    }
}

/** Default browser-side renderer using `<canvas>` + `toDataURL('image/png')`. */
export const createCanvasCropRenderer = (): CropRenderer => {
    return async ({ src, sx, sy, sw, sh }) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Failed to acquire 2D context');
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        return canvas.toDataURL('image/png');
    };
};
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `bun test test/image-crop-engine.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/train-editor/image-crop-engine.ts test/image-crop-engine.test.ts
git commit -m "feat(train-editor): add ImageCropEngine with stubbable renderer"
```

---

## Task 4: Create `ImageCropStateMachine`

**Files:**

- Create: `src/train-editor/image-crop-state-machine.ts`
- Test: `test/image-crop-state-machine.test.ts`

States: `INACTIVE`, `IDLE`, `RESIZING`. Mirrors `image-edit-state-machine.ts`.

- [ ] **Step 1: Write failing tests**

Create `test/image-crop-state-machine.test.ts`:

```ts
import { describe, expect, it, mock } from 'bun:test';

import {
    type ImageCropContext,
    createImageCropStateMachine,
} from '../src/train-editor/image-crop-state-machine';

function makeMockEngine() {
    return {
        beginCrop: mock(() => {}),
        projectOnHandle: mock((_p: any) => null as null | string),
        startResize: mock((_h: any) => {}),
        updateResize: mock((_p: any) => {}),
        endInteraction: mock(() => {}),
        commit: mock(async () => true),
        cancel: mock(() => {}),
        getRect: mock(() => null as any),
        // Identity conversion in tests — payloads are already "world".
        convert2WorldPosition: mock((p: any) => p),
    };
}

function makeContext(engine: ReturnType<typeof makeMockEngine>) {
    return {
        cropEngine: engine,
        setup: () => {},
        cleanup: () => {},
    } as unknown as ImageCropContext;
}

describe('ImageCropStateMachine', () => {
    it('starts in INACTIVE and moves to IDLE on startCrop', () => {
        const engine = makeMockEngine();
        const sm = createImageCropStateMachine(makeContext(engine));
        expect(sm.currentState).toBe('INACTIVE');
        sm.happens('startCrop', {});
        expect(sm.currentState).toBe('IDLE');
        expect(engine.beginCrop).toHaveBeenCalledTimes(1);
    });

    it('transitions IDLE → RESIZING when pointer hits a handle', () => {
        const engine = makeMockEngine();
        engine.projectOnHandle = mock(() => 'bottom-right' as any);
        const sm = createImageCropStateMachine(makeContext(engine));
        sm.happens('startCrop', {});
        sm.happens('leftPointerDown', { x: 1, y: 1 });
        expect(sm.currentState).toBe('RESIZING');
        expect(engine.startResize).toHaveBeenCalledWith('bottom-right');
    });

    it('stays in IDLE when pointer misses a handle', () => {
        const engine = makeMockEngine();
        engine.projectOnHandle = mock(() => null);
        const sm = createImageCropStateMachine(makeContext(engine));
        sm.happens('startCrop', {});
        sm.happens('leftPointerDown', { x: 0, y: 0 });
        expect(sm.currentState).toBe('IDLE');
    });

    it('returns to IDLE on leftPointerUp from RESIZING', () => {
        const engine = makeMockEngine();
        engine.projectOnHandle = mock(() => 'top-left' as any);
        const sm = createImageCropStateMachine(makeContext(engine));
        sm.happens('startCrop', {});
        sm.happens('leftPointerDown', { x: -1, y: -1 });
        sm.happens('leftPointerMove', { x: 0, y: 0 });
        sm.happens('leftPointerUp', { x: 0, y: 0 });
        expect(sm.currentState).toBe('IDLE');
        expect(engine.updateResize).toHaveBeenCalled();
        expect(engine.endInteraction).toHaveBeenCalledTimes(1);
    });

    it('commitCrop transitions to INACTIVE without calling engine.commit', () => {
        // The toolbar owns commit so it can pass source pixel dims; the state
        // machine only tracks UI state.
        const engine = makeMockEngine();
        const sm = createImageCropStateMachine(makeContext(engine));
        sm.happens('startCrop', {});
        sm.happens('commitCrop', {});
        expect(engine.commit).toHaveBeenCalledTimes(0);
        expect(sm.currentState).toBe('INACTIVE');
    });

    it('cancelCrop calls engine.cancel and returns to INACTIVE', () => {
        const engine = makeMockEngine();
        const sm = createImageCropStateMachine(makeContext(engine));
        sm.happens('startCrop', {});
        sm.happens('cancelCrop', {});
        expect(engine.cancel).toHaveBeenCalledTimes(1);
        expect(sm.currentState).toBe('INACTIVE');
    });

    it('endCrop from IDLE auto-cancels and goes INACTIVE', () => {
        const engine = makeMockEngine();
        const sm = createImageCropStateMachine(makeContext(engine));
        sm.happens('startCrop', {});
        sm.happens('endCrop', {});
        expect(engine.cancel).toHaveBeenCalledTimes(1);
        expect(sm.currentState).toBe('INACTIVE');
    });
});
```

- [ ] **Step 2: Run tests and confirm they fail**

Run: `bun test test/image-crop-state-machine.test.ts`
Expected: file fails to import (`Cannot find module 'image-crop-state-machine'`).

- [ ] **Step 3: Implement the state machine**

Create `src/train-editor/image-crop-state-machine.ts`:

```ts
import {
    BaseContext,
    EventGuards,
    EventReactions,
    Guard,
    NO_OP,
    StateMachine,
    TemplateState,
    TemplateStateMachine,
} from '@ue-too/being';
import { Point } from '@ue-too/math';

import type { ImageCropEngine } from './image-crop-engine';

export type ImageCropStates = 'INACTIVE' | 'IDLE' | 'RESIZING';

export type ImageCropEvents = {
    startCrop: {};
    endCrop: {};
    commitCrop: {};
    cancelCrop: {};
    leftPointerDown: Point;
    leftPointerUp: Point;
    leftPointerMove: Point;
    pointerMove: Point;
};

export type ImageCropContext = BaseContext & {
    cropEngine: ImageCropEngine;
};

export type ImageCropStateMachine = StateMachine<
    ImageCropEvents,
    ImageCropContext,
    ImageCropStates
>;

class CropInactiveState extends TemplateState<
    ImageCropEvents,
    ImageCropContext,
    ImageCropStates
> {
    protected _eventReactions = {
        startCrop: {
            action: (context: ImageCropContext) => {
                context.cropEngine.beginCrop();
            },
            defaultTargetState: 'IDLE' as const,
        },
    } as EventReactions<ImageCropEvents, ImageCropContext, ImageCropStates>;
}

class CropIdleState extends TemplateState<
    ImageCropEvents,
    ImageCropContext,
    ImageCropStates
> {
    private _lastPointerPos: Point = { x: 0, y: 0 };

    protected _eventReactions = {
        leftPointerDown: {
            action: this.leftPointerDown.bind(this),
        },
        commitCrop: {
            // Pure state transition; the toolbar awaits engine.commit before
            // firing this event so it can supply source pixel dims.
            action: NO_OP,
            defaultTargetState: 'INACTIVE' as const,
        },
        cancelCrop: {
            action: (context: ImageCropContext) => {
                context.cropEngine.cancel();
            },
            defaultTargetState: 'INACTIVE' as const,
        },
        endCrop: {
            action: (context: ImageCropContext) => {
                context.cropEngine.cancel();
            },
            defaultTargetState: 'INACTIVE' as const,
        },
    } as EventReactions<ImageCropEvents, ImageCropContext, ImageCropStates>;

    protected _guards: Guard<ImageCropContext, 'hitHandle'> = {
        hitHandle: ((context: ImageCropContext) => {
            const worldPos = context.cropEngine.convert2WorldPosition(
                this._lastPointerPos
            );
            return context.cropEngine.projectOnHandle(worldPos) !== null;
        }).bind(this),
    };

    protected _eventGuards: Partial<
        EventGuards<
            ImageCropEvents,
            ImageCropStates,
            ImageCropContext,
            typeof this._guards
        >
    > = {
        leftPointerDown: [
            {
                guard: 'hitHandle',
                target: 'RESIZING',
            },
        ],
    };

    leftPointerDown(context: ImageCropContext, payload: Point): void {
        this._lastPointerPos = payload;
        const worldPos = context.cropEngine.convert2WorldPosition(payload);
        const handle = context.cropEngine.projectOnHandle(worldPos);
        if (handle) {
            context.cropEngine.startResize(handle);
        }
    }
}

class CropResizingState extends TemplateState<
    ImageCropEvents,
    ImageCropContext,
    ImageCropStates
> {
    protected _eventReactions = {
        leftPointerMove: {
            action: this.onPointerMove.bind(this),
        },
        pointerMove: {
            action: this.onPointerMove.bind(this),
        },
        leftPointerUp: {
            action: this.leftPointerUp.bind(this),
            defaultTargetState: 'IDLE' as const,
        },
    } as EventReactions<ImageCropEvents, ImageCropContext, ImageCropStates>;

    onPointerMove(context: ImageCropContext, payload: Point): void {
        const worldPos = context.cropEngine.convert2WorldPosition(payload);
        context.cropEngine.updateResize(worldPos);
    }

    leftPointerUp(context: ImageCropContext): void {
        context.cropEngine.endInteraction();
    }
}

export const createImageCropStateMachine = (
    context: ImageCropContext
): ImageCropStateMachine => {
    return new TemplateStateMachine<
        ImageCropEvents,
        ImageCropContext,
        ImageCropStates
    >(
        {
            INACTIVE: new CropInactiveState(),
            IDLE: new CropIdleState(),
            RESIZING: new CropResizingState(),
        },
        'INACTIVE',
        context
    );
};
```

Note: pointer payloads arrive in **window coordinates** from the KMT extension (matching the existing `image-edit-state-machine.ts` contract). Each action converts via `cropEngine.convert2WorldPosition(payload)` (delegating to the wrapped `ImageEditorEngine`) before calling engine ops that expect world space.

- [ ] **Step 4: Run tests and confirm they pass**

Run: `bun test test/image-crop-state-machine.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/train-editor/image-crop-state-machine.ts test/image-crop-state-machine.test.ts
git commit -m "feat(train-editor): add image crop state machine"
```

---

## Task 5: Wire `EDIT_IMAGE_CROP` state into the tool switcher

**Files:**

- Modify: `src/train-editor/train-editor-tool-switcher.ts`

The tool switcher gets a new state and event so the kmt extension can route pointer input to the crop state machine.

- [ ] **Step 1: Update the state list, event type, and context plumbing**

In `src/train-editor/train-editor-tool-switcher.ts`:

Add the new state to the tuple at the top:

```ts
export const TRAIN_EDITOR_TOOL_STATES = [
    'IDLE',
    'EDIT_BOGIE',
    'ADD_BOGIE',
    'EDIT_IMAGE',
    'EDIT_IMAGE_CROP',
] as const;
```

Add the import for the crop state machine:

```ts
import type { ImageCropStateMachine } from './image-crop-state-machine';
```

Add the event:

```ts
export type TrainEditorToolEvents = {
    switchToEditBogie: {};
    switchToAddBogie: {};
    switchToEditImage: {};
    switchToCropImage: {};
    switchToIdle: {};
};
```

Add `switchToCropImage` reactions to **every existing tool state** (mirroring how `switchToEditImage` is handled). For each of `ToolIdleState`, `ToolEditBogieState`, `ToolAddBogieState`, `ToolEditImageState`, add to the `_eventReactions` block:

```ts
        switchToCropImage: {
            action: NO_OP,
            defaultTargetState: 'EDIT_IMAGE_CROP',
        },
```

Add the new state class after `ToolEditImageState`:

```ts
class ToolCropImageState extends TemplateState<
    TrainEditorToolEvents,
    TrainEditorToolContext,
    TrainEditorToolStates
> {
    private _imageCropStateMachine: ImageCropStateMachine;

    constructor(imageCropStateMachine: ImageCropStateMachine) {
        super();
        this._imageCropStateMachine = imageCropStateMachine;
    }

    uponEnter(): void {
        this._imageCropStateMachine.happens('startCrop', {});
    }

    beforeExit(): void {
        this._imageCropStateMachine.happens('endCrop', {});
    }

    protected _defer: Defer<
        TrainEditorToolContext,
        TrainEditorToolEvents,
        TrainEditorToolStates
    > = {
        action: (_context, event, eventKey) => {
            const result = this._imageCropStateMachine.happens(
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
        switchToEditImage: {
            action: NO_OP,
            defaultTargetState: 'EDIT_IMAGE',
        },
        switchToCropImage: {
            action: NO_OP,
        },
        switchToIdle: {
            action: NO_OP,
            defaultTargetState: 'IDLE',
        },
    };
}
```

Update the factory signature and registration:

```ts
export const createTrainEditorToolSwitcher = (
    bogieEditStateMachine: BogieEditStateMachine,
    bogieAddStateMachine: BogieAddStateMachine,
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
            EDIT_IMAGE: new ToolEditImageState(imageEditStateMachine),
            EDIT_IMAGE_CROP: new ToolCropImageState(imageCropStateMachine),
        },
        'IDLE',
        { setup: () => {}, cleanup: () => {} }
    );
};
```

- [ ] **Step 2: Verify type-check and existing tests still pass**

Run: `bun test`
Expected: all tests pass (no test imports the tool switcher directly, and `image-crop-state-machine.test.ts` does not depend on the switcher).

If the project has a type-check script, run it. Otherwise rely on Vite/build later.

- [ ] **Step 3: Commit**

```bash
git add src/train-editor/train-editor-tool-switcher.ts
git commit -m "feat(train-editor): add EDIT_IMAGE_CROP tool state"
```

---

## Task 6: Render crop overlay in `ImageRenderSystem`

**Files:**

- Modify: `src/train-editor/image-render-system.ts`

Add a `showCropRect` toggle and a setter for the crop engine; subscribe to its rect observable; draw a dim overlay outside the rect, the rect border, and four orange corner handles.

- [ ] **Step 1: Add crop-engine wiring and rendering**

In `src/train-editor/image-render-system.ts`:

Add an import for the crop engine type:

```ts
import type { CropRect, ImageCropEngine } from './image-crop-engine';
```

Add new fields below the existing `_handles`/`_border` fields:

```ts
    private _cropOverlay: Graphics;
    private _cropBorder: Graphics;
    private _cropHandles: Graphics;
    private _showCropRect = false;
    private _cropEngine: ImageCropEngine | null = null;
    private _cropRect: CropRect | null = null;
    private _cropUnsubscribe: (() => void) | null = null;
```

In the constructor, after `this._container.addChild(this._handles);`:

```ts
this._cropOverlay = new Graphics();
this._cropBorder = new Graphics();
this._cropHandles = new Graphics();
this._container.addChild(this._cropOverlay);
this._container.addChild(this._cropBorder);
this._container.addChild(this._cropHandles);
```

Add a public method to attach the crop engine (called once at app init):

```ts
    attachCropEngine(engine: ImageCropEngine): void {
        if (this._cropUnsubscribe) {
            this._cropUnsubscribe();
        }
        this._cropEngine = engine;
        this._cropUnsubscribe = engine.onRectChanged((rect: CropRect | null) => {
            this._cropRect = rect;
            this._redrawCrop();
        });
    }
```

Add a `showCropRect` setter:

```ts
    set showCropRect(value: boolean) {
        this._showCropRect = value;
        if (value && this._cropEngine) {
            this._cropRect = this._cropEngine.getRect();
        }
        this._redrawCrop();
    }
```

Update the existing `set showHandles(...)` so edit and crop visuals never coexist: when `showHandles = true`, also clear/hide crop visuals (no behavior change needed if both flags are managed by the toolbar, but defense in depth):

```ts
    set showHandles(value: boolean) {
        this._showHandles = value;
        this._handles.visible = value;
        this._border.visible = value;
        const currentImage = this._engine.getImage();
        if (currentImage && value) {
            this._drawHandlesAndBorder(currentImage);
        }
    }
```

(No change required if flags are mutually exclusive at the call site; leave `set showHandles` as-is.)

In the existing `_camera.on('zoom', ...)` callback, also redraw crop visuals when zoom changes:

```ts
this._camera.on(
    'zoom',
    (_event: CameraZoomEventPayload, state: CameraState) => {
        this._zoomLevel = state.zoomLevel;
        const currentImage = this._engine.getImage();
        if (currentImage && this._showHandles) {
            this._drawHandlesAndBorder(currentImage);
        }
        if (this._showCropRect) {
            this._redrawCrop();
        }
    },
    { signal: this._abortController.signal }
);
```

Add the `_redrawCrop` method below `_drawHandlesAndBorder`:

```ts
    private _redrawCrop(): void {
        const image = this._engine.getImage();
        this._cropOverlay.clear();
        this._cropBorder.clear();
        this._cropHandles.clear();

        if (!this._showCropRect || !this._cropRect || !image) return;

        const handleRadius = HANDLE_VISUAL_RADIUS_PX / this._zoomLevel;
        const borderWidth = BORDER_WIDTH_PX / this._zoomLevel;
        const cropColor = 0xff8800;

        // Dim mask around the crop rect (drawn with even-odd fill: image bounds rect, then crop rect cut-out via separate dim rectangles).
        const imgL = image.position.x - image.width / 2;
        const imgT = image.position.y - image.height / 2;
        const imgR = image.position.x + image.width / 2;
        const imgB = image.position.y + image.height / 2;
        const r = this._cropRect;

        // Top strip
        this._cropOverlay.rect(imgL, imgT, image.width, r.y - imgT);
        // Bottom strip
        this._cropOverlay.rect(
            imgL,
            r.y + r.height,
            image.width,
            imgB - (r.y + r.height)
        );
        // Left strip
        this._cropOverlay.rect(imgL, r.y, r.x - imgL, r.height);
        // Right strip
        this._cropOverlay.rect(
            r.x + r.width,
            r.y,
            imgR - (r.x + r.width),
            r.height
        );
        this._cropOverlay.fill({ color: 0x000000, alpha: 0.45 });

        // Crop border
        this._cropBorder.rect(r.x, r.y, r.width, r.height);
        this._cropBorder.stroke({ color: cropColor, width: borderWidth });

        // Corner handles
        const corners = [
            { x: r.x, y: r.y },
            { x: r.x + r.width, y: r.y },
            { x: r.x, y: r.y + r.height },
            { x: r.x + r.width, y: r.y + r.height },
        ];
        for (const c of corners) {
            this._cropHandles.circle(c.x, c.y, handleRadius);
            this._cropHandles.fill({ color: cropColor });
            this._cropHandles.stroke({ color: 0xffffff, pixelLine: true });
        }
    }
```

In `cleanup()`, also tear down the crop subscription:

```ts
    cleanup(): void {
        if (this._unsubscribe) {
            this._unsubscribe();
            this._unsubscribe = null;
        }
        if (this._cropUnsubscribe) {
            this._cropUnsubscribe();
            this._cropUnsubscribe = null;
        }
        this._abortController.abort();
        this._abortController = new AbortController();
        if (this._sprite) {
            this._container.removeChild(this._sprite);
            this._sprite.destroy();
            this._sprite = null;
        }
    }
```

- [ ] **Step 2: Type-check by running tests**

Run: `bun test`
Expected: all tests still pass; no test directly exercises the render system, so this is a compile/import sanity check via the build below.

- [ ] **Step 3: Run the build**

Run: `bun run build`
Expected: success, no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/train-editor/image-render-system.ts
git commit -m "feat(train-editor): render crop overlay and handles"
```

---

## Task 7: Wire `ImageCropEngine` and state machine into the page

**Files:**

- Modify: `src/train-editor/types.ts`
- Modify: `src/train-editor/index.ts`
- Modify: `src/pages/train-editor.tsx`

- [ ] **Step 1: Add the new component to the editor type**

In `src/train-editor/types.ts`:

```ts
import type { BaseAppComponents } from '@ue-too/board-pixi-integration';

import type { BogieEditorEngine } from './bogie-editor-engine';
import type { BogieEditorRenderSystem } from './bogie-editor-render-system';
import type { ImageCropEngine } from './image-crop-engine';
import type { ImageCropStateMachine } from './image-crop-state-machine';
import type { ImageEditorEngine } from './image-editor-engine';
import type { ImageRenderSystem } from './image-render-system';
import type { TrainEditorKmtStateMachine } from './train-editor-kmt-extension';

export type TrainEditorComponents = BaseAppComponents & {
    bogieEditorEngine: BogieEditorEngine;
    bogieEditorRenderSystem: BogieEditorRenderSystem;
    imageEditorEngine: ImageEditorEngine;
    imageRenderSystem: ImageRenderSystem;
    imageCropEngine: ImageCropEngine;
    imageCropStateMachine: ImageCropStateMachine;
    trainEditorKmtStateMachine: TrainEditorKmtStateMachine;
};
```

- [ ] **Step 2: Re-export new symbols from the barrel**

In `src/train-editor/index.ts`, append:

```ts
export { ImageCropEngine, createCanvasCropRenderer } from './image-crop-engine';
export type { CropRenderer, CropHandle, CropRect } from './image-crop-engine';
export { createImageCropStateMachine } from './image-crop-state-machine';
export type { ImageCropStateMachine } from './image-crop-state-machine';
```

- [ ] **Step 3: Instantiate the engine + state machine in `train-editor.tsx`**

In `src/pages/train-editor.tsx`, update the imports:

```ts
import { createBogieAddStateMachine } from '@/train-editor/bogie-add-state-machine';
import { BogieEditorEngine } from '@/train-editor/bogie-editor-engine';
import { BogieEditorRenderSystem } from '@/train-editor/bogie-editor-render-system';
import { createBogieEditStateMachine } from '@/train-editor/bogie-kmt-state-machine';
import {
    ImageCropEngine,
    createCanvasCropRenderer,
} from '@/train-editor/image-crop-engine';
import { createImageCropStateMachine } from '@/train-editor/image-crop-state-machine';
import { createImageEditStateMachine } from '@/train-editor/image-edit-state-machine';
import { ImageEditorEngine } from '@/train-editor/image-editor-engine';
import { ImageRenderSystem } from '@/train-editor/image-render-system';
import { createTrainEditorKmtExtension } from '@/train-editor/train-editor-kmt-extension';
import { createTrainEditorToolSwitcher } from '@/train-editor/train-editor-tool-switcher';
import { TrainEditorToolbar } from '@/train-editor/train-editor-toolbar';
import type { TrainEditorComponents } from '@/train-editor/types';
```

Inside `initTrainEditor`, after the `imageRenderSystem` line (`new ImageRenderSystem(...)`):

```ts
// Crop engine + state machine
const imageCropEngine = new ImageCropEngine(
    imageEditorEngine,
    createCanvasCropRenderer(),
    components.camera
);
imageRenderSystem.attachCropEngine(imageCropEngine);

const imageCropStateMachine = createImageCropStateMachine({
    cropEngine: imageCropEngine,
    setup: () => {},
    cleanup: () => {},
});
```

Update the tool-switcher call to pass the new state machine:

```ts
const toolSwitcher = createTrainEditorToolSwitcher(
    bogieEditStateMachine,
    bogieAddStateMachine,
    imageEditStateMachine,
    imageCropStateMachine
);
```

In the returned components object, add:

```ts
    return {
        ...components,
        bogieEditorEngine,
        bogieEditorRenderSystem,
        imageEditorEngine,
        imageRenderSystem,
        imageCropEngine,
        imageCropStateMachine,
        trainEditorKmtStateMachine,
    };
```

- [ ] **Step 4: Run the build**

Run: `bun run build`
Expected: success.

- [ ] **Step 5: Run all tests**

Run: `bun test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/train-editor/types.ts src/train-editor/index.ts src/pages/train-editor.tsx
git commit -m "feat(train-editor): wire ImageCropEngine into the page init"
```

---

## Task 8: Toolbar UI — Crop button, confirm/cancel, width coupling, import scaling

**Files:**

- Modify: `src/train-editor/train-editor-toolbar.tsx`

This is the largest change. Subtasks: (a) add the new mode + buttons, (b) add the image→width subscription, (c) rewrite import scaling, (d) wire width input to rescale image, (e) keyboard shortcuts, (f) keep `sourcePixelDims` in sync with current image.

- [ ] **Step 1: Update imports and the mode union**

At the top of `src/train-editor/train-editor-toolbar.tsx`, add `Crop`, `Check`, `X` to the icon imports (Check and X are already exported):

```ts
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
    Upload,
    X,
} from '@/assets/icons';
```

Add `useEffect, useRef` to the React imports:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
```

Update the mode union near line 46:

```ts
type TrainEditorMode =
    | 'idle'
    | 'edit-bogie'
    | 'add-bogie'
    | 'edit-image'
    | 'crop-image';
```

- [ ] **Step 2: Replace the `uploadImage` helper and import handler**

The new contract: pass through raw pixel dims so the caller decides world scale.

Replace the `uploadImage` function (around lines 106–130) with:

```ts
function uploadImage(
    onLoad: (src: string, pxWidth: number, pxHeight: number) => void
): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = reader.result as string;
            const img = new window.Image();
            img.onload = () => {
                onLoad(dataUrl, img.width, img.height);
            };
            img.src = dataUrl;
        };
        reader.readAsDataURL(file);
    });
    input.click();
}
```

Replace the `handleImportImage` callback (around lines 190–200):

```ts
const handleImportImage = useCallback(() => {
    if (!app) return;
    uploadImage((src, pxW, pxH) => {
        // Image's world height is set to the current car body width;
        // image world width derives from aspect ratio.
        const aspect = pxW / pxH;
        const worldH = carWidth;
        const worldW = worldH * aspect;
        app.imageEditorEngine.setImage(src, worldW, worldH);
        // Auto-switch to image edit mode
        exitAllModes();
        app.trainEditorKmtStateMachine.happens('switchToEditImage');
        app.imageRenderSystem.showHandles = true;
        setMode('edit-image');
    });
}, [app, carWidth, exitAllModes]);
```

- [ ] **Step 3: Track source pixel dims and add the image→width coupling**

Add a ref for source pixel dims so we can keep the crop state machine's context up to date:

Inside the component body, after the existing `useState` calls and before `exitAllModes`:

```ts
const sourcePixelDimsRef = useRef<{ pxWidth: number; pxHeight: number }>({
    pxWidth: 0,
    pxHeight: 0,
});

// Subscribe to image changes:
//   - couple image height → car body width when an image is present
//   - keep source pixel dims fresh for crop commit (read by handleConfirmCrop)
useEffect(() => {
    if (!app) return;
    const unsub = app.imageEditorEngine.onImageChanged(image => {
        if (!image) return;
        // Couple height → car width
        if (image.height !== carWidth) {
            setCarWidth(image.height);
            app.bogieEditorEngine.setWidth(image.height);
        }
        // Refresh source pixel dims so the next commit uses the correct
        // bitmap size. Decoding a data URL is cheap and runs off the hot path.
        const probe = new window.Image();
        probe.onload = () => {
            sourcePixelDimsRef.current = {
                pxWidth: probe.width,
                pxHeight: probe.height,
            };
        };
        probe.src = image.src;
    });
    return unsub;
}, [app, carWidth]);
```

- [ ] **Step 4: Update the width input to rescale the image**

Replace the `onChange` of the width input (around lines 429–435):

```ts
                            onChange={e => {
                                const v = parseFloat(e.target.value);
                                if (Number.isFinite(v) && v > 0) {
                                    setCarWidth(v);
                                    app?.bogieEditorEngine.setWidth(v);
                                    app?.imageEditorEngine.rescaleToWidth(v);
                                }
                            }}
```

(The subscription effect will also fire on rescale, but `setWidth` and `setCarWidth` are idempotent when value is unchanged.)

Also disable the width input while in crop mode — add `disabled={mode === 'crop-image'}` to the `<input>`.

- [ ] **Step 5: Add the Crop tool handler and confirm/cancel handlers**

Below `handleEditImageToggle`:

```ts
const handleCropImageToggle = useCallback(() => {
    if (!app) return;
    if (mode === 'crop-image') {
        app.trainEditorKmtStateMachine.happens('switchToIdle');
        app.imageRenderSystem.showCropRect = false;
        setMode('idle');
    } else {
        exitAllModes();
        app.trainEditorKmtStateMachine.happens('switchToCropImage');
        app.imageRenderSystem.showHandles = false;
        app.imageRenderSystem.showCropRect = true;
        setMode('crop-image');
    }
}, [app, mode, exitAllModes]);

const handleConfirmCrop = useCallback(async () => {
    if (!app) return;
    // Toolbar owns commit so it can pass the source bitmap pixel dims
    // captured by the onImageChanged subscription above.
    await app.imageCropEngine.commit(sourcePixelDimsRef.current);
    app.imageCropStateMachine.happens('commitCrop', {});
    app.trainEditorKmtStateMachine.happens('switchToIdle');
    app.imageRenderSystem.showCropRect = false;
    setMode('idle');
}, [app]);

const handleCancelCrop = useCallback(() => {
    if (!app) return;
    app.imageCropStateMachine.happens('cancelCrop', {});
    app.trainEditorKmtStateMachine.happens('switchToIdle');
    app.imageRenderSystem.showCropRect = false;
    setMode('idle');
}, [app]);
```

Update `exitAllModes` so leaving any mode also clears the crop overlay (defensive):

```ts
const exitAllModes = useCallback(() => {
    if (!app) return;
    app.trainEditorKmtStateMachine.happens('switchToIdle');
    app.imageRenderSystem.showHandles = false;
    app.imageRenderSystem.showCropRect = false;
    setMode('idle');
}, [app]);
```

- [ ] **Step 6: Add keyboard shortcuts (Enter = confirm, Escape = cancel)**

Inside the component body, after the existing effects:

```ts
useEffect(() => {
    if (mode !== 'crop-image') return;
    const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleConfirmCrop();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            handleCancelCrop();
        }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
}, [mode, handleConfirmCrop, handleCancelCrop]);
```

- [ ] **Step 7: Add the Crop button + Confirm/Cancel buttons to the toolbar JSX**

In the toolbar JSX (inside the bg-background panel), after the "Edit image" `ToolbarButton`, add:

```tsx
{
    /* Crop image */
}
<ToolbarButton
    tooltip={mode === 'crop-image' ? t('endCrop') : t('cropImage')}
    active={mode === 'crop-image'}
    disabled={!hasImage && mode !== 'crop-image'}
    onClick={handleCropImageToggle}
>
    <Crop />
</ToolbarButton>;

{
    mode === 'crop-image' && (
        <>
            <ToolbarButton
                tooltip={t('confirmCrop')}
                onClick={handleConfirmCrop}
            >
                <Check />
            </ToolbarButton>
            <ToolbarButton tooltip={t('cancelCrop')} onClick={handleCancelCrop}>
                <X />
            </ToolbarButton>
        </>
    );
}
```

Disable the Edit-image button while in crop mode by changing its `disabled` prop:

```tsx
<ToolbarButton
    tooltip={mode === 'edit-image' ? t('endImageEdit') : t('editImage')}
    active={mode === 'edit-image'}
    disabled={(!hasImage && mode !== 'edit-image') || mode === 'crop-image'}
    onClick={handleEditImageToggle}
>
    <GripHorizontal />
</ToolbarButton>
```

- [ ] **Step 8: Run formatter and build**

Run: `bun run format && bun run build`
Expected: clean format, successful build.

- [ ] **Step 9: Run all tests**

Run: `bun test`
Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/train-editor/train-editor-toolbar.tsx
git commit -m "feat(train-editor): add crop tool button and width-image coupling"
```

---

## Task 9: Auto-cancel crop on external `setImage`

**Files:**

- Modify: `src/pages/train-editor.tsx`

If the user re-imports an image (or hydrates a saved car definition) while in crop mode, the crop rect is stale. Wire a one-line subscription that cancels the crop on every image change.

- [ ] **Step 1: Subscribe to image changes in init**

In `src/pages/train-editor.tsx`, after `imageRenderSystem.attachCropEngine(imageCropEngine);`:

```ts
// If the image is replaced (re-import / hydrate), abandon any in-progress crop.
const cropAutoCancelUnsub = imageEditorEngine.onImageChanged(() => {
    if (imageCropEngine.getRect() !== null) {
        // Cancel without recursing through setImage (engine.cancel only
        // touches its own rect state).
        imageCropEngine.cancel();
    }
});
```

In the existing `cleanups.push(...)` block, add the unsubscribe call at the top of the callback:

```ts
components.cleanups.push(() => {
    cropAutoCancelUnsub();
    // ... existing cleanup
    bogieEditorRenderSystem.cleanup();
    components.app.stage.removeChild(bogieEditorRenderSystem.container);
    bogieEditorRenderSystem.container.destroy({ children: true });

    imageRenderSystem.cleanup();
    components.app.stage.removeChild(imageRenderSystem.container);
    imageRenderSystem.container.destroy({ children: true });
});
```

Note: `imageCropEngine.cancel()` runs synchronously inside the `onImageChanged` callback, which itself runs synchronously when `setImage` is called. The `setImage` that triggered this callback has already updated the image, so cancelling here only resets `_rect` and notifies the render system — no re-entrancy risk. **Commit** also calls `setImage`, but Task 3's `commit()` clears `_rect = null` _before_ calling `setImage`, so this auto-cancel hook sees a null rect and is a no-op for committed crops.

- [ ] **Step 2: Run all tests**

Run: `bun test`
Expected: all tests pass.

- [ ] **Step 3: Build**

Run: `bun run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/pages/train-editor.tsx
git commit -m "feat(train-editor): auto-cancel crop on external setImage"
```

---

## Task 10: Manual verification

This task is non-code; it documents the in-browser checks before declaring the feature done.

- [ ] **Step 1: Start the dev server**

Run: `bun run dev`
Open the train editor page in the browser.

- [ ] **Step 2: Verify import sets width**

Set car width to `3.0` in the toolbar. Import an image (any aspect ratio). Confirm:

- The image is rendered with world-space height ≈ 3.0 (visually matches the bogie body width if visible).
- Width input still reads `3.0`.

- [ ] **Step 3: Verify drag-resize couples width**

Enter Edit Image mode. Drag a corner handle outward. Confirm:

- Width input value updates live.
- The bogie editor's body width visual updates live.

- [ ] **Step 4: Verify width-input rescales image**

In Edit Image mode (or idle), type `1.5` into the width input. Confirm:

- Image visibly shrinks so its world height is `1.5`.
- Image position is unchanged.
- Aspect ratio is preserved.

- [ ] **Step 5: Verify crop**

Click the Crop button. Confirm:

- Image edit handles disappear; orange crop handles appear at the four corners.
- Outside the crop rect is dimmed.
- Drag a corner inward, confirm the rect updates and the dim region grows.
- Click Confirm (or press Enter). Confirm the image is replaced with just the cropped pixels, the crop rect disappears, and the width input now reflects the new image height.
- Repeat with Cancel (or Escape) — crop is discarded, image untouched.

- [ ] **Step 6: Verify crop auto-cancels on re-import**

Enter crop mode → drag handles in → without confirming, click Import Image and pick a new image. Confirm crop mode exits cleanly and the new image is shown without the orange handles.

- [ ] **Step 7: Verify save → load round-trip**

Save the current car to the library, then reload from the library. Confirm:

- Image renders at the saved size and position.
- Width input reads the saved width.
- Crop still works on the reloaded image.

- [ ] **Step 8: Smoke-test other tools**

Switch to Edit Bogies, Add Bogie, and Edit Image — confirm each still works and that switching to any of them while in crop mode auto-cancels the crop.

- [ ] **Step 9: Final commit (optional, only if you tweaked anything during verification)**

If verification surfaced small fixes, commit them under a focused message. If everything was clean, no commit needed.

---

## Summary

After all tasks, the car maker has:

- A new Crop tool that destructively re-encodes the image to a tight cutout.
- Bidirectional binding between car body width and the image's world-space height — typing the width rescales the image; resizing or cropping the image updates the width — so the two never drift.
- No data-format changes; saved cars and exported JSON keep working unchanged.
