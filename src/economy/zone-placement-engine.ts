import {
    ObservableInputTracker,
    convertFromCanvas2ViewPort,
    convertFromViewport2World,
    convertFromWindow2Canvas,
} from '@ue-too/board';
import type { Canvas, ObservableBoardCamera } from '@ue-too/board';
import type { Point } from '@ue-too/math';
import { Container, Graphics } from 'pixi.js';

import type { WorldRenderSystem } from '@/world-render-system';

import type { EconomyManager } from './economy-manager';
import { ZoneType } from './types';
import type {
    ZonePlacementContext,
    ZonePlacementStateMachine,
} from './zone-placement-state-machine';

const ZONE_PREVIEW_COLORS: Record<ZoneType, number> = {
    [ZoneType.RESIDENTIAL]: 0x4caf50,
    [ZoneType.COMMERCIAL]: 0x2196f3,
    [ZoneType.INDUSTRIAL]: 0xff9800,
};

const DOT_RADIUS = 4;

export class ZonePlacementEngine
    extends ObservableInputTracker
    implements ZonePlacementContext
{
    private _camera: ObservableBoardCamera;
    private _economyManager: EconomyManager;
    private _worldRenderSystem: WorldRenderSystem;
    private _boundaryPoints: Point[] = [];
    private _selectedType: ZoneType | null = null;
    private _onShowTypeSelector: (() => void) | null = null;
    private _onHideTypeSelector: (() => void) | null = null;
    private _onPlacementComplete: (() => void) | null = null;
    private _stateMachine: ZonePlacementStateMachine | null = null;

    // Preview graphics
    private _previewContainer: Container = new Container();
    private _previewGraphics: Graphics = new Graphics();
    private _previewAttached = false;

    constructor(
        canvas: Canvas,
        camera: ObservableBoardCamera,
        economyManager: EconomyManager,
        worldRenderSystem: WorldRenderSystem
    ) {
        super(canvas);
        this._camera = camera;
        this._economyManager = economyManager;
        this._worldRenderSystem = worldRenderSystem;
        this._previewContainer.addChild(this._previewGraphics);
    }

    setStateMachine(sm: ZonePlacementStateMachine): void {
        this._stateMachine = sm;
    }

    setTypeSelectorCallbacks(onShow: () => void, onHide: () => void): void {
        this._onShowTypeSelector = onShow;
        this._onHideTypeSelector = onHide;
    }

    setOnPlacementComplete(callback: () => void): void {
        this._onPlacementComplete = callback;
    }

    selectZoneType(type: ZoneType): void {
        this._selectedType = type;
        this._stateMachine?.happens('confirmType', { zoneType: type });
        this._onHideTypeSelector?.();
    }

    showTypeSelector(): void {
        this._onShowTypeSelector?.();
    }

    hideTypeSelector(): void {
        this._onHideTypeSelector?.();
    }

    setSelectedType(type: ZoneType): void {
        this._selectedType = type;
    }

    addBoundaryPoint(position: Point): void {
        this._boundaryPoints.push(position);
        this._drawPreview();
    }

    updatePreview(position: Point): void {
        this._drawPreview(position);
    }

    finishZone(): void {
        if (this._boundaryPoints.length < 3 || !this._selectedType) {
            this._boundaryPoints = [];
            this._selectedType = null;
            this._removePreview();
            this._onPlacementComplete?.();
            return;
        }
        this._economyManager.zones.addZone(
            this._selectedType,
            this._boundaryPoints
        );
        this._boundaryPoints = [];
        this._selectedType = null;
        this._removePreview();
        this._onPlacementComplete?.();
    }

    confirmZone(_type: ZoneType): void {
        // No longer used — finishZone handles creation
    }

    cancelPlacement(): void {
        this._boundaryPoints = [];
        this._selectedType = null;
        this._onHideTypeSelector?.();
        this._removePreview();
    }

    clearPreview(): void {
        this._removePreview();
    }

    setup(): void {}
    cleanup(): void {}

    convert2WorldPosition(position: Point): Point {
        const pointInCanvas = convertFromWindow2Canvas(position, this.canvas);
        const pointInViewPort = convertFromCanvas2ViewPort(pointInCanvas, {
            x: this.canvas.width / 2,
            y: this.canvas.height / 2,
        });
        return convertFromViewport2World(
            pointInViewPort,
            this._camera.position,
            this._camera.zoomLevel,
            this._camera.rotation,
            false
        );
    }

    // --- Preview rendering ---

    private _ensurePreviewAttached(): void {
        if (!this._previewAttached) {
            this._worldRenderSystem.addOverlayContainer(this._previewContainer);
            this._previewAttached = true;
        }
    }

    private _removePreview(): void {
        this._previewGraphics.clear();
        if (this._previewAttached) {
            this._previewContainer.removeFromParent();
            this._previewAttached = false;
        }
    }

    private _drawPreview(cursorPos?: Point): void {
        this._ensurePreviewAttached();
        const g = this._previewGraphics;
        g.clear();

        const color =
            this._selectedType !== null
                ? ZONE_PREVIEW_COLORS[this._selectedType]
                : 0xffffff;
        const points = this._boundaryPoints;

        if (points.length === 0) return;

        // Draw lines between existing points
        if (points.length >= 2) {
            g.moveTo(points[0].x, points[0].y);
            for (let i = 1; i < points.length; i++) {
                g.lineTo(points[i].x, points[i].y);
            }
            // Dashed line to cursor position
            if (cursorPos) {
                g.lineTo(cursorPos.x, cursorPos.y);
                // Line back to start for closing hint
                g.lineTo(points[0].x, points[0].y);
            }
            g.stroke({ color, width: 2, alpha: 0.6 });
        }

        // Draw a line from first point to cursor if only 1 point
        if (points.length === 1 && cursorPos) {
            g.moveTo(points[0].x, points[0].y);
            g.lineTo(cursorPos.x, cursorPos.y);
            g.stroke({ color, width: 2, alpha: 0.6 });
        }

        // Semi-transparent fill if 3+ points
        if (points.length >= 3) {
            g.moveTo(points[0].x, points[0].y);
            for (let i = 1; i < points.length; i++) {
                g.lineTo(points[i].x, points[i].y);
            }
            if (cursorPos) {
                g.lineTo(cursorPos.x, cursorPos.y);
            }
            g.closePath();
            g.fill({ color, alpha: 0.15 });
        }

        // Draw dots at each boundary point
        for (const pt of points) {
            g.circle(pt.x, pt.y, DOT_RADIUS);
            g.fill({ color, alpha: 0.8 });
        }
    }
}
