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
        if (sourcePixelDims.pxWidth <= 0 || sourcePixelDims.pxHeight <= 0) {
            return false;
        }

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
