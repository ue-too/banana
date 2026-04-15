import {
    ObservableInputTracker,
    convertFromCanvas2ViewPort,
    convertFromViewport2World,
    convertFromWindow2Canvas,
} from '@ue-too/board';
import type { Canvas, ObservableBoardCamera } from '@ue-too/board';
import type { Point } from '@ue-too/math';

import type { EconomyManager } from './economy-manager';
import type { ZoneType } from './types';
import type {
    ZonePlacementContext,
    ZonePlacementStateMachine,
} from './zone-placement-state-machine';

export class ZonePlacementEngine
    extends ObservableInputTracker
    implements ZonePlacementContext
{
    private _camera: ObservableBoardCamera;
    private _economyManager: EconomyManager;
    private _boundaryPoints: Point[] = [];
    private _selectedType: ZoneType | null = null;
    private _onShowTypeSelector: (() => void) | null = null;
    private _onHideTypeSelector: (() => void) | null = null;
    private _onPlacementComplete: (() => void) | null = null;
    private _stateMachine: ZonePlacementStateMachine | null = null;

    constructor(
        canvas: Canvas,
        camera: ObservableBoardCamera,
        economyManager: EconomyManager
    ) {
        super(canvas);
        this._camera = camera;
        this._economyManager = economyManager;
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

    /**
     * Called from the React UI when the user picks a zone type.
     * Fires the `confirmType` event on the state machine.
     */
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
    }

    updatePreview(_position: Point): void {
        // Ghost polygon rendering — future enhancement
    }

    finishZone(): void {
        if (this._boundaryPoints.length < 3 || !this._selectedType) {
            this._boundaryPoints = [];
            this._selectedType = null;
            this._onPlacementComplete?.();
            return;
        }
        this._economyManager.zones.addZone(
            this._selectedType,
            this._boundaryPoints
        );
        this._boundaryPoints = [];
        this._selectedType = null;
        this._onPlacementComplete?.();
    }

    confirmZone(_type: ZoneType): void {
        // No longer used — finishZone handles creation
    }

    cancelPlacement(): void {
        this._boundaryPoints = [];
        this._selectedType = null;
        this._onHideTypeSelector?.();
    }

    clearPreview(): void {
        // Preview clearing — future enhancement
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
}
