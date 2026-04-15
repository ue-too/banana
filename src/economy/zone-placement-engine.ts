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
const SNAP_RADIUS_PX = 20; // screen pixels
const SNAP_RING_RADIUS = 10;

function dist(a: Point, b: Point): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

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
    private _lastCursorPos: Point | null = null;

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
        // If 3+ points and clicking near the start, close the polygon
        if (this._boundaryPoints.length >= 3) {
            const start = this._boundaryPoints[0];
            if (dist(position, start) <= this._snapRadiusWorld()) {
                this.finishZone();
                return;
            }
        }

        this._boundaryPoints.push(position);
        this._drawPreview();
    }

    updatePreview(position: Point): void {
        this._lastCursorPos = position;
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
        this._lastCursorPos = null;
        this._removePreview();
        this._onPlacementComplete?.();
    }

    confirmZone(_type: ZoneType): void {
        // No longer used — finishZone handles creation
    }

    cancelPlacement(): void {
        this._boundaryPoints = [];
        this._selectedType = null;
        this._lastCursorPos = null;
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

    /** Snap radius in world units, adjusted for current zoom level. */
    private _snapRadiusWorld(): number {
        return SNAP_RADIUS_PX / this._camera.zoomLevel;
    }

    private _isNearStart(pos: Point): boolean {
        if (this._boundaryPoints.length < 3) return false;
        return dist(pos, this._boundaryPoints[0]) <= this._snapRadiusWorld();
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

        const nearStart = cursorPos ? this._isNearStart(cursorPos) : false;

        // Draw lines between existing points
        g.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            g.lineTo(points[i].x, points[i].y);
        }
        // Line to cursor (or snapped to start)
        if (cursorPos) {
            if (nearStart) {
                g.lineTo(points[0].x, points[0].y);
            } else {
                g.lineTo(cursorPos.x, cursorPos.y);
                // Dashed hint back to start
                g.moveTo(cursorPos.x, cursorPos.y);
                g.lineTo(points[0].x, points[0].y);
            }
        }
        g.stroke({ color, width: 2, alpha: nearStart ? 0.9 : 0.5 });

        // Semi-transparent fill preview
        if (points.length >= 2) {
            g.moveTo(points[0].x, points[0].y);
            for (let i = 1; i < points.length; i++) {
                g.lineTo(points[i].x, points[i].y);
            }
            if (cursorPos && !nearStart) {
                g.lineTo(cursorPos.x, cursorPos.y);
            }
            g.closePath();
            g.fill({ color, alpha: 0.1 });
        }

        // Draw dots at each boundary point
        for (const pt of points) {
            g.circle(pt.x, pt.y, DOT_RADIUS);
            g.fill({ color, alpha: 0.8 });
        }

        // Snap indicator: highlight ring around start point when cursor is close
        if (nearStart) {
            const start = points[0];
            const ringRadius = this._snapRadiusWorld() * 0.6;
            g.circle(start.x, start.y, ringRadius);
            g.stroke({ color: 0xffffff, width: 2, alpha: 0.9 });
            g.circle(start.x, start.y, ringRadius);
            g.fill({ color, alpha: 0.3 });
        }
    }
}
