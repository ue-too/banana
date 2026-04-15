import { Graphics, Polygon } from 'pixi.js';

import { ELEVATION, ELEVATION_VALUES } from '@/trains/tracks/types';
import { WorldRenderSystem } from '@/world-render-system';

import type { ZoneEntity } from './simulation-state';
import { ZoneType } from './types';
import type { ZoneManager } from './zone-manager';

type SelectionCallback = (id: number) => void;

const GROUND_BAND_INDEX = ELEVATION_VALUES.indexOf(ELEVATION.GROUND as number);

const ZONE_COLORS: Record<
    ZoneType,
    { fill: number; alpha: number; stroke: number }
> = {
    [ZoneType.RESIDENTIAL]: { fill: 0x4caf50, alpha: 0.2, stroke: 0x4caf50 },
    [ZoneType.COMMERCIAL]: { fill: 0x2196f3, alpha: 0.2, stroke: 0x2196f3 },
    [ZoneType.INDUSTRIAL]: { fill: 0xff9800, alpha: 0.2, stroke: 0xff9800 },
};

/**
 * Renders zone boundary polygons through the WorldRenderSystem.
 *
 * Each zone is drawn as a filled, semi-transparent polygon with a colored
 * border. Color is determined by zone type (residential = green, commercial =
 * blue, industrial = orange).
 *
 * @group Economy System
 */
export class ZoneRenderSystem {
    private _worldRenderSystem: WorldRenderSystem;
    private _zoneManager: ZoneManager;
    private _graphics: Map<number, Graphics> = new Map();
    private _abortController: AbortController = new AbortController();
    private _onSelect: SelectionCallback | null = null;

    constructor(
        worldRenderSystem: WorldRenderSystem,
        zoneManager: ZoneManager
    ) {
        this._worldRenderSystem = worldRenderSystem;
        this._zoneManager = zoneManager;

        zoneManager.onAdd(this._onAdd.bind(this));
        zoneManager.onRemove(this._onRemove.bind(this));
    }

    setOnSelect(callback: SelectionCallback): void {
        this._onSelect = callback;
    }

    dispose(): void {
        this._abortController.abort();
        for (const [id] of this._graphics) {
            const key = zoneKey(id);
            const g = this._worldRenderSystem.removeFromBand(key);
            g?.destroy({ children: true });
        }
        this._graphics.clear();
    }

    private _onAdd(id: number, zone: ZoneEntity): void {
        const key = zoneKey(id);
        const g = new Graphics();
        drawZone(g, zone);

        // Make clickable for selection
        if (zone.boundary.length >= 3) {
            const flat = zone.boundary.flatMap(p => [p.x, p.y]);
            g.hitArea = new Polygon(flat);
            g.eventMode = 'static';
            g.cursor = 'pointer';
            g.on('pointertap', () => {
                this._onSelect?.(id);
            });
        }

        this._graphics.set(id, g);
        this._worldRenderSystem.addToBand(
            key,
            g,
            GROUND_BAND_INDEX,
            'drawable'
        );
    }

    private _onRemove(id: number): void {
        const key = zoneKey(id);
        const g = this._worldRenderSystem.removeFromBand(key);
        g?.destroy({ children: true });
        this._graphics.delete(id);
    }
}

/** Stable key for WorldRenderSystem keyed maps. */
const zoneKey = (id: number): string => `__zone__${id}`;

/** Draw a zone boundary polygon with a semi-transparent fill and colored stroke. */
const drawZone = (graphics: Graphics, zone: ZoneEntity): void => {
    const { boundary, type } = zone;
    if (boundary.length === 0) return;

    const colors = ZONE_COLORS[type];

    graphics.moveTo(boundary[0].x, boundary[0].y);
    for (let i = 1; i < boundary.length; i++) {
        graphics.lineTo(boundary[i].x, boundary[i].y);
    }
    graphics.closePath();
    graphics.fill({ color: colors.fill, alpha: colors.alpha });

    graphics.moveTo(boundary[0].x, boundary[0].y);
    for (let i = 1; i < boundary.length; i++) {
        graphics.lineTo(boundary[i].x, boundary[i].y);
    }
    graphics.closePath();
    graphics.stroke({ color: colors.stroke, pixelLine: true });
};
