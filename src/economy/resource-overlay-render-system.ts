import { Graphics } from 'pixi.js';

import { WorldRenderSystem } from '@/world-render-system';

import type { EconomyManager } from './economy-manager';
import { ResourceType } from './types';

const RESOURCE_COLORS: Record<ResourceType, number> = {
    [ResourceType.FOOD]: 0x4caf50,
    [ResourceType.GOODS]: 0x2196f3,
    [ResourceType.WORKERS]: 0xff9800,
    [ResourceType.BUILDING_MATERIALS]: 0x795548,
};

const RESOURCE_TYPES = Object.values(ResourceType) as ResourceType[];

const BAR_WIDTH = 8;
const BAR_MAX_HEIGHT = 40;
const BAR_SPACING = 10;

/** Maximum stockpile amount used to normalize bar heights. */
const MAX_STOCKPILE = 100;

/**
 * Renders small bar charts above stations showing their stockpile levels.
 *
 * The overlay is a single Graphics object redrawn on each call to
 * {@link update}. Use {@link setVisible} to toggle it on/off without
 * destroying it.
 *
 * @group Economy
 */
export class ResourceOverlayRenderSystem {
    private _worldRenderSystem: WorldRenderSystem;
    private _economyManager: EconomyManager;
    private _graphics: Graphics;
    private _visible: boolean = true;

    constructor(
        worldRenderSystem: WorldRenderSystem,
        economyManager: EconomyManager
    ) {
        this._worldRenderSystem = worldRenderSystem;
        this._economyManager = economyManager;

        this._graphics = new Graphics();
        this._worldRenderSystem.addOverlayContainer(this._graphics);
    }

    /** Toggle the overlay visibility without clearing buffered data. */
    setVisible(visible: boolean): void {
        this._visible = visible;
        this._graphics.visible = visible;
    }

    /**
     * Refresh the overlay by redrawing bar charts at every station position.
     *
     * @param stationPositions - Map of station id → world-space position
     */
    update(stationPositions: Map<number, { x: number; y: number }>): void {
        if (!this._visible) return;

        this._graphics.clear();

        for (const [stationId, pos] of stationPositions) {
            const economy = this._economyManager.getStationEconomy(stationId);
            if (economy === null) continue;

            const totalBars = RESOURCE_TYPES.length;
            const totalWidth =
                totalBars * BAR_WIDTH +
                (totalBars - 1) * (BAR_SPACING - BAR_WIDTH);
            const startX = pos.x - totalWidth / 2;
            const baseY = pos.y - 20; // offset above station

            for (let i = 0; i < RESOURCE_TYPES.length; i++) {
                const resource = RESOURCE_TYPES[i];
                const amount = economy.stockpile.get(resource);
                const fillRatio = Math.min(amount / MAX_STOCKPILE, 1);
                const barHeight = Math.max(fillRatio * BAR_MAX_HEIGHT, 1);
                const color = RESOURCE_COLORS[resource];

                const barX = startX + i * BAR_SPACING;
                const barY = baseY - barHeight;

                // Background track
                this._graphics.rect(
                    barX,
                    baseY - BAR_MAX_HEIGHT,
                    BAR_WIDTH,
                    BAR_MAX_HEIGHT
                );
                this._graphics.fill({ color: 0x000000, alpha: 0.25 });

                // Filled portion
                this._graphics.rect(barX, barY, BAR_WIDTH, barHeight);
                this._graphics.fill({ color, alpha: 0.9 });
            }
        }
    }

    /** Remove the overlay from the render system and destroy graphics resources. */
    dispose(): void {
        this._worldRenderSystem.removeOverlayContainer(this._graphics);
        this._graphics.destroy({ children: true });
    }
}
