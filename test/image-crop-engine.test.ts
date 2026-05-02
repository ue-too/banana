import { describe, expect, it } from 'bun:test';

import {
    type CropRenderer,
    ImageCropEngine,
} from '../src/train-editor/image-crop-engine';
import { ImageEditorEngine } from '../src/train-editor/image-editor-engine';

// zoomLevel: 100 keeps the screen-space handle hit radius (15 px) small in
// world units (0.15) so a center hit-test correctly returns null on an 8×4 image.
const camera = {
    zoomLevel: 100,
    position: { x: 0, y: 0 },
    rotation: 0,
    on: () => {},
} as any;
const canvas = { width: 800, height: 600 } as any;

const stubRenderer: CropRenderer = async ({ sx, sy, sw, sh }) => {
    return `data:image/png;base64,stub-sx${sx}-sy${sy}-${sw}x${sh}`;
};

function makeEngines() {
    const imageEngine = new ImageEditorEngine(camera, canvas);
    imageEngine.setImage('data:image/png;base64,orig', 8, 4, { x: 0, y: 0 });
    const cropEngine = new ImageCropEngine(imageEngine, stubRenderer, camera);
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
        const cropEngine = new ImageCropEngine(
            imageEngine,
            stubRenderer,
            camera
        );
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
        // Center of image — at zoomLevel 100, hit radius is 0.15, so this misses.
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
        expect(img.src).toBe('data:image/png;base64,stub-sx400-sy0-400x400');
    });

    it('computes pixel rect correctly when the image is at a non-origin position', async () => {
        const imageEngine = new ImageEditorEngine(camera, canvas);
        imageEngine.setImage('data:image/png;base64,orig', 8, 4, {
            x: 10,
            y: 5,
        });
        const cropEngine = new ImageCropEngine(
            imageEngine,
            stubRenderer,
            camera
        );
        cropEngine.beginCrop();
        // Image bounds: x ∈ [6, 14], y ∈ [3, 7]. Take the right half: x ∈ [10, 14], y ∈ [3, 7].
        cropEngine.startResize('top-left');
        cropEngine.updateResize({ x: 10, y: 3 });
        cropEngine.endInteraction();

        const result = await cropEngine.commit({ pxWidth: 800, pxHeight: 400 });
        expect(result).toBe(true);

        const img = imageEngine.getImage()!;
        expect(img.width).toBeCloseTo(4, 6);
        expect(img.height).toBeCloseTo(4, 6);
        expect(img.position).toEqual({ x: 12, y: 5 });
        expect(img.src).toBe('data:image/png;base64,stub-sx400-sy0-400x400');
    });

    it('returns false and leaves the image untouched when there is no rect', async () => {
        const { imageEngine, cropEngine } = makeEngines();
        const before = imageEngine.getImage()!;
        const result = await cropEngine.commit({ pxWidth: 800, pxHeight: 400 });
        expect(result).toBe(false);
        expect(imageEngine.getImage()!.src).toBe(before.src);
    });

    it('returns false and leaves the image untouched when source pixel dims are zero', async () => {
        const { imageEngine, cropEngine } = makeEngines();
        cropEngine.beginCrop();
        const before = imageEngine.getImage()!.src;
        const result = await cropEngine.commit({ pxWidth: 0, pxHeight: 0 });
        expect(result).toBe(false);
        expect(imageEngine.getImage()!.src).toBe(before);
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
