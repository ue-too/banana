import {
    ObservableInputTracker,
    convertFromCanvas2ViewPort,
    convertFromViewport2World,
    convertFromWindow2Canvas,
} from '@ue-too/board';
import type { Canvas, ObservableBoardCamera } from '@ue-too/board';
import type { Point } from '@ue-too/math';

import type { StationManager } from '@/stations/station-manager';

import type { EconomyManager } from './economy-manager';
import type {
    IndustryPlacementContext,
    IndustryPlacementStateMachine,
} from './industry-placement-state-machine';
import type { IndustryType } from './types';

export class IndustryPlacementEngine
    extends ObservableInputTracker
    implements IndustryPlacementContext
{
    private _camera: ObservableBoardCamera;
    private _economyManager: EconomyManager;
    private _stationManager: StationManager;
    private _selectedType: IndustryType | null = null;
    private _onShowTypeSelector: (() => void) | null = null;
    private _onHideTypeSelector: (() => void) | null = null;
    private _onPlacementComplete: (() => void) | null = null;
    private _stateMachine: IndustryPlacementStateMachine | null = null;

    constructor(
        canvas: Canvas,
        camera: ObservableBoardCamera,
        economyManager: EconomyManager,
        stationManager: StationManager
    ) {
        super(canvas);
        this._camera = camera;
        this._economyManager = economyManager;
        this._stationManager = stationManager;
    }

    setStateMachine(sm: IndustryPlacementStateMachine): void {
        this._stateMachine = sm;
    }

    setTypeSelectorCallbacks(onShow: () => void, onHide: () => void): void {
        this._onShowTypeSelector = onShow;
        this._onHideTypeSelector = onHide;
    }

    setOnPlacementComplete(callback: () => void): void {
        this._onPlacementComplete = callback;
    }

    showTypeSelector(): void {
        this._onShowTypeSelector?.();
    }

    hideTypeSelector(): void {
        this._onHideTypeSelector?.();
    }

    setSelectedType(type: IndustryType): void {
        this._selectedType = type;
    }

    /**
     * Called from the React UI when the user picks a type from the selector.
     * Fires the `selectType` event on the state machine and hides the panel.
     */
    selectType(type: IndustryType): void {
        this._selectedType = type;
        this._stateMachine?.happens('selectType', { industryType: type });
        this._onHideTypeSelector?.();
    }

    updateGhostPosition(_position: Point): void {
        // Ghost rendering — future enhancement
    }

    showServiceRadiusOverlay(_position: Point): void {
        // Service radius overlay — future enhancement
    }

    placeIndustry(position: Point): void {
        if (!this._selectedType) return;
        const id = this._economyManager.industries.addIndustry(
            this._selectedType,
            position
        );
        // Auto-assign nearest station
        const stationPositions = new Map<number, Point>();
        for (const {
            id: stationId,
            station,
        } of this._stationManager.getStations()) {
            stationPositions.set(stationId, station.position);
        }
        const nearestStation = this._economyManager.findNearestStation(
            position,
            stationPositions
        );
        if (nearestStation !== null) {
            this._economyManager.industries.assignStation(id, nearestStation);
        }
        this._selectedType = null;
        this._onPlacementComplete?.();
    }

    clearGhost(): void {
        this._selectedType = null;
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
