import type {
    CameraState,
    CameraZoomEventPayload,
    ObservableBoardCamera,
} from '@ue-too/board';
import { Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';

import type { CropRect, ImageCropEngine } from './image-crop-engine';
import type { EditorImage, ImageEditorEngine } from './image-editor-engine';

/** Screen-space radius for visual handle circles (pixels). */
const HANDLE_VISUAL_RADIUS_PX = 5;
const HANDLE_COLOR = 0x3498db;
/** Screen-space border stroke width (pixels). */
const BORDER_WIDTH_PX = 1.5;

/**
 * Renders the editor image and resize handles into a Pixi container.
 * Subscribes to ImageEditorEngine for updates.
 */
export class ImageRenderSystem {
    private _container: Container;
    private _engine: ImageEditorEngine;
    private _camera: ObservableBoardCamera;
    private _sprite: Sprite | null = null;
    private _handles: Graphics;
    private _border: Graphics;
    private _cropOverlay: Graphics;
    private _cropBorder: Graphics;
    private _cropHandles: Graphics;
    private _showCropRect = false;
    private _cropEngine: ImageCropEngine | null = null;
    private _cropRect: CropRect | null = null;
    private _cropUnsubscribe: (() => void) | null = null;
    private _unsubscribe: (() => void) | null = null;
    private _abortController: AbortController = new AbortController();
    private _showHandles = false;
    private _zoomLevel = 1;

    constructor(engine: ImageEditorEngine, camera: ObservableBoardCamera) {
        this._container = new Container();
        this._engine = engine;
        this._camera = camera;
        this._zoomLevel = camera.zoomLevel;
        this._handles = new Graphics();
        this._border = new Graphics();
        this._container.addChild(this._border);
        this._container.addChild(this._handles);
        this._cropOverlay = new Graphics();
        this._cropBorder = new Graphics();
        this._cropHandles = new Graphics();
        this._container.addChild(this._cropOverlay);
        this._container.addChild(this._cropBorder);
        this._container.addChild(this._cropHandles);
    }

    get container(): Container {
        return this._container;
    }

    set showHandles(value: boolean) {
        this._showHandles = value;
        this._handles.visible = value;
        this._border.visible = value;
        // Redraw handles at current zoom
        const currentImage = this._engine.getImage();
        if (currentImage && value) {
            this._drawHandlesAndBorder(currentImage);
        }
    }

    attachCropEngine(engine: ImageCropEngine): void {
        if (this._cropUnsubscribe) {
            this._cropUnsubscribe();
        }
        this._cropEngine = engine;
        this._cropUnsubscribe = engine.onRectChanged(
            (rect: CropRect | null) => {
                this._cropRect = rect;
                this._redrawCrop();
            }
        );
    }

    set showCropRect(value: boolean) {
        this._showCropRect = value;
        if (value && this._cropEngine) {
            this._cropRect = this._cropEngine.getRect();
        }
        this._redrawCrop();
    }

    setup(): void {
        this._unsubscribe = this._engine.onImageChanged(
            (image: EditorImage | null) => this._onImageChanged(image)
        );
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

        const currentImage = this._engine.getImage();
        if (currentImage) {
            this._onImageChanged(currentImage);
        }
    }

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

    private async _onImageChanged(image: EditorImage | null): Promise<void> {
        if (!image) {
            if (this._sprite) {
                this._container.removeChild(this._sprite);
                this._sprite.destroy();
                this._sprite = null;
            }
            this._handles.clear();
            this._border.clear();
            return;
        }

        if (!this._sprite || this._sprite.label !== image.src) {
            if (this._sprite) {
                this._container.removeChild(this._sprite);
                this._sprite.destroy();
            }
            const texture = (await Assets.load(image.src)) as Texture;
            this._sprite = new Sprite(texture);
            this._sprite.label = image.src;
            this._sprite.anchor.set(0.5, 0.5);
            this._container.addChildAt(this._sprite, 0);
        }

        this._sprite.position.set(image.position.x, image.position.y);
        this._sprite.width = image.width;
        this._sprite.height = image.height;

        this._drawHandlesAndBorder(image);
    }

    private _drawHandlesAndBorder(image: EditorImage): void {
        const halfW = image.width / 2;
        const halfH = image.height / 2;
        const x = image.position.x;
        const y = image.position.y;
        const handleRadius = HANDLE_VISUAL_RADIUS_PX / this._zoomLevel;
        const borderWidth = BORDER_WIDTH_PX / this._zoomLevel;

        this._border.clear();
        if (this._showHandles) {
            this._border.rect(x - halfW, y - halfH, image.width, image.height);
            this._border.stroke({ color: HANDLE_COLOR, width: borderWidth });
        }

        this._handles.clear();
        if (this._showHandles) {
            const corners = [
                { x: x - halfW, y: y - halfH },
                { x: x + halfW, y: y - halfH },
                { x: x - halfW, y: y + halfH },
                { x: x + halfW, y: y + halfH },
            ];
            for (const corner of corners) {
                this._handles.circle(corner.x, corner.y, handleRadius);
                this._handles.fill({ color: HANDLE_COLOR });
                this._handles.stroke({ color: 0xffffff, pixelLine: true });
            }
        }
    }

    private _redrawCrop(): void {
        const image = this._engine.getImage();
        this._cropOverlay.clear();
        this._cropBorder.clear();
        this._cropHandles.clear();

        if (!this._showCropRect || !this._cropRect || !image) return;

        const handleRadius = HANDLE_VISUAL_RADIUS_PX / this._zoomLevel;
        const borderWidth = BORDER_WIDTH_PX / this._zoomLevel;
        const cropColor = 0xff8800;

        // Dim mask: four strips covering the area outside the crop rect.
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
}
