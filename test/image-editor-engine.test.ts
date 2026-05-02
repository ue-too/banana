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
