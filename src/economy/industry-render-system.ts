import { Container, Graphics, Text, TextStyle } from 'pixi.js';

import { ELEVATION, ELEVATION_VALUES } from '@/trains/tracks/types';
import { WorldRenderSystem } from '@/world-render-system';

import type { IndustryManager } from './industry-manager';
import type { IndustryEntity } from './simulation-state';
import { IndustryType } from './types';

type SelectionCallback = (id: number) => void;

const GROUND_BAND_INDEX = ELEVATION_VALUES.indexOf(ELEVATION.GROUND as number);

const INDUSTRY_COLORS: Record<IndustryType, number> = {
    [IndustryType.FARM]: 0x8bc34a,
    [IndustryType.LUMBER_MILL]: 0x795548,
    [IndustryType.WORKSHOP]: 0x607d8b,
};

const INDUSTRY_LABELS: Record<IndustryType, string> = {
    [IndustryType.FARM]: 'Farm',
    [IndustryType.LUMBER_MILL]: 'Lumber',
    [IndustryType.WORKSHOP]: 'Workshop',
};

const INDUSTRY_SIZE = 30;

type IndustryRecord = {
    graphics: Graphics;
    label: Text;
};

/**
 * Renders a colored square with a label for each industry through the
 * WorldRenderSystem at ground level.
 *
 * @group Economy System
 */
export class IndustryRenderSystem {
    private _worldRenderSystem: WorldRenderSystem;
    private _industryManager: IndustryManager;
    private _records: Map<number, IndustryRecord> = new Map();
    private _disposed = false;
    private _onSelect: SelectionCallback | null = null;

    private _boundOnAdd: (id: number, entity: IndustryEntity) => void;
    private _boundOnRemove: (id: number) => void;

    constructor(
        worldRenderSystem: WorldRenderSystem,
        industryManager: IndustryManager
    ) {
        this._worldRenderSystem = worldRenderSystem;
        this._industryManager = industryManager;

        this._boundOnAdd = this._onAdd.bind(this);
        this._boundOnRemove = this._onRemove.bind(this);

        industryManager.onAdd(this._boundOnAdd);
        industryManager.onRemove(this._boundOnRemove);
    }

    setOnSelect(callback: SelectionCallback): void {
        this._onSelect = callback;
    }

    cleanup(): void {
        if (this._disposed) return;
        this._disposed = true;

        for (const [id] of this._records) {
            const key = industryKey(id);
            const container = this._worldRenderSystem.removeFromBand(key);
            container?.destroy({ children: true });
        }
        this._records.clear();
    }

    private _onAdd(id: number, entity: IndustryEntity): void {
        const key = industryKey(id);
        const color = INDUSTRY_COLORS[entity.type];
        const label = INDUSTRY_LABELS[entity.type];
        const half = INDUSTRY_SIZE / 2;

        const container = new Container();
        container.position.set(entity.position.x, entity.position.y);
        container.eventMode = 'static';
        container.cursor = 'pointer';
        container.on('pointertap', () => {
            this._onSelect?.(id);
        });

        const graphics = new Graphics();
        graphics.rect(-half, -half, INDUSTRY_SIZE, INDUSTRY_SIZE);
        graphics.fill({ color });
        graphics.rect(-half, -half, INDUSTRY_SIZE, INDUSTRY_SIZE);
        graphics.stroke({ color: 0x000000, pixelLine: true });
        container.addChild(graphics);

        const style = new TextStyle({
            fontSize: 10,
            fill: 0xffffff,
        });
        const text = new Text({ text: label, style });
        text.anchor.set(0.5, 0.5);
        container.addChild(text);

        this._records.set(id, { graphics, label: text });

        this._worldRenderSystem.addToBand(
            key,
            container,
            GROUND_BAND_INDEX,
            'drawable'
        );
    }

    private _onRemove(id: number): void {
        const key = industryKey(id);
        const record = this._records.get(id);
        if (record === undefined) return;

        const container = this._worldRenderSystem.removeFromBand(key);
        container?.destroy({ children: true });
        this._records.delete(id);
    }
}

/** Stable key for WorldRenderSystem keyed maps. */
const industryKey = (id: number): string => `__industry__${id}`;
