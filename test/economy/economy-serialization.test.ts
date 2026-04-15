import { describe, expect, it } from 'bun:test';

import { EconomyManager } from '../../src/economy/economy-manager';
import {
    deserializeEconomy,
    serializeEconomy,
} from '../../src/economy/economy-serialization';
import { IndustryType, ResourceType, ZoneType } from '../../src/economy/types';

describe('Economy Serialization', () => {
    it('round-trips industries', () => {
        const manager = new EconomyManager(() => 1);
        manager.registerStation(1);
        const id = manager.industries.addIndustry(IndustryType.FARM, {
            x: 10,
            y: 20,
        });
        manager.industries.assignStation(id, 1);

        const data = serializeEconomy(manager);
        const restored = new EconomyManager(() => 1);
        deserializeEconomy(restored, data);

        const industry = restored.industries.getIndustry(id);
        expect(industry).not.toBeNull();
        expect(industry!.type).toBe(IndustryType.FARM);
        expect(industry!.position).toEqual({ x: 10, y: 20 });
        expect(industry!.assignedStationId).toBe(1);
    });

    it('round-trips zones', () => {
        const manager = new EconomyManager(() => 1);
        const boundary = [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
        ];
        const id = manager.zones.addZone(ZoneType.RESIDENTIAL, boundary);

        const data = serializeEconomy(manager);
        const restored = new EconomyManager(() => 1);
        deserializeEconomy(restored, data);

        const zone = restored.zones.getZone(id);
        expect(zone).not.toBeNull();
        expect(zone!.type).toBe(ZoneType.RESIDENTIAL);
        expect(zone!.boundary).toEqual(boundary);
    });

    it('round-trips station economy data', () => {
        const manager = new EconomyManager(() => 1);
        manager.registerStation(1);
        manager.setLoadRule(1, ResourceType.FOOD, true);
        manager.setUnloadRule(1, ResourceType.GOODS, true);

        const stationData = manager.getStationEconomy(1)!;
        stationData.stockpile.add(ResourceType.FOOD, 42);

        const data = serializeEconomy(manager);
        const restored = new EconomyManager(() => 1);
        deserializeEconomy(restored, data);

        const restoredStation = restored.getStationEconomy(1);
        expect(restoredStation).not.toBeNull();
        expect(restoredStation!.stockpile.get(ResourceType.FOOD)).toBe(42);
        expect(restoredStation!.loadRules.has(ResourceType.FOOD)).toBe(true);
        expect(restoredStation!.unloadRules.has(ResourceType.GOODS)).toBe(true);
    });

    it('handles empty state', () => {
        const manager = new EconomyManager(() => null);
        const data = serializeEconomy(manager);
        const restored = new EconomyManager(() => null);
        deserializeEconomy(restored, data);

        expect(restored.industries.getAllIndustries().length).toBe(0);
        expect(restored.zones.getAllZones().length).toBe(0);
    });
});
