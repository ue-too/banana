// test/economy/industry-manager.test.ts
import { beforeEach, describe, expect, it } from 'bun:test';

import { IndustryManager } from '../../src/economy/industry-manager';
import {
    type EconomyState,
    createEconomyState,
} from '../../src/economy/simulation-state';
import { IndustryType } from '../../src/economy/types';

describe('IndustryManager', () => {
    let state: EconomyState;
    let manager: IndustryManager;

    beforeEach(() => {
        state = createEconomyState();
        manager = new IndustryManager(state);
    });

    it('adds an industry and returns its id', () => {
        const id = manager.addIndustry(IndustryType.FARM, { x: 100, y: 200 });
        expect(id).toBe(1);
        const industry = manager.getIndustry(id);
        expect(industry).not.toBeNull();
        expect(industry!.type).toBe(IndustryType.FARM);
        expect(industry!.position).toEqual({ x: 100, y: 200 });
    });

    it('removes an industry', () => {
        const id = manager.addIndustry(IndustryType.FARM, { x: 0, y: 0 });
        manager.removeIndustry(id);
        expect(manager.getIndustry(id)).toBeNull();
    });

    it('assigns station to industry', () => {
        const id = manager.addIndustry(IndustryType.FARM, { x: 0, y: 0 });
        manager.assignStation(id, 42);
        expect(manager.getIndustry(id)!.assignedStationId).toBe(42);
    });

    it('lists all industries', () => {
        manager.addIndustry(IndustryType.FARM, { x: 0, y: 0 });
        manager.addIndustry(IndustryType.WORKSHOP, { x: 100, y: 100 });
        expect(manager.getAllIndustries().length).toBe(2);
    });

    it('notifies on add', () => {
        let notifiedId: number | null = null;
        manager.onAdd(id => {
            notifiedId = id;
        });
        const id = manager.addIndustry(IndustryType.FARM, { x: 0, y: 0 });
        expect(notifiedId).toBe(id);
    });

    it('notifies on remove', () => {
        let notifiedId: number | null = null;
        manager.onRemove(id => {
            notifiedId = id;
        });
        const id = manager.addIndustry(IndustryType.FARM, { x: 0, y: 0 });
        manager.removeIndustry(id);
        expect(notifiedId).toBe(id);
    });
});
