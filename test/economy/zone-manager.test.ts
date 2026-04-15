// test/economy/zone-manager.test.ts
import { beforeEach, describe, expect, it } from 'bun:test';

import {
    type EconomyState,
    createEconomyState,
} from '../../src/economy/simulation-state';
import { ZoneType } from '../../src/economy/types';
import { ZoneManager } from '../../src/economy/zone-manager';

describe('ZoneManager', () => {
    let state: EconomyState;
    let manager: ZoneManager;

    beforeEach(() => {
        state = createEconomyState();
        manager = new ZoneManager(state);
    });

    it('adds a zone and returns its id', () => {
        const boundary = [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
            { x: 0, y: 100 },
        ];
        const id = manager.addZone(ZoneType.RESIDENTIAL, boundary);
        expect(id).toBe(1);
        const zone = manager.getZone(id);
        expect(zone).not.toBeNull();
        expect(zone!.type).toBe(ZoneType.RESIDENTIAL);
    });

    it('removes a zone', () => {
        const id = manager.addZone(ZoneType.RESIDENTIAL, [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
        ]);
        manager.removeZone(id);
        expect(manager.getZone(id)).toBeNull();
    });

    it('queries zone satisfaction', () => {
        const id = manager.addZone(ZoneType.RESIDENTIAL, [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
        ]);
        expect(manager.getSatisfaction(id)).toBe(0.5);
    });

    it('lists all zones', () => {
        manager.addZone(ZoneType.RESIDENTIAL, [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
        ]);
        manager.addZone(ZoneType.COMMERCIAL, [
            { x: 2, y: 0 },
            { x: 3, y: 0 },
            { x: 3, y: 1 },
        ]);
        expect(manager.getAllZones().length).toBe(2);
    });
});
