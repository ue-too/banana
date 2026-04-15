# Resource Transportation & City Building — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a resource economy, industry production, player-zoned cities, and cargo transport to the existing railway simulator so that trains drive city growth.

**Architecture:** Hybrid Manager Facades + Internal ECS. New managers (`ResourceManager`, `IndustryManager`, `ZoneManager`, `CityGrowthManager`) follow the existing manager pattern externally but delegate to a shared, tick-based economic simulation core internally. The sim core is a pure function `(state, deltaTime) → newState`, ticked by `TimeManager`.

**Tech Stack:** TypeScript, Bun test runner, PixiJS 8 (rendering), Zustand (UI state), `@ue-too/being` (state machines), `@ue-too/board` (observables)

---

## File Structure

### New files — Simulation Core

| File | Responsibility |
|---|---|
| `src/economy/types.ts` | `ResourceType` enum, `Recipe`, `Stockpile`, `TransportOrder`, `ZoneType`, `IndustryType` types |
| `src/economy/stockpile.ts` | Stockpile data structure: add, remove, query, has-enough |
| `src/economy/recipes.ts` | Recipe definitions for all v1 industries (Farm, Lumber Mill, Workshop) |
| `src/economy/simulation-state.ts` | `EconomyState` aggregate type, factory function |
| `src/economy/systems/production-system.ts` | Tick step 1: industries consume inputs, produce outputs |
| `src/economy/systems/demand-system.ts` | Tick step 2: zones calculate resource needs |
| `src/economy/systems/transfer-system.ts` | Tick step 3: move resources between station stockpiles and nearby zones/industries |
| `src/economy/systems/growth-system.ts` | Tick step 4: evaluate zone satisfaction, spawn/abandon buildings |
| `src/economy/simulation-tick.ts` | Orchestrates the four systems into one tick pipeline |

### New files — Manager Facades

| File | Responsibility |
|---|---|
| `src/economy/industry-manager.ts` | Create/remove/query industries. Thin facade over `EconomyState`. |
| `src/economy/zone-manager.ts` | Create/designate/query zones. Thin facade over `EconomyState`. |
| `src/economy/city-growth-manager.ts` | Track city clusters, reputation, building spawn/abandon decisions. |
| `src/economy/resource-manager.ts` | Query stockpiles, flow stats, global supply/demand. |
| `src/economy/economy-manager.ts` | Top-level orchestrator: owns `EconomyState`, runs tick pipeline, exposes sub-managers. |

### New files — Transport Integration

| File | Responsibility |
|---|---|
| `src/economy/cargo-slot.ts` | `CargoSlot` type and helpers for freight car cargo |
| `src/economy/station-cargo.ts` | Station stockpile and load/unload rule types, transfer logic |

### New files — UI

| File | Responsibility |
|---|---|
| `src/stores/economy-ui-store.ts` | Zustand store for economy UI state (selected zone, overlay toggle, etc.) |
| `src/economy/zone-placement-state-machine.ts` | State machine for drawing zone boundary polygons |
| `src/economy/industry-placement-state-machine.ts` | State machine for placing industries |

### New files — Rendering

| File | Responsibility |
|---|---|
| `src/economy/zone-render-system.ts` | Render zone boundary polygons with type-colored fills |
| `src/economy/industry-render-system.ts` | Render industry buildings with icons |
| `src/economy/resource-overlay-render-system.ts` | Render station stockpile bars and resource flow lines |

### New files — Tests

| File | Responsibility |
|---|---|
| `test/economy/stockpile.test.ts` | Stockpile add/remove/query |
| `test/economy/production-system.test.ts` | Industry production logic |
| `test/economy/demand-system.test.ts` | Zone demand calculation |
| `test/economy/transfer-system.test.ts` | Station ↔ zone/industry resource transfer |
| `test/economy/growth-system.test.ts` | Satisfaction → building spawn/abandon |
| `test/economy/simulation-tick.test.ts` | Full pipeline integration |
| `test/economy/cargo-slot.test.ts` | Freight car cargo operations |
| `test/economy/station-cargo.test.ts` | Station load/unload logic |
| `test/economy/industry-manager.test.ts` | Industry manager facade |
| `test/economy/zone-manager.test.ts` | Zone manager facade |
| `test/economy/economy-serialization.test.ts` | Round-trip serialization |

### Modified files

| File | Change |
|---|---|
| `src/trains/cars.ts` | No structural change — `CarType.FREIGHT` already exists |
| `src/scene-serialization.ts` | Add economy data to `SerializedSceneData`, call `EconomyManager.serialize()`/`deserialize()` |
| `src/utils/init-app.ts` | Instantiate `EconomyManager`, wire to `TimeManager`, add to `BananaAppComponents` |
| `src/trains/input-state-machine/tool-switcher-state-machine.ts` | Add `ZONE` and `INDUSTRY` tool states |

---

## Task 1: Resource Types & Stockpile

**Files:**
- Create: `src/economy/types.ts`
- Create: `src/economy/stockpile.ts`
- Test: `test/economy/stockpile.test.ts`

- [ ] **Step 1: Write failing tests for Stockpile**

```typescript
// test/economy/stockpile.test.ts
import { describe, it, expect } from 'bun:test';
import { Stockpile } from '../../src/economy/stockpile';
import { ResourceType } from '../../src/economy/types';

describe('Stockpile', () => {
    it('starts empty', () => {
        const s = new Stockpile();
        expect(s.get(ResourceType.FOOD)).toBe(0);
        expect(s.isEmpty()).toBe(true);
    });

    it('adds resources', () => {
        const s = new Stockpile();
        s.add(ResourceType.FOOD, 10);
        expect(s.get(ResourceType.FOOD)).toBe(10);
        expect(s.isEmpty()).toBe(false);
    });

    it('removes resources', () => {
        const s = new Stockpile();
        s.add(ResourceType.FOOD, 10);
        const removed = s.remove(ResourceType.FOOD, 7);
        expect(removed).toBe(7);
        expect(s.get(ResourceType.FOOD)).toBe(3);
    });

    it('clamps removal to available amount', () => {
        const s = new Stockpile();
        s.add(ResourceType.FOOD, 5);
        const removed = s.remove(ResourceType.FOOD, 10);
        expect(removed).toBe(5);
        expect(s.get(ResourceType.FOOD)).toBe(0);
    });

    it('checks if enough resources are available', () => {
        const s = new Stockpile();
        s.add(ResourceType.BUILDING_MATERIALS, 20);
        expect(s.hasEnough(ResourceType.BUILDING_MATERIALS, 15)).toBe(true);
        expect(s.hasEnough(ResourceType.BUILDING_MATERIALS, 25)).toBe(false);
    });

    it('returns all non-zero entries', () => {
        const s = new Stockpile();
        s.add(ResourceType.FOOD, 10);
        s.add(ResourceType.GOODS, 5);
        const entries = s.entries();
        expect(entries).toEqual([
            [ResourceType.FOOD, 10],
            [ResourceType.GOODS, 5],
        ]);
    });

    it('serializes and deserializes', () => {
        const s = new Stockpile();
        s.add(ResourceType.FOOD, 10);
        s.add(ResourceType.WORKERS, 3);
        const data = s.serialize();
        const restored = Stockpile.deserialize(data);
        expect(restored.get(ResourceType.FOOD)).toBe(10);
        expect(restored.get(ResourceType.WORKERS)).toBe(3);
        expect(restored.get(ResourceType.GOODS)).toBe(0);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/economy/stockpile.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement types.ts**

```typescript
// src/economy/types.ts
export enum ResourceType {
    FOOD = 'food',
    GOODS = 'goods',
    WORKERS = 'workers',
    BUILDING_MATERIALS = 'building_materials',
}

export enum IndustryType {
    FARM = 'farm',
    LUMBER_MILL = 'lumber_mill',
    WORKSHOP = 'workshop',
}

export enum ZoneType {
    RESIDENTIAL = 'residential',
    COMMERCIAL = 'commercial',
    INDUSTRIAL = 'industrial',
}

export interface Recipe {
    readonly industryType: IndustryType;
    readonly inputs: ReadonlyMap<ResourceType, number>; // resource → units consumed per game-minute
    readonly outputs: ReadonlyMap<ResourceType, number>; // resource → units produced per game-minute
    readonly workersRequired: number; // minimum workers needed to operate
}

export interface TransportOrder {
    readonly resource: ResourceType;
    readonly quantity: number;
    readonly sourceStationId: number;
    readonly destinationStationId: number;
}

export type SerializedStockpile = Record<string, number>;
```

- [ ] **Step 4: Implement stockpile.ts**

```typescript
// src/economy/stockpile.ts
import { ResourceType, type SerializedStockpile } from './types';

export class Stockpile {
    private _resources: Map<ResourceType, number> = new Map();

    get(type: ResourceType): number {
        return this._resources.get(type) ?? 0;
    }

    add(type: ResourceType, amount: number): void {
        this._resources.set(type, this.get(type) + amount);
    }

    remove(type: ResourceType, amount: number): number {
        const available = this.get(type);
        const removed = Math.min(available, amount);
        const remaining = available - removed;
        if (remaining <= 0) {
            this._resources.delete(type);
        } else {
            this._resources.set(type, remaining);
        }
        return removed;
    }

    hasEnough(type: ResourceType, amount: number): boolean {
        return this.get(type) >= amount;
    }

    isEmpty(): boolean {
        return this._resources.size === 0;
    }

    entries(): [ResourceType, number][] {
        return Array.from(this._resources.entries());
    }

    clear(): void {
        this._resources.clear();
    }

    serialize(): SerializedStockpile {
        const data: SerializedStockpile = {};
        for (const [type, amount] of this._resources) {
            data[type] = amount;
        }
        return data;
    }

    static deserialize(data: SerializedStockpile): Stockpile {
        const stockpile = new Stockpile();
        for (const [key, amount] of Object.entries(data)) {
            stockpile.add(key as ResourceType, amount);
        }
        return stockpile;
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test test/economy/stockpile.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/economy/types.ts src/economy/stockpile.ts test/economy/stockpile.test.ts
git commit -m "feat(economy): add resource types and stockpile data structure"
```

---

## Task 2: Recipes & Production Definitions

**Files:**
- Create: `src/economy/recipes.ts`

- [ ] **Step 1: Implement recipe definitions**

```typescript
// src/economy/recipes.ts
import { IndustryType, ResourceType, type Recipe } from './types';

export const RECIPES: ReadonlyMap<IndustryType, Recipe> = new Map([
    [
        IndustryType.FARM,
        {
            industryType: IndustryType.FARM,
            inputs: new Map(),
            outputs: new Map([[ResourceType.FOOD, 10]]),
            workersRequired: 2,
        },
    ],
    [
        IndustryType.LUMBER_MILL,
        {
            industryType: IndustryType.LUMBER_MILL,
            inputs: new Map(),
            outputs: new Map([[ResourceType.BUILDING_MATERIALS, 8]]),
            workersRequired: 3,
        },
    ],
    [
        IndustryType.WORKSHOP,
        {
            industryType: IndustryType.WORKSHOP,
            inputs: new Map([[ResourceType.BUILDING_MATERIALS, 5]]),
            outputs: new Map([[ResourceType.GOODS, 6]]),
            workersRequired: 4,
        },
    ],
]);

export function getRecipe(type: IndustryType): Recipe {
    const recipe = RECIPES.get(type);
    if (!recipe) {
        throw new Error(`No recipe defined for industry type: ${type}`);
    }
    return recipe;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/economy/recipes.ts
git commit -m "feat(economy): add industry recipe definitions"
```

---

## Task 3: Economy State & Industry/Zone Data Model

**Files:**
- Create: `src/economy/simulation-state.ts`

- [ ] **Step 1: Implement economy state**

```typescript
// src/economy/simulation-state.ts
import type { Point } from '@ue-too/math';
import { Stockpile } from './stockpile';
import { type IndustryType, type ZoneType, type ResourceType } from './types';

export interface IndustryEntity {
    readonly id: number;
    readonly type: IndustryType;
    readonly position: Point;
    assignedStationId: number | null; // nearest station within service radius
    workerCount: number;
    readonly stockpile: Stockpile; // local input/output buffer
}

export interface ZoneEntity {
    readonly id: number;
    readonly type: ZoneType;
    readonly boundary: readonly Point[]; // polygon vertices
    population: number;
    satisfaction: number; // 0.0–1.0
    satisfactionHistory: number[]; // rolling window of recent satisfaction samples
    readonly demandPerMinute: Map<ResourceType, number>; // current demand rates
}

export interface CityCluster {
    readonly id: number;
    readonly zoneIds: Set<number>;
    readonly stationIds: Set<number>;
    reputation: number; // weighted avg of zone satisfaction
}

export interface StationEconomyData {
    readonly stationId: number;
    readonly stockpile: Stockpile;
    serviceRadius: number;
    readonly loadRules: Set<ResourceType>; // resources to load onto trains
    readonly unloadRules: Set<ResourceType>; // resources to unload from trains
    autoMode: boolean; // if true, ignores manual rules and auto-detects
}

export interface EconomyState {
    industries: Map<number, IndustryEntity>;
    zones: Map<number, ZoneEntity>;
    cities: Map<number, CityCluster>;
    stationEconomy: Map<number, StationEconomyData>;
    nextIndustryId: number;
    nextZoneId: number;
    nextCityId: number;
}

export function createEconomyState(): EconomyState {
    return {
        industries: new Map(),
        zones: new Map(),
        cities: new Map(),
        stationEconomy: new Map(),
        nextIndustryId: 1,
        nextZoneId: 1,
        nextCityId: 1,
    };
}

export const DEFAULT_SERVICE_RADIUS = 500;

export const GROWTH_THRESHOLD = 0.6;
export const DECAY_THRESHOLD = 0.3;
export const GROWTH_SUSTAIN_MINUTES = 5;
export const DECAY_SUSTAIN_MINUTES = 10;
export const SATISFACTION_WINDOW_SIZE = 20; // number of samples in rolling window
```

- [ ] **Step 2: Commit**

```bash
git add src/economy/simulation-state.ts
git commit -m "feat(economy): add economy state data model"
```

---

## Task 4: Production System

**Files:**
- Create: `src/economy/systems/production-system.ts`
- Test: `test/economy/production-system.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// test/economy/production-system.test.ts
import { describe, it, expect, beforeEach } from 'bun:test';
import { runProduction } from '../../src/economy/systems/production-system';
import {
    createEconomyState,
    type EconomyState,
    type IndustryEntity,
    type StationEconomyData,
    DEFAULT_SERVICE_RADIUS,
} from '../../src/economy/simulation-state';
import { IndustryType, ResourceType } from '../../src/economy/types';
import { Stockpile } from '../../src/economy/stockpile';

function addIndustry(
    state: EconomyState,
    type: IndustryType,
    stationId: number,
    workers: number
): IndustryEntity {
    const id = state.nextIndustryId++;
    const industry: IndustryEntity = {
        id,
        type,
        position: { x: 0, y: 0 },
        assignedStationId: stationId,
        workerCount: workers,
        stockpile: new Stockpile(),
    };
    state.industries.set(id, industry);
    return industry;
}

function addStationEconomy(state: EconomyState, stationId: number): StationEconomyData {
    const data: StationEconomyData = {
        stationId,
        stockpile: new Stockpile(),
        serviceRadius: DEFAULT_SERVICE_RADIUS,
        loadRules: new Set(),
        unloadRules: new Set(),
        autoMode: false,
    };
    state.stationEconomy.set(stationId, data);
    return data;
}

describe('ProductionSystem', () => {
    let state: EconomyState;

    beforeEach(() => {
        state = createEconomyState();
    });

    it('farm produces food into station stockpile when it has workers', () => {
        const station = addStationEconomy(state, 1);
        addIndustry(state, IndustryType.FARM, 1, 5);

        runProduction(state, 1); // 1 game-minute

        expect(station.stockpile.get(ResourceType.FOOD)).toBe(10); // farm rate = 10/min
    });

    it('farm produces nothing without workers', () => {
        const station = addStationEconomy(state, 1);
        addIndustry(state, IndustryType.FARM, 1, 0);

        runProduction(state, 1);

        expect(station.stockpile.get(ResourceType.FOOD)).toBe(0);
    });

    it('farm produces nothing without assigned station', () => {
        addIndustry(state, IndustryType.FARM, null as unknown as number, 5);

        runProduction(state, 1);

        // no crash, no output anywhere
        expect(state.industries.size).toBe(1);
    });

    it('workshop consumes building materials and produces goods', () => {
        const station = addStationEconomy(state, 1);
        station.stockpile.add(ResourceType.BUILDING_MATERIALS, 100);
        addIndustry(state, IndustryType.WORKSHOP, 1, 5);

        runProduction(state, 1);

        expect(station.stockpile.get(ResourceType.GOODS)).toBe(6); // workshop rate = 6/min
        expect(station.stockpile.get(ResourceType.BUILDING_MATERIALS)).toBe(95); // consumed 5
    });

    it('workshop does not produce when inputs are insufficient', () => {
        const station = addStationEconomy(state, 1);
        station.stockpile.add(ResourceType.BUILDING_MATERIALS, 2); // needs 5
        addIndustry(state, IndustryType.WORKSHOP, 1, 5);

        runProduction(state, 1);

        expect(station.stockpile.get(ResourceType.GOODS)).toBe(0);
        expect(station.stockpile.get(ResourceType.BUILDING_MATERIALS)).toBe(2); // unchanged
    });

    it('scales production by deltaTime', () => {
        const station = addStationEconomy(state, 1);
        addIndustry(state, IndustryType.FARM, 1, 5);

        runProduction(state, 0.5); // half a game-minute

        expect(station.stockpile.get(ResourceType.FOOD)).toBe(5); // 10 * 0.5
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/economy/production-system.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement production system**

```typescript
// src/economy/systems/production-system.ts
import { getRecipe } from '../recipes';
import type { EconomyState } from '../simulation-state';

export function runProduction(state: EconomyState, deltaMinutes: number): void {
    for (const industry of state.industries.values()) {
        if (industry.assignedStationId === null) continue;
        if (industry.workerCount <= 0) continue;

        const stationData = state.stationEconomy.get(industry.assignedStationId);
        if (!stationData) continue;

        const recipe = getRecipe(industry.type);
        if (industry.workerCount < recipe.workersRequired) continue;

        // Check all inputs are available
        let canProduce = true;
        for (const [resource, rate] of recipe.inputs) {
            const needed = rate * deltaMinutes;
            if (!stationData.stockpile.hasEnough(resource, needed)) {
                canProduce = false;
                break;
            }
        }

        if (!canProduce) continue;

        // Consume inputs
        for (const [resource, rate] of recipe.inputs) {
            stationData.stockpile.remove(resource, rate * deltaMinutes);
        }

        // Produce outputs
        for (const [resource, rate] of recipe.outputs) {
            stationData.stockpile.add(resource, rate * deltaMinutes);
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/economy/production-system.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/economy/systems/production-system.ts test/economy/production-system.test.ts
git commit -m "feat(economy): add production system with recipe-based industry output"
```

---

## Task 5: Demand System

**Files:**
- Create: `src/economy/systems/demand-system.ts`
- Test: `test/economy/demand-system.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// test/economy/demand-system.test.ts
import { describe, it, expect, beforeEach } from 'bun:test';
import { runDemand } from '../../src/economy/systems/demand-system';
import {
    createEconomyState,
    type EconomyState,
    type ZoneEntity,
} from '../../src/economy/simulation-state';
import { ResourceType, ZoneType } from '../../src/economy/types';

function addZone(state: EconomyState, type: ZoneType, population: number): ZoneEntity {
    const id = state.nextZoneId++;
    const zone: ZoneEntity = {
        id,
        type,
        boundary: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
            { x: 0, y: 100 },
        ],
        population,
        satisfaction: 0.5,
        satisfactionHistory: [],
        demandPerMinute: new Map(),
    };
    state.zones.set(id, zone);
    return zone;
}

describe('DemandSystem', () => {
    let state: EconomyState;

    beforeEach(() => {
        state = createEconomyState();
    });

    it('residential zones demand food and goods proportional to population', () => {
        const zone = addZone(state, ZoneType.RESIDENTIAL, 10);

        runDemand(state);

        expect(zone.demandPerMinute.get(ResourceType.FOOD)).toBeGreaterThan(0);
        expect(zone.demandPerMinute.get(ResourceType.GOODS)).toBeGreaterThan(0);
    });

    it('commercial zones demand goods and workers', () => {
        const zone = addZone(state, ZoneType.COMMERCIAL, 10);

        runDemand(state);

        expect(zone.demandPerMinute.get(ResourceType.GOODS)).toBeGreaterThan(0);
        expect(zone.demandPerMinute.get(ResourceType.WORKERS)).toBeGreaterThan(0);
    });

    it('empty zones have zero demand', () => {
        const zone = addZone(state, ZoneType.RESIDENTIAL, 0);

        runDemand(state);

        expect(zone.demandPerMinute.get(ResourceType.FOOD) ?? 0).toBe(0);
    });

    it('higher population means higher demand', () => {
        const small = addZone(state, ZoneType.RESIDENTIAL, 5);
        const large = addZone(state, ZoneType.RESIDENTIAL, 20);

        runDemand(state);

        const smallFood = small.demandPerMinute.get(ResourceType.FOOD) ?? 0;
        const largeFood = large.demandPerMinute.get(ResourceType.FOOD) ?? 0;
        expect(largeFood).toBeGreaterThan(smallFood);
    });

    it('higher reputation zones demand more (growth spiral)', () => {
        const low = addZone(state, ZoneType.RESIDENTIAL, 10);
        low.satisfaction = 0.2;
        const high = addZone(state, ZoneType.RESIDENTIAL, 10);
        high.satisfaction = 0.9;

        runDemand(state);

        const lowFood = low.demandPerMinute.get(ResourceType.FOOD) ?? 0;
        const highFood = high.demandPerMinute.get(ResourceType.FOOD) ?? 0;
        expect(highFood).toBeGreaterThan(lowFood);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/economy/demand-system.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement demand system**

```typescript
// src/economy/systems/demand-system.ts
import type { EconomyState, ZoneEntity } from '../simulation-state';
import { ResourceType, ZoneType } from '../types';

// Base demand per population unit per game-minute
const ZONE_DEMAND: Record<ZoneType, [ResourceType, number][]> = {
    [ZoneType.RESIDENTIAL]: [
        [ResourceType.FOOD, 1],
        [ResourceType.GOODS, 0.5],
    ],
    [ZoneType.COMMERCIAL]: [
        [ResourceType.GOODS, 0.8],
        [ResourceType.WORKERS, 1],
    ],
    [ZoneType.INDUSTRIAL]: [
        [ResourceType.WORKERS, 1.5],
    ],
};

function computeDemand(zone: ZoneEntity): void {
    zone.demandPerMinute.clear();
    if (zone.population <= 0) return;

    const baseDemands = ZONE_DEMAND[zone.type];
    // Satisfaction multiplier: higher satisfaction = more demand (growth spiral)
    // Range: 0.5 at satisfaction=0 to 1.5 at satisfaction=1
    const satisfactionMultiplier = 0.5 + zone.satisfaction;

    for (const [resource, ratePerPop] of baseDemands) {
        const demand = zone.population * ratePerPop * satisfactionMultiplier;
        zone.demandPerMinute.set(resource, demand);
    }
}

export function runDemand(state: EconomyState): void {
    for (const zone of state.zones.values()) {
        computeDemand(zone);
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/economy/demand-system.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/economy/systems/demand-system.ts test/economy/demand-system.test.ts
git commit -m "feat(economy): add demand system with population-scaled zone needs"
```

---

## Task 6: Transfer System

**Files:**
- Create: `src/economy/systems/transfer-system.ts`
- Test: `test/economy/transfer-system.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// test/economy/transfer-system.test.ts
import { describe, it, expect, beforeEach } from 'bun:test';
import { runTransfer } from '../../src/economy/systems/transfer-system';
import {
    createEconomyState,
    type EconomyState,
    type ZoneEntity,
    type IndustryEntity,
    type StationEconomyData,
    DEFAULT_SERVICE_RADIUS,
} from '../../src/economy/simulation-state';
import { IndustryType, ResourceType, ZoneType } from '../../src/economy/types';
import { Stockpile } from '../../src/economy/stockpile';

function addStationEconomy(state: EconomyState, stationId: number, x = 0, y = 0): StationEconomyData {
    const data: StationEconomyData = {
        stationId,
        stockpile: new Stockpile(),
        serviceRadius: DEFAULT_SERVICE_RADIUS,
        loadRules: new Set(),
        unloadRules: new Set(),
        autoMode: false,
    };
    state.stationEconomy.set(stationId, data);
    return data;
}

function addZone(
    state: EconomyState,
    type: ZoneType,
    population: number,
    stationId: number
): ZoneEntity {
    const id = state.nextZoneId++;
    const zone: ZoneEntity = {
        id,
        type,
        boundary: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
            { x: 0, y: 100 },
        ],
        population,
        satisfaction: 0.5,
        satisfactionHistory: [],
        demandPerMinute: new Map([[ResourceType.FOOD, 10]]),
    };
    state.zones.set(id, zone);
    return zone;
}

function addIndustry(
    state: EconomyState,
    type: IndustryType,
    stationId: number
): IndustryEntity {
    const id = state.nextIndustryId++;
    const industry: IndustryEntity = {
        id,
        type,
        position: { x: 0, y: 0 },
        assignedStationId: stationId,
        workerCount: 0,
        stockpile: new Stockpile(),
    };
    state.industries.set(id, industry);
    return industry;
}

describe('TransferSystem', () => {
    let state: EconomyState;

    beforeEach(() => {
        state = createEconomyState();
    });

    it('transfers food from station stockpile to residential zone', () => {
        const station = addStationEconomy(state, 1);
        station.stockpile.add(ResourceType.FOOD, 50);
        const zone = addZone(state, ZoneType.RESIDENTIAL, 5, 1);
        zone.demandPerMinute.set(ResourceType.FOOD, 10);

        runTransfer(state, 1, getZoneStation);

        // Station should have less food, zone satisfaction should improve
        expect(station.stockpile.get(ResourceType.FOOD)).toBeLessThan(50);
    });

    it('delivers workers from residential zones to industries via station', () => {
        const station = addStationEconomy(state, 1);
        const zone = addZone(state, ZoneType.RESIDENTIAL, 10, 1);
        zone.satisfaction = 0.8; // satisfied residential zone produces workers
        const industry = addIndustry(state, IndustryType.FARM, 1);

        runTransfer(state, 1, getZoneStation);

        expect(industry.workerCount).toBeGreaterThan(0);
    });

    it('updates zone satisfaction based on fulfilled demand', () => {
        const station = addStationEconomy(state, 1);
        station.stockpile.add(ResourceType.FOOD, 100);
        const zone = addZone(state, ZoneType.RESIDENTIAL, 5, 1);
        zone.demandPerMinute.set(ResourceType.FOOD, 10);
        zone.satisfaction = 0.5;

        runTransfer(state, 1, getZoneStation);

        // Satisfaction should increase because demand was met
        expect(zone.satisfaction).toBeGreaterThan(0.5);
    });

    it('decreases satisfaction when demand is unmet', () => {
        const station = addStationEconomy(state, 1);
        // No food in station
        const zone = addZone(state, ZoneType.RESIDENTIAL, 5, 1);
        zone.demandPerMinute.set(ResourceType.FOOD, 10);
        zone.satisfaction = 0.8;

        runTransfer(state, 1, getZoneStation);

        expect(zone.satisfaction).toBeLessThan(0.8);
    });
});

// Helper: maps zone ID → station ID (in real code, this uses spatial lookup)
function getZoneStation(zoneId: number): number | null {
    // For tests, zone ID 1 → station 1, etc.
    return 1;
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/economy/transfer-system.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement transfer system**

```typescript
// src/economy/systems/transfer-system.ts
import type { EconomyState, ZoneEntity } from '../simulation-state';
import { ResourceType, ZoneType } from '../types';
import { SATISFACTION_WINDOW_SIZE } from '../simulation-state';

export type ZoneStationLookup = (zoneId: number) => number | null;

function workerOutputRate(zone: ZoneEntity): number {
    if (zone.type !== ZoneType.RESIDENTIAL) return 0;
    if (zone.satisfaction < 0.4) return 0;
    // Workers produced proportional to population and satisfaction
    return zone.population * 0.5 * zone.satisfaction;
}

export function runTransfer(
    state: EconomyState,
    deltaMinutes: number,
    getZoneStation: ZoneStationLookup
): void {
    // Phase 1: Deliver resources from stations to zones, track fulfillment
    for (const zone of state.zones.values()) {
        const stationId = getZoneStation(zone.id);
        if (stationId === null) continue;

        const stationData = state.stationEconomy.get(stationId);
        if (!stationData) continue;

        let totalDemand = 0;
        let totalFulfilled = 0;

        for (const [resource, ratePerMinute] of zone.demandPerMinute) {
            const needed = ratePerMinute * deltaMinutes;
            if (needed <= 0) continue;

            totalDemand += needed;
            const delivered = stationData.stockpile.remove(resource, needed);
            totalFulfilled += delivered;
        }

        // Update satisfaction based on fulfillment ratio
        if (totalDemand > 0) {
            const fulfillmentRatio = totalFulfilled / totalDemand;
            // Blend toward fulfillment ratio: slow to rise, slow to fall
            const blendSpeed = 0.1 * deltaMinutes;
            zone.satisfaction = zone.satisfaction + (fulfillmentRatio - zone.satisfaction) * Math.min(blendSpeed, 1);
            zone.satisfaction = Math.max(0, Math.min(1, zone.satisfaction));
        }

        // Record satisfaction sample
        zone.satisfactionHistory.push(zone.satisfaction);
        if (zone.satisfactionHistory.length > SATISFACTION_WINDOW_SIZE) {
            zone.satisfactionHistory.shift();
        }
    }

    // Phase 2: Residential zones produce workers → distribute to industries via stations
    for (const zone of state.zones.values()) {
        const rate = workerOutputRate(zone);
        if (rate <= 0) continue;

        const stationId = getZoneStation(zone.id);
        if (stationId === null) continue;

        const stationData = state.stationEconomy.get(stationId);
        if (!stationData) continue;

        const workersProduced = rate * deltaMinutes;
        stationData.stockpile.add(ResourceType.WORKERS, workersProduced);
    }

    // Phase 3: Distribute workers from stations to industries
    for (const industry of state.industries.values()) {
        if (industry.assignedStationId === null) continue;

        const stationData = state.stationEconomy.get(industry.assignedStationId);
        if (!stationData) continue;

        const available = stationData.stockpile.get(ResourceType.WORKERS);
        if (available <= 0) continue;

        const taken = stationData.stockpile.remove(ResourceType.WORKERS, available);
        industry.workerCount += taken;
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/economy/transfer-system.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/economy/systems/transfer-system.ts test/economy/transfer-system.test.ts
git commit -m "feat(economy): add transfer system for station-zone resource delivery"
```

---

## Task 7: Growth System

**Files:**
- Create: `src/economy/systems/growth-system.ts`
- Test: `test/economy/growth-system.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// test/economy/growth-system.test.ts
import { describe, it, expect, beforeEach } from 'bun:test';
import { runGrowth, type GrowthEvent } from '../../src/economy/systems/growth-system';
import {
    createEconomyState,
    type EconomyState,
    type ZoneEntity,
    GROWTH_THRESHOLD,
    DECAY_THRESHOLD,
    SATISFACTION_WINDOW_SIZE,
} from '../../src/economy/simulation-state';
import { ZoneType } from '../../src/economy/types';

function addZone(
    state: EconomyState,
    type: ZoneType,
    population: number,
    satisfaction: number,
    historyLength: number = SATISFACTION_WINDOW_SIZE
): ZoneEntity {
    const id = state.nextZoneId++;
    const zone: ZoneEntity = {
        id,
        type,
        boundary: [
            { x: 0, y: 0 },
            { x: 200, y: 0 },
            { x: 200, y: 200 },
            { x: 0, y: 200 },
        ],
        population,
        satisfaction,
        satisfactionHistory: Array(historyLength).fill(satisfaction),
        demandPerMinute: new Map(),
    };
    state.zones.set(id, zone);
    return zone;
}

describe('GrowthSystem', () => {
    let state: EconomyState;

    beforeEach(() => {
        state = createEconomyState();
    });

    it('spawns a building when satisfaction is sustained above growth threshold', () => {
        addZone(state, ZoneType.RESIDENTIAL, 5, GROWTH_THRESHOLD + 0.1);

        const events = runGrowth(state);

        const spawns = events.filter(e => e.type === 'spawn');
        expect(spawns.length).toBe(1);
        expect(spawns[0].zoneId).toBe(1);
    });

    it('does not spawn when satisfaction history is too short', () => {
        addZone(state, ZoneType.RESIDENTIAL, 5, GROWTH_THRESHOLD + 0.1, 3);

        const events = runGrowth(state);

        expect(events.filter(e => e.type === 'spawn').length).toBe(0);
    });

    it('abandons a building when satisfaction drops below decay threshold', () => {
        addZone(state, ZoneType.RESIDENTIAL, 5, DECAY_THRESHOLD - 0.1);

        const events = runGrowth(state);

        const abandons = events.filter(e => e.type === 'abandon');
        expect(abandons.length).toBe(1);
    });

    it('does not abandon when population is already zero', () => {
        addZone(state, ZoneType.RESIDENTIAL, 0, DECAY_THRESHOLD - 0.1);

        const events = runGrowth(state);

        expect(events.filter(e => e.type === 'abandon').length).toBe(0);
    });

    it('does nothing in the neutral zone between thresholds', () => {
        addZone(state, ZoneType.RESIDENTIAL, 5, 0.5);

        const events = runGrowth(state);

        expect(events.length).toBe(0);
    });

    it('increases population on spawn', () => {
        const zone = addZone(state, ZoneType.RESIDENTIAL, 5, GROWTH_THRESHOLD + 0.1);

        runGrowth(state);

        expect(zone.population).toBe(6);
    });

    it('decreases population on abandon', () => {
        const zone = addZone(state, ZoneType.RESIDENTIAL, 5, DECAY_THRESHOLD - 0.1);

        runGrowth(state);

        expect(zone.population).toBe(4);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/economy/growth-system.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement growth system**

```typescript
// src/economy/systems/growth-system.ts
import type { EconomyState, ZoneEntity } from '../simulation-state';
import {
    GROWTH_THRESHOLD,
    DECAY_THRESHOLD,
    SATISFACTION_WINDOW_SIZE,
} from '../simulation-state';

export interface GrowthEvent {
    readonly type: 'spawn' | 'abandon';
    readonly zoneId: number;
}

function averageSatisfaction(zone: ZoneEntity): number {
    const history = zone.satisfactionHistory;
    if (history.length === 0) return zone.satisfaction;
    let sum = 0;
    for (const s of history) sum += s;
    return sum / history.length;
}

function isHistoryFull(zone: ZoneEntity): boolean {
    return zone.satisfactionHistory.length >= SATISFACTION_WINDOW_SIZE;
}

export function runGrowth(state: EconomyState): GrowthEvent[] {
    const events: GrowthEvent[] = [];

    for (const zone of state.zones.values()) {
        if (!isHistoryFull(zone)) continue;

        const avg = averageSatisfaction(zone);

        if (avg >= GROWTH_THRESHOLD) {
            zone.population += 1;
            events.push({ type: 'spawn', zoneId: zone.id });
        } else if (avg < DECAY_THRESHOLD && zone.population > 0) {
            zone.population -= 1;
            events.push({ type: 'abandon', zoneId: zone.id });
        }
    }

    return events;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/economy/growth-system.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/economy/systems/growth-system.ts test/economy/growth-system.test.ts
git commit -m "feat(economy): add growth system with satisfaction-driven building spawn/abandon"
```

---

## Task 8: Simulation Tick Pipeline

**Files:**
- Create: `src/economy/simulation-tick.ts`
- Test: `test/economy/simulation-tick.test.ts`

- [ ] **Step 1: Write failing integration test**

```typescript
// test/economy/simulation-tick.test.ts
import { describe, it, expect, beforeEach } from 'bun:test';
import { simulationTick } from '../../src/economy/simulation-tick';
import {
    createEconomyState,
    type EconomyState,
    type StationEconomyData,
    type ZoneEntity,
    type IndustryEntity,
    DEFAULT_SERVICE_RADIUS,
    SATISFACTION_WINDOW_SIZE,
} from '../../src/economy/simulation-state';
import { IndustryType, ResourceType, ZoneType } from '../../src/economy/types';
import { Stockpile } from '../../src/economy/stockpile';
import type { ZoneStationLookup } from '../../src/economy/systems/transfer-system';

function addStationEconomy(state: EconomyState, stationId: number): StationEconomyData {
    const data: StationEconomyData = {
        stationId,
        stockpile: new Stockpile(),
        serviceRadius: DEFAULT_SERVICE_RADIUS,
        loadRules: new Set(),
        unloadRules: new Set(),
        autoMode: false,
    };
    state.stationEconomy.set(stationId, data);
    return data;
}

function addIndustry(
    state: EconomyState,
    type: IndustryType,
    stationId: number,
    workers: number
): IndustryEntity {
    const id = state.nextIndustryId++;
    const industry: IndustryEntity = {
        id,
        type,
        position: { x: 0, y: 0 },
        assignedStationId: stationId,
        workerCount: workers,
        stockpile: new Stockpile(),
    };
    state.industries.set(id, industry);
    return industry;
}

function addZone(
    state: EconomyState,
    type: ZoneType,
    population: number,
    stationId: number
): ZoneEntity {
    const id = state.nextZoneId++;
    const zone: ZoneEntity = {
        id,
        type,
        boundary: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
            { x: 0, y: 100 },
        ],
        population,
        satisfaction: 0.5,
        satisfactionHistory: [],
        demandPerMinute: new Map(),
    };
    state.zones.set(id, zone);
    return zone;
}

const getZoneStation: ZoneStationLookup = () => 1;

describe('simulationTick (integration)', () => {
    let state: EconomyState;

    beforeEach(() => {
        state = createEconomyState();
    });

    it('runs all four pipeline steps without error', () => {
        addStationEconomy(state, 1);
        addIndustry(state, IndustryType.FARM, 1, 5);
        addZone(state, ZoneType.RESIDENTIAL, 5, 1);

        const events = simulationTick(state, 1, getZoneStation);

        // Should not throw, events array returned
        expect(Array.isArray(events)).toBe(true);
    });

    it('farm produces food that gets delivered to residential zone', () => {
        const station = addStationEconomy(state, 1);
        addIndustry(state, IndustryType.FARM, 1, 5);
        const zone = addZone(state, ZoneType.RESIDENTIAL, 5, 1);

        // Run multiple ticks to let food flow
        for (let i = 0; i < 5; i++) {
            simulationTick(state, 1, getZoneStation);
        }

        // Zone should have demand calculated and satisfaction affected
        expect(zone.demandPerMinute.size).toBeGreaterThan(0);
        expect(zone.satisfactionHistory.length).toBeGreaterThan(0);
    });

    it('full loop: production → demand → transfer → growth over many ticks', () => {
        const station = addStationEconomy(state, 1);
        addIndustry(state, IndustryType.FARM, 1, 5);
        const zone = addZone(state, ZoneType.RESIDENTIAL, 3, 1);

        // Provide abundant food so satisfaction rises
        station.stockpile.add(ResourceType.FOOD, 10000);
        station.stockpile.add(ResourceType.GOODS, 10000);

        const initialPop = zone.population;

        // Run enough ticks to fill satisfaction window and trigger growth
        for (let i = 0; i < SATISFACTION_WINDOW_SIZE + 5; i++) {
            simulationTick(state, 1, getZoneStation);
        }

        // Population should have grown
        expect(zone.population).toBeGreaterThan(initialPop);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/economy/simulation-tick.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement simulation tick**

```typescript
// src/economy/simulation-tick.ts
import { runProduction } from './systems/production-system';
import { runDemand } from './systems/demand-system';
import { runTransfer, type ZoneStationLookup } from './systems/transfer-system';
import { runGrowth, type GrowthEvent } from './systems/growth-system';
import type { EconomyState } from './simulation-state';

export function simulationTick(
    state: EconomyState,
    deltaMinutes: number,
    getZoneStation: ZoneStationLookup
): GrowthEvent[] {
    // Step 1: Industries produce resources
    runProduction(state, deltaMinutes);

    // Step 2: Zones calculate demand
    runDemand(state);

    // Step 3: Transfer resources between stations and zones/industries
    runTransfer(state, deltaMinutes, getZoneStation);

    // Step 4: Evaluate growth/decay
    return runGrowth(state);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/economy/simulation-tick.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/economy/simulation-tick.ts test/economy/simulation-tick.test.ts
git commit -m "feat(economy): add simulation tick pipeline orchestrating all economy systems"
```

---

## Task 9: Cargo Slot & Station Cargo Logic

**Files:**
- Create: `src/economy/cargo-slot.ts`
- Create: `src/economy/station-cargo.ts`
- Test: `test/economy/cargo-slot.test.ts`
- Test: `test/economy/station-cargo.test.ts`

- [ ] **Step 1: Write failing tests for CargoSlot**

```typescript
// test/economy/cargo-slot.test.ts
import { describe, it, expect } from 'bun:test';
import {
    createCargoSlot,
    loadCargo,
    unloadCargo,
    type CargoSlot,
} from '../../src/economy/cargo-slot';
import { ResourceType } from '../../src/economy/types';

describe('CargoSlot', () => {
    it('creates an empty slot with capacity', () => {
        const slot = createCargoSlot(50);
        expect(slot.resourceType).toBeNull();
        expect(slot.quantity).toBe(0);
        expect(slot.capacity).toBe(50);
    });

    it('loads cargo into empty slot', () => {
        const slot = createCargoSlot(50);
        const loaded = loadCargo(slot, ResourceType.FOOD, 30);
        expect(loaded).toBe(30);
        expect(slot.resourceType).toBe(ResourceType.FOOD);
        expect(slot.quantity).toBe(30);
    });

    it('clamps loading to capacity', () => {
        const slot = createCargoSlot(50);
        const loaded = loadCargo(slot, ResourceType.FOOD, 80);
        expect(loaded).toBe(50);
        expect(slot.quantity).toBe(50);
    });

    it('does not load different resource type into occupied slot', () => {
        const slot = createCargoSlot(50);
        loadCargo(slot, ResourceType.FOOD, 20);
        const loaded = loadCargo(slot, ResourceType.GOODS, 10);
        expect(loaded).toBe(0);
        expect(slot.resourceType).toBe(ResourceType.FOOD);
        expect(slot.quantity).toBe(20);
    });

    it('adds to existing cargo of same type', () => {
        const slot = createCargoSlot(50);
        loadCargo(slot, ResourceType.FOOD, 20);
        const loaded = loadCargo(slot, ResourceType.FOOD, 15);
        expect(loaded).toBe(15);
        expect(slot.quantity).toBe(35);
    });

    it('unloads cargo and clears type when empty', () => {
        const slot = createCargoSlot(50);
        loadCargo(slot, ResourceType.FOOD, 30);
        const unloaded = unloadCargo(slot, 30);
        expect(unloaded).toEqual({ resource: ResourceType.FOOD, quantity: 30 });
        expect(slot.resourceType).toBeNull();
        expect(slot.quantity).toBe(0);
    });

    it('partially unloads cargo', () => {
        const slot = createCargoSlot(50);
        loadCargo(slot, ResourceType.FOOD, 30);
        const unloaded = unloadCargo(slot, 10);
        expect(unloaded).toEqual({ resource: ResourceType.FOOD, quantity: 10 });
        expect(slot.quantity).toBe(20);
    });
});
```

- [ ] **Step 2: Write failing tests for station cargo**

```typescript
// test/economy/station-cargo.test.ts
import { describe, it, expect, beforeEach } from 'bun:test';
import {
    processTrainAtStation,
    type TrainCargo,
} from '../../src/economy/station-cargo';
import {
    type StationEconomyData,
    DEFAULT_SERVICE_RADIUS,
} from '../../src/economy/simulation-state';
import { createCargoSlot } from '../../src/economy/cargo-slot';
import { ResourceType } from '../../src/economy/types';
import { Stockpile } from '../../src/economy/stockpile';

function makeStationData(loadRules: ResourceType[], unloadRules: ResourceType[]): StationEconomyData {
    return {
        stationId: 1,
        stockpile: new Stockpile(),
        serviceRadius: DEFAULT_SERVICE_RADIUS,
        loadRules: new Set(loadRules),
        unloadRules: new Set(unloadRules),
        autoMode: false,
    };
}

describe('processTrainAtStation', () => {
    it('unloads matching cargo into station stockpile', () => {
        const station = makeStationData([], [ResourceType.FOOD]);
        const slot = createCargoSlot(50);
        slot.resourceType = ResourceType.FOOD;
        slot.quantity = 30;
        const trainCargo: TrainCargo = { slots: [slot] };

        processTrainAtStation(trainCargo, station);

        expect(station.stockpile.get(ResourceType.FOOD)).toBe(30);
        expect(slot.quantity).toBe(0);
    });

    it('loads matching cargo from station stockpile', () => {
        const station = makeStationData([ResourceType.GOODS], []);
        station.stockpile.add(ResourceType.GOODS, 40);
        const slot = createCargoSlot(50);
        const trainCargo: TrainCargo = { slots: [slot] };

        processTrainAtStation(trainCargo, station);

        expect(slot.resourceType).toBe(ResourceType.GOODS);
        expect(slot.quantity).toBe(40);
        expect(station.stockpile.get(ResourceType.GOODS)).toBe(0);
    });

    it('unloads first then loads', () => {
        const station = makeStationData([ResourceType.GOODS], [ResourceType.FOOD]);
        station.stockpile.add(ResourceType.GOODS, 20);
        const slot = createCargoSlot(50);
        slot.resourceType = ResourceType.FOOD;
        slot.quantity = 30;
        const trainCargo: TrainCargo = { slots: [slot] };

        processTrainAtStation(trainCargo, station);

        // Food was unloaded, then Goods loaded
        expect(station.stockpile.get(ResourceType.FOOD)).toBe(30);
        expect(slot.resourceType).toBe(ResourceType.GOODS);
        expect(slot.quantity).toBe(20);
    });

    it('skips cargo not in unload rules', () => {
        const station = makeStationData([], [ResourceType.GOODS]); // only unload goods
        const slot = createCargoSlot(50);
        slot.resourceType = ResourceType.FOOD;
        slot.quantity = 30;
        const trainCargo: TrainCargo = { slots: [slot] };

        processTrainAtStation(trainCargo, station);

        expect(slot.quantity).toBe(30); // food stays on train
        expect(station.stockpile.get(ResourceType.FOOD)).toBe(0);
    });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test test/economy/cargo-slot.test.ts test/economy/station-cargo.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 4: Implement cargo-slot.ts**

```typescript
// src/economy/cargo-slot.ts
import type { ResourceType } from './types';

export interface CargoSlot {
    resourceType: ResourceType | null;
    quantity: number;
    readonly capacity: number;
}

export function createCargoSlot(capacity: number): CargoSlot {
    return { resourceType: null, quantity: 0, capacity };
}

export function loadCargo(slot: CargoSlot, resource: ResourceType, amount: number): number {
    if (slot.resourceType !== null && slot.resourceType !== resource) {
        return 0; // can't mix resources
    }
    const space = slot.capacity - slot.quantity;
    const loaded = Math.min(amount, space);
    if (loaded <= 0) return 0;

    slot.resourceType = resource;
    slot.quantity += loaded;
    return loaded;
}

export function unloadCargo(
    slot: CargoSlot,
    amount: number
): { resource: ResourceType | null; quantity: number } {
    if (slot.resourceType === null || slot.quantity <= 0) {
        return { resource: null, quantity: 0 };
    }

    const unloaded = Math.min(amount, slot.quantity);
    const resource = slot.resourceType;
    slot.quantity -= unloaded;

    if (slot.quantity <= 0) {
        slot.resourceType = null;
        slot.quantity = 0;
    }

    return { resource, quantity: unloaded };
}

export interface SerializedCargoSlot {
    resourceType: string | null;
    quantity: number;
    capacity: number;
}

export function serializeCargoSlot(slot: CargoSlot): SerializedCargoSlot {
    return {
        resourceType: slot.resourceType,
        quantity: slot.quantity,
        capacity: slot.capacity,
    };
}

export function deserializeCargoSlot(data: SerializedCargoSlot): CargoSlot {
    return {
        resourceType: data.resourceType as ResourceType | null,
        quantity: data.quantity,
        capacity: data.capacity,
    };
}
```

- [ ] **Step 5: Implement station-cargo.ts**

```typescript
// src/economy/station-cargo.ts
import type { CargoSlot } from './cargo-slot';
import { loadCargo, unloadCargo } from './cargo-slot';
import type { StationEconomyData } from './simulation-state';

export interface TrainCargo {
    readonly slots: CargoSlot[];
}

export function processTrainAtStation(
    trainCargo: TrainCargo,
    station: StationEconomyData
): void {
    // Phase 1: Unload — remove cargo from train into station stockpile
    for (const slot of trainCargo.slots) {
        if (slot.resourceType === null || slot.quantity <= 0) continue;

        const shouldUnload =
            station.autoMode || station.unloadRules.has(slot.resourceType);
        if (!shouldUnload) continue;

        const { resource, quantity } = unloadCargo(slot, slot.quantity);
        if (resource !== null && quantity > 0) {
            station.stockpile.add(resource, quantity);
        }
    }

    // Phase 2: Load — fill empty/partial slots from station stockpile
    for (const slot of trainCargo.slots) {
        const space = slot.capacity - slot.quantity;
        if (space <= 0) continue;

        if (station.autoMode) {
            // Load whatever the station has
            for (const [resource, available] of station.stockpile.entries()) {
                if (available <= 0) continue;
                if (slot.resourceType !== null && slot.resourceType !== resource) continue;

                const taken = station.stockpile.remove(resource, space);
                loadCargo(slot, resource, taken);
                break;
            }
        } else {
            // Load only resources in load rules
            for (const resource of station.loadRules) {
                if (slot.resourceType !== null && slot.resourceType !== resource) continue;

                const available = station.stockpile.get(resource);
                if (available <= 0) continue;

                const taken = station.stockpile.remove(resource, space);
                loadCargo(slot, resource, taken);
                break;
            }
        }
    }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test test/economy/cargo-slot.test.ts test/economy/station-cargo.test.ts`
Expected: All 11 tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/economy/cargo-slot.ts src/economy/station-cargo.ts test/economy/cargo-slot.test.ts test/economy/station-cargo.test.ts
git commit -m "feat(economy): add cargo slot and station load/unload logic"
```

---

## Task 10: Economy Manager (Top-Level Facade)

**Files:**
- Create: `src/economy/industry-manager.ts`
- Create: `src/economy/zone-manager.ts`
- Create: `src/economy/city-growth-manager.ts`
- Create: `src/economy/resource-manager.ts`
- Create: `src/economy/economy-manager.ts`
- Test: `test/economy/industry-manager.test.ts`
- Test: `test/economy/zone-manager.test.ts`

- [ ] **Step 1: Write failing tests for IndustryManager**

```typescript
// test/economy/industry-manager.test.ts
import { describe, it, expect, beforeEach } from 'bun:test';
import { IndustryManager } from '../../src/economy/industry-manager';
import { IndustryType } from '../../src/economy/types';
import { createEconomyState, type EconomyState } from '../../src/economy/simulation-state';

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
        manager.onAdd((id) => { notifiedId = id; });
        const id = manager.addIndustry(IndustryType.FARM, { x: 0, y: 0 });
        expect(notifiedId).toBe(id);
    });

    it('notifies on remove', () => {
        let notifiedId: number | null = null;
        manager.onRemove((id) => { notifiedId = id; });
        const id = manager.addIndustry(IndustryType.FARM, { x: 0, y: 0 });
        manager.removeIndustry(id);
        expect(notifiedId).toBe(id);
    });
});
```

- [ ] **Step 2: Write failing tests for ZoneManager**

```typescript
// test/economy/zone-manager.test.ts
import { describe, it, expect, beforeEach } from 'bun:test';
import { ZoneManager } from '../../src/economy/zone-manager';
import { ZoneType } from '../../src/economy/types';
import { createEconomyState, type EconomyState } from '../../src/economy/simulation-state';

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
        expect(manager.getSatisfaction(id)).toBe(0.5); // default
    });

    it('lists all zones', () => {
        manager.addZone(ZoneType.RESIDENTIAL, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]);
        manager.addZone(ZoneType.COMMERCIAL, [{ x: 2, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 1 }]);
        expect(manager.getAllZones().length).toBe(2);
    });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test test/economy/industry-manager.test.ts test/economy/zone-manager.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 4: Implement IndustryManager**

```typescript
// src/economy/industry-manager.ts
import type { Point } from '@ue-too/math';
import type { IndustryType } from './types';
import { Stockpile } from './stockpile';
import type { EconomyState, IndustryEntity } from './simulation-state';

type Callback<T extends unknown[]> = (...args: T) => void;

export class IndustryManager {
    private _state: EconomyState;
    private _addCallbacks: Callback<[number, IndustryEntity]>[] = [];
    private _removeCallbacks: Callback<[number]>[] = [];

    constructor(state: EconomyState) {
        this._state = state;
    }

    addIndustry(type: IndustryType, position: Point): number {
        const id = this._state.nextIndustryId++;
        const industry: IndustryEntity = {
            id,
            type,
            position,
            assignedStationId: null,
            workerCount: 0,
            stockpile: new Stockpile(),
        };
        this._state.industries.set(id, industry);
        for (const cb of this._addCallbacks) cb(id, industry);
        return id;
    }

    removeIndustry(id: number): void {
        if (!this._state.industries.has(id)) return;
        this._state.industries.delete(id);
        for (const cb of this._removeCallbacks) cb(id);
    }

    getIndustry(id: number): IndustryEntity | null {
        return this._state.industries.get(id) ?? null;
    }

    assignStation(industryId: number, stationId: number | null): void {
        const industry = this._state.industries.get(industryId);
        if (!industry) return;
        industry.assignedStationId = stationId;
    }

    getAllIndustries(): IndustryEntity[] {
        return Array.from(this._state.industries.values());
    }

    onAdd(callback: Callback<[number, IndustryEntity]>): void {
        this._addCallbacks.push(callback);
    }

    onRemove(callback: Callback<[number]>): void {
        this._removeCallbacks.push(callback);
    }
}
```

- [ ] **Step 5: Implement ZoneManager**

```typescript
// src/economy/zone-manager.ts
import type { Point } from '@ue-too/math';
import type { ZoneType } from './types';
import type { EconomyState, ZoneEntity } from './simulation-state';

type Callback<T extends unknown[]> = (...args: T) => void;

export class ZoneManager {
    private _state: EconomyState;
    private _addCallbacks: Callback<[number, ZoneEntity]>[] = [];
    private _removeCallbacks: Callback<[number]>[] = [];

    constructor(state: EconomyState) {
        this._state = state;
    }

    addZone(type: ZoneType, boundary: Point[]): number {
        const id = this._state.nextZoneId++;
        const zone: ZoneEntity = {
            id,
            type,
            boundary,
            population: 0,
            satisfaction: 0.5,
            satisfactionHistory: [],
            demandPerMinute: new Map(),
        };
        this._state.zones.set(id, zone);
        for (const cb of this._addCallbacks) cb(id, zone);
        return id;
    }

    removeZone(id: number): void {
        if (!this._state.zones.has(id)) return;
        this._state.zones.delete(id);
        for (const cb of this._removeCallbacks) cb(id);
    }

    getZone(id: number): ZoneEntity | null {
        return this._state.zones.get(id) ?? null;
    }

    getSatisfaction(id: number): number {
        const zone = this._state.zones.get(id);
        if (!zone) return 0;
        return zone.satisfaction;
    }

    getAllZones(): ZoneEntity[] {
        return Array.from(this._state.zones.values());
    }

    onAdd(callback: Callback<[number, ZoneEntity]>): void {
        this._addCallbacks.push(callback);
    }

    onRemove(callback: Callback<[number]>): void {
        this._removeCallbacks.push(callback);
    }
}
```

- [ ] **Step 6: Implement CityGrowthManager**

```typescript
// src/economy/city-growth-manager.ts
import type { EconomyState, CityCluster } from './simulation-state';

export class CityGrowthManager {
    private _state: EconomyState;

    constructor(state: EconomyState) {
        this._state = state;
    }

    /**
     * Recomputes city clusters from zone and station proximity.
     * Call after zones or stations change.
     */
    recomputeClusters(getZoneStation: (zoneId: number) => number | null): void {
        this._state.cities.clear();
        this._state.nextCityId = 1;

        // Group zones by their station
        const stationZones = new Map<number, Set<number>>();
        for (const zone of this._state.zones.values()) {
            const stationId = getZoneStation(zone.id);
            if (stationId === null) continue;

            if (!stationZones.has(stationId)) {
                stationZones.set(stationId, new Set());
            }
            stationZones.get(stationId)!.add(zone.id);
        }

        // Each station group becomes a city cluster
        for (const [stationId, zoneIds] of stationZones) {
            if (zoneIds.size === 0) continue;
            const cityId = this._state.nextCityId++;
            const cluster: CityCluster = {
                id: cityId,
                zoneIds,
                stationIds: new Set([stationId]),
                reputation: this._computeReputation(zoneIds),
            };
            this._state.cities.set(cityId, cluster);
        }
    }

    getCity(id: number): CityCluster | null {
        return this._state.cities.get(id) ?? null;
    }

    getAllCities(): CityCluster[] {
        return Array.from(this._state.cities.values());
    }

    updateReputations(): void {
        for (const city of this._state.cities.values()) {
            city.reputation = this._computeReputation(city.zoneIds);
        }
    }

    private _computeReputation(zoneIds: Set<number>): number {
        let totalSatisfaction = 0;
        let totalPopulation = 0;

        for (const zoneId of zoneIds) {
            const zone = this._state.zones.get(zoneId);
            if (!zone) continue;
            totalSatisfaction += zone.satisfaction * zone.population;
            totalPopulation += zone.population;
        }

        if (totalPopulation === 0) return 0.5;
        return totalSatisfaction / totalPopulation;
    }
}
```

- [ ] **Step 7: Implement ResourceManager**

```typescript
// src/economy/resource-manager.ts
import type { EconomyState } from './simulation-state';
import { ResourceType } from './types';

export interface ResourceFlowSummary {
    totalSupply: Map<ResourceType, number>;
    totalDemand: Map<ResourceType, number>;
}

export class ResourceManager {
    private _state: EconomyState;

    constructor(state: EconomyState) {
        this._state = state;
    }

    getStationStockpile(stationId: number): Map<ResourceType, number> | null {
        const data = this._state.stationEconomy.get(stationId);
        if (!data) return null;
        const result = new Map<ResourceType, number>();
        for (const [resource, qty] of data.stockpile.entries()) {
            result.set(resource, qty);
        }
        return result;
    }

    getGlobalSummary(): ResourceFlowSummary {
        const totalSupply = new Map<ResourceType, number>();
        const totalDemand = new Map<ResourceType, number>();

        // Supply = all station stockpiles
        for (const stationData of this._state.stationEconomy.values()) {
            for (const [resource, qty] of stationData.stockpile.entries()) {
                totalSupply.set(resource, (totalSupply.get(resource) ?? 0) + qty);
            }
        }

        // Demand = all zone demand rates
        for (const zone of this._state.zones.values()) {
            for (const [resource, rate] of zone.demandPerMinute) {
                totalDemand.set(resource, (totalDemand.get(resource) ?? 0) + rate);
            }
        }

        return { totalSupply, totalDemand };
    }
}
```

- [ ] **Step 8: Implement EconomyManager**

```typescript
// src/economy/economy-manager.ts
import type { Point } from '@ue-too/math';
import {
    createEconomyState,
    type EconomyState,
    type StationEconomyData,
    DEFAULT_SERVICE_RADIUS,
} from './simulation-state';
import { simulationTick } from './simulation-tick';
import type { GrowthEvent } from './systems/growth-system';
import type { ZoneStationLookup } from './systems/transfer-system';
import { IndustryManager } from './industry-manager';
import { ZoneManager } from './zone-manager';
import { CityGrowthManager } from './city-growth-manager';
import { ResourceManager } from './resource-manager';
import { Stockpile } from './stockpile';
import type { ResourceType } from './types';

export interface SerializedEconomyData {
    state: unknown; // full economy state serialization
}

export class EconomyManager {
    private _state: EconomyState;
    private _getZoneStation: ZoneStationLookup;

    readonly industries: IndustryManager;
    readonly zones: ZoneManager;
    readonly cityGrowth: CityGrowthManager;
    readonly resources: ResourceManager;

    constructor(getZoneStation: ZoneStationLookup) {
        this._state = createEconomyState();
        this._getZoneStation = getZoneStation;

        this.industries = new IndustryManager(this._state);
        this.zones = new ZoneManager(this._state);
        this.cityGrowth = new CityGrowthManager(this._state);
        this.resources = new ResourceManager(this._state);
    }

    update(deltaMinutes: number): GrowthEvent[] {
        const events = simulationTick(this._state, deltaMinutes, this._getZoneStation);
        this.cityGrowth.updateReputations();
        return events;
    }

    registerStation(stationId: number): void {
        if (this._state.stationEconomy.has(stationId)) return;
        const data: StationEconomyData = {
            stationId,
            stockpile: new Stockpile(),
            serviceRadius: DEFAULT_SERVICE_RADIUS,
            loadRules: new Set(),
            unloadRules: new Set(),
            autoMode: false,
        };
        this._state.stationEconomy.set(stationId, data);
    }

    unregisterStation(stationId: number): void {
        this._state.stationEconomy.delete(stationId);
        // Orphan industries assigned to this station
        for (const industry of this._state.industries.values()) {
            if (industry.assignedStationId === stationId) {
                industry.assignedStationId = null;
            }
        }
    }

    getStationEconomy(stationId: number): StationEconomyData | null {
        return this._state.stationEconomy.get(stationId) ?? null;
    }

    setLoadRule(stationId: number, resource: ResourceType, enabled: boolean): void {
        const data = this._state.stationEconomy.get(stationId);
        if (!data) return;
        if (enabled) {
            data.loadRules.add(resource);
        } else {
            data.loadRules.delete(resource);
        }
    }

    setUnloadRule(stationId: number, resource: ResourceType, enabled: boolean): void {
        const data = this._state.stationEconomy.get(stationId);
        if (!data) return;
        if (enabled) {
            data.unloadRules.add(resource);
        } else {
            data.unloadRules.delete(resource);
        }
    }

    setAutoMode(stationId: number, auto: boolean): void {
        const data = this._state.stationEconomy.get(stationId);
        if (!data) return;
        data.autoMode = auto;
    }

    /**
     * Resolve which station serves a given world position,
     * based on distance to station positions and service radius.
     */
    findNearestStation(
        position: Point,
        stationPositions: Map<number, Point>
    ): number | null {
        let bestId: number | null = null;
        let bestDist = Infinity;

        for (const [stationId, stationPos] of stationPositions) {
            const data = this._state.stationEconomy.get(stationId);
            if (!data) continue;

            const dx = position.x - stationPos.x;
            const dy = position.y - stationPos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist <= data.serviceRadius && dist < bestDist) {
                bestDist = dist;
                bestId = stationId;
            }
        }

        return bestId;
    }

    clearForLoad(): void {
        this._state.industries.clear();
        this._state.zones.clear();
        this._state.cities.clear();
        this._state.stationEconomy.clear();
        this._state.nextIndustryId = 1;
        this._state.nextZoneId = 1;
        this._state.nextCityId = 1;
    }

    get state(): EconomyState {
        return this._state;
    }
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `bun test test/economy/industry-manager.test.ts test/economy/zone-manager.test.ts`
Expected: All 10 tests PASS

- [ ] **Step 10: Commit**

```bash
git add src/economy/industry-manager.ts src/economy/zone-manager.ts src/economy/city-growth-manager.ts src/economy/resource-manager.ts src/economy/economy-manager.ts test/economy/industry-manager.test.ts test/economy/zone-manager.test.ts
git commit -m "feat(economy): add manager facades and top-level economy manager"
```

---

## Task 11: Serialization Integration

**Files:**
- Create: `src/economy/economy-serialization.ts`
- Modify: `src/scene-serialization.ts`
- Test: `test/economy/economy-serialization.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// test/economy/economy-serialization.test.ts
import { describe, it, expect } from 'bun:test';
import {
    serializeEconomy,
    deserializeEconomy,
} from '../../src/economy/economy-serialization';
import { EconomyManager } from '../../src/economy/economy-manager';
import { IndustryType, ResourceType, ZoneType } from '../../src/economy/types';

describe('Economy Serialization', () => {
    it('round-trips industries', () => {
        const manager = new EconomyManager(() => 1);
        manager.registerStation(1);
        const id = manager.industries.addIndustry(IndustryType.FARM, { x: 10, y: 20 });
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/economy/economy-serialization.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement economy-serialization.ts**

```typescript
// src/economy/economy-serialization.ts
import type { EconomyManager } from './economy-manager';
import type { IndustryType, ResourceType, ZoneType } from './types';
import { Stockpile } from './stockpile';
import type { SerializedStockpile } from './types';

interface SerializedIndustry {
    id: number;
    type: string;
    position: { x: number; y: number };
    assignedStationId: number | null;
    workerCount: number;
    stockpile: SerializedStockpile;
}

interface SerializedZone {
    id: number;
    type: string;
    boundary: { x: number; y: number }[];
    population: number;
    satisfaction: number;
    satisfactionHistory: number[];
}

interface SerializedStationEconomy {
    stationId: number;
    stockpile: SerializedStockpile;
    serviceRadius: number;
    loadRules: string[];
    unloadRules: string[];
    autoMode: boolean;
}

export interface SerializedEconomyData {
    industries: SerializedIndustry[];
    zones: SerializedZone[];
    stationEconomy: SerializedStationEconomy[];
    nextIndustryId: number;
    nextZoneId: number;
}

export function serializeEconomy(manager: EconomyManager): SerializedEconomyData {
    const state = manager.state;

    const industries: SerializedIndustry[] = [];
    for (const ind of state.industries.values()) {
        industries.push({
            id: ind.id,
            type: ind.type,
            position: { x: ind.position.x, y: ind.position.y },
            assignedStationId: ind.assignedStationId,
            workerCount: ind.workerCount,
            stockpile: ind.stockpile.serialize(),
        });
    }

    const zones: SerializedZone[] = [];
    for (const zone of state.zones.values()) {
        zones.push({
            id: zone.id,
            type: zone.type,
            boundary: zone.boundary.map(p => ({ x: p.x, y: p.y })),
            population: zone.population,
            satisfaction: zone.satisfaction,
            satisfactionHistory: [...zone.satisfactionHistory],
        });
    }

    const stationEconomy: SerializedStationEconomy[] = [];
    for (const sd of state.stationEconomy.values()) {
        stationEconomy.push({
            stationId: sd.stationId,
            stockpile: sd.stockpile.serialize(),
            serviceRadius: sd.serviceRadius,
            loadRules: Array.from(sd.loadRules),
            unloadRules: Array.from(sd.unloadRules),
            autoMode: sd.autoMode,
        });
    }

    return {
        industries,
        zones,
        stationEconomy,
        nextIndustryId: state.nextIndustryId,
        nextZoneId: state.nextZoneId,
    };
}

export function deserializeEconomy(
    manager: EconomyManager,
    data: SerializedEconomyData
): void {
    manager.clearForLoad();
    const state = manager.state;

    // Restore station economy data first (industries reference stations)
    for (const sd of data.stationEconomy) {
        manager.registerStation(sd.stationId);
        const stationData = manager.getStationEconomy(sd.stationId)!;
        const stockpile = Stockpile.deserialize(sd.stockpile);
        for (const [resource, qty] of stockpile.entries()) {
            stationData.stockpile.add(resource, qty);
        }
        stationData.serviceRadius = sd.serviceRadius;
        stationData.autoMode = sd.autoMode;
        for (const rule of sd.loadRules) {
            stationData.loadRules.add(rule as ResourceType);
        }
        for (const rule of sd.unloadRules) {
            stationData.unloadRules.add(rule as ResourceType);
        }
    }

    // Restore industries
    for (const ind of data.industries) {
        const id = manager.industries.addIndustry(
            ind.type as IndustryType,
            ind.position
        );
        if (ind.assignedStationId !== null) {
            manager.industries.assignStation(id, ind.assignedStationId);
        }
        const industry = manager.industries.getIndustry(id)!;
        industry.workerCount = ind.workerCount;
        const stockpile = Stockpile.deserialize(ind.stockpile);
        for (const [resource, qty] of stockpile.entries()) {
            industry.stockpile.add(resource, qty);
        }
    }

    // Restore zones
    for (const z of data.zones) {
        const id = manager.zones.addZone(z.type as ZoneType, z.boundary);
        const zone = manager.zones.getZone(id)!;
        zone.population = z.population;
        zone.satisfaction = z.satisfaction;
        zone.satisfactionHistory.push(...z.satisfactionHistory);
    }

    // Restore ID counters
    state.nextIndustryId = data.nextIndustryId;
    state.nextZoneId = data.nextZoneId;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/economy/economy-serialization.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Modify scene-serialization.ts to include economy data**

Read the current `SerializedSceneData` type and `serializeSceneData`/`deserializeSceneData` functions in `src/scene-serialization.ts`. Add the `economy` field:

In the `SerializedSceneData` type, add:
```typescript
economy?: SerializedEconomyData;
```

In `serializeSceneData`, add:
```typescript
economy: serializeEconomy(app.economyManager),
```

In the deserialization function, add (with optional check for backward compatibility):
```typescript
if (data.economy) {
    deserializeEconomy(app.economyManager, data.economy);
}
```

Import `serializeEconomy`, `deserializeEconomy`, and `SerializedEconomyData` from `../economy/economy-serialization`.

- [ ] **Step 6: Commit**

```bash
git add src/economy/economy-serialization.ts test/economy/economy-serialization.test.ts src/scene-serialization.ts
git commit -m "feat(economy): add economy serialization and integrate with scene save/load"
```

---

## Task 12: Wire EconomyManager into init-app.ts

**Files:**
- Modify: `src/utils/init-app.ts`

- [ ] **Step 1: Read current init-app.ts structure**

Read `src/utils/init-app.ts` to find:
- The `BananaAppComponents` type definition (around line 269)
- Where managers are instantiated (around lines 634-704)
- The `TimeManager` subscription block (around lines 880-894)
- The cleanup/disposal block (around lines 900-906)

- [ ] **Step 2: Add EconomyManager to BananaAppComponents type**

Add to the type definition:
```typescript
economyManager: EconomyManager;
```

- [ ] **Step 3: Instantiate EconomyManager after StationManager**

After station manager creation and before the TimeManager subscription block, add:

```typescript
// Economy system
const economyManager = new EconomyManager((zoneId) => {
    // Spatial lookup: find which station serves this zone
    const zone = economyManager.zones.getZone(zoneId);
    if (!zone) return null;
    // Use zone centroid as position
    const centroid = {
        x: zone.boundary.reduce((sum, p) => sum + p.x, 0) / zone.boundary.length,
        y: zone.boundary.reduce((sum, p) => sum + p.y, 0) / zone.boundary.length,
    };
    const stationPositions = new Map<number, Point>();
    for (const { index, entity } of stationManager.getLivingEntitiesWithIndex()) {
        stationPositions.set(index, entity.position);
    }
    return economyManager.findNearestStation(centroid, stationPositions);
});

// Register existing stations
for (const { index } of stationManager.getLivingEntitiesWithIndex()) {
    economyManager.registerStation(index);
}

// Auto-register/unregister stations
stationManager.onAdd((id) => {
    economyManager.registerStation(id);
});
stationManager.setOnDestroyStation((stationId) => {
    economyManager.unregisterStation(stationId);
    // ... existing cascade logic stays here
});
```

- [ ] **Step 4: Add economy tick to TimeManager subscription**

Inside the existing `timeManager.subscribe(...)` callback, add:

```typescript
// Convert deltaTime from ms to game-minutes based on time scale
const deltaMinutes = deltaTime / 60000; // deltaTime is in ms after scaling
economyManager.update(deltaMinutes);
```

- [ ] **Step 5: Add EconomyManager to the returned components object**

Add `economyManager` to the return object alongside other managers.

- [ ] **Step 6: Commit**

```bash
git add src/utils/init-app.ts
git commit -m "feat(economy): wire economy manager into app initialization and time loop"
```

---

## Task 13: Economy UI Store

**Files:**
- Create: `src/stores/economy-ui-store.ts`

- [ ] **Step 1: Implement economy UI store**

```typescript
// src/stores/economy-ui-store.ts
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

type EconomyUIState = {
    resourceOverlayVisible: boolean;
    selectedZoneId: number | null;
    selectedIndustryId: number | null;
    cityOverviewOpen: boolean;
};

type EconomyUIActions = {
    toggleResourceOverlay: () => void;
    selectZone: (id: number | null) => void;
    selectIndustry: (id: number | null) => void;
    toggleCityOverview: () => void;
    clearSelection: () => void;
};

export type EconomyUIStore = EconomyUIState & EconomyUIActions;

export const useEconomyUIStore = create<EconomyUIStore>()(
    devtools(
        (set) => ({
            resourceOverlayVisible: false,
            selectedZoneId: null,
            selectedIndustryId: null,
            cityOverviewOpen: false,

            toggleResourceOverlay: () =>
                set((state) => ({
                    resourceOverlayVisible: !state.resourceOverlayVisible,
                })),

            selectZone: (id) =>
                set({ selectedZoneId: id, selectedIndustryId: null }),

            selectIndustry: (id) =>
                set({ selectedIndustryId: id, selectedZoneId: null }),

            toggleCityOverview: () =>
                set((state) => ({
                    cityOverviewOpen: !state.cityOverviewOpen,
                })),

            clearSelection: () =>
                set({ selectedZoneId: null, selectedIndustryId: null }),
        }),
        { name: 'banana-economy-ui' }
    )
);
```

- [ ] **Step 2: Commit**

```bash
git add src/stores/economy-ui-store.ts
git commit -m "feat(economy): add economy UI zustand store"
```

---

## Task 14: Zone Placement State Machine

**Files:**
- Create: `src/economy/zone-placement-state-machine.ts`

- [ ] **Step 1: Read existing state machine for reference**

Read `src/stations/station-placement-state-machine.ts` for the exact import paths and patterns for `TemplateState`, `TemplateStateMachine`, `EventReactions`, `BaseContext`, `NO_OP`, and `Defer` from `@ue-too/being`.

- [ ] **Step 2: Implement zone placement state machine**

```typescript
// src/economy/zone-placement-state-machine.ts
import {
    TemplateState,
    TemplateStateMachine,
    type EventReactions,
    type BaseContext,
    NO_OP,
} from '@ue-too/being';
import type { Point } from '@ue-too/math';
import type { ZoneType } from './types';

export const ZONE_PLACEMENT_STATES = [
    'IDLE',
    'DRAWING_BOUNDARY',
    'CONFIRMING_TYPE',
] as const;

export type ZonePlacementStates = (typeof ZONE_PLACEMENT_STATES)[number];

export type ZonePlacementEvents = {
    startZonePlacement: {};
    pointerDown: { x: number; y: number };
    pointerMove: { x: number; y: number };
    doubleClick: { x: number; y: number };
    confirmType: { zoneType: ZoneType };
    cancel: {};
    endZonePlacement: {};
};

export interface ZonePlacementContext extends BaseContext {
    addBoundaryPoint: (position: Point) => void;
    updatePreview: (position: Point) => void;
    closeBoundary: (position: Point) => void;
    confirmZone: (type: ZoneType) => void;
    cancelPlacement: () => void;
    clearPreview: () => void;
    convert2WorldPosition: (position: Point) => Point;
}

class IdleState extends TemplateState<
    ZonePlacementEvents,
    ZonePlacementContext,
    ZonePlacementStates
> {
    protected _eventReactions: EventReactions<
        ZonePlacementEvents,
        ZonePlacementContext,
        ZonePlacementStates
    > = {
        startZonePlacement: {
            action: NO_OP,
            defaultTargetState: 'DRAWING_BOUNDARY',
        },
    };
}

class DrawingBoundaryState extends TemplateState<
    ZonePlacementEvents,
    ZonePlacementContext,
    ZonePlacementStates
> {
    protected _eventReactions: EventReactions<
        ZonePlacementEvents,
        ZonePlacementContext,
        ZonePlacementStates
    > = {
        pointerDown: {
            action: (context, event) => {
                const worldPos = context.convert2WorldPosition({ x: event.x, y: event.y });
                context.addBoundaryPoint(worldPos);
            },
        },
        pointerMove: {
            action: (context, event) => {
                const worldPos = context.convert2WorldPosition({ x: event.x, y: event.y });
                context.updatePreview(worldPos);
            },
        },
        doubleClick: {
            action: (context, event) => {
                const worldPos = context.convert2WorldPosition({ x: event.x, y: event.y });
                context.closeBoundary(worldPos);
            },
            defaultTargetState: 'CONFIRMING_TYPE',
        },
        cancel: {
            action: (context) => {
                context.cancelPlacement();
            },
            defaultTargetState: 'IDLE',
        },
        endZonePlacement: {
            action: (context) => {
                context.cancelPlacement();
            },
            defaultTargetState: 'IDLE',
        },
    };
}

class ConfirmingTypeState extends TemplateState<
    ZonePlacementEvents,
    ZonePlacementContext,
    ZonePlacementStates
> {
    protected _eventReactions: EventReactions<
        ZonePlacementEvents,
        ZonePlacementContext,
        ZonePlacementStates
    > = {
        confirmType: {
            action: (context, event) => {
                context.confirmZone(event.zoneType);
                context.clearPreview();
            },
            defaultTargetState: 'IDLE',
        },
        cancel: {
            action: (context) => {
                context.cancelPlacement();
            },
            defaultTargetState: 'IDLE',
        },
        endZonePlacement: {
            action: (context) => {
                context.cancelPlacement();
            },
            defaultTargetState: 'IDLE',
        },
    };
}

export class ZonePlacementStateMachine extends TemplateStateMachine<
    ZonePlacementEvents,
    ZonePlacementContext,
    ZonePlacementStates
> {
    constructor(context: ZonePlacementContext) {
        super(
            {
                IDLE: new IdleState(),
                DRAWING_BOUNDARY: new DrawingBoundaryState(),
                CONFIRMING_TYPE: new ConfirmingTypeState(),
            },
            'IDLE',
            context
        );
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/economy/zone-placement-state-machine.ts
git commit -m "feat(economy): add zone placement state machine"
```

---

## Task 15: Industry Placement State Machine

**Files:**
- Create: `src/economy/industry-placement-state-machine.ts`

- [ ] **Step 1: Implement industry placement state machine**

```typescript
// src/economy/industry-placement-state-machine.ts
import {
    TemplateState,
    TemplateStateMachine,
    type EventReactions,
    type BaseContext,
    NO_OP,
} from '@ue-too/being';
import type { Point } from '@ue-too/math';
import type { IndustryType } from './types';

export const INDUSTRY_PLACEMENT_STATES = [
    'IDLE',
    'SELECTING_TYPE',
    'POSITIONING',
] as const;

export type IndustryPlacementStates = (typeof INDUSTRY_PLACEMENT_STATES)[number];

export type IndustryPlacementEvents = {
    startIndustryPlacement: {};
    selectType: { industryType: IndustryType };
    pointerMove: { x: number; y: number };
    pointerDown: { x: number; y: number };
    cancel: {};
    endIndustryPlacement: {};
};

export interface IndustryPlacementContext extends BaseContext {
    showTypeSelector: () => void;
    hideTypeSelector: () => void;
    setSelectedType: (type: IndustryType) => void;
    updateGhostPosition: (position: Point) => void;
    showServiceRadiusOverlay: (position: Point) => void;
    placeIndustry: (position: Point) => void;
    clearGhost: () => void;
    convert2WorldPosition: (position: Point) => Point;
}

class IdleState extends TemplateState<
    IndustryPlacementEvents,
    IndustryPlacementContext,
    IndustryPlacementStates
> {
    protected _eventReactions: EventReactions<
        IndustryPlacementEvents,
        IndustryPlacementContext,
        IndustryPlacementStates
    > = {
        startIndustryPlacement: {
            action: (context) => {
                context.showTypeSelector();
            },
            defaultTargetState: 'SELECTING_TYPE',
        },
    };
}

class SelectingTypeState extends TemplateState<
    IndustryPlacementEvents,
    IndustryPlacementContext,
    IndustryPlacementStates
> {
    protected _eventReactions: EventReactions<
        IndustryPlacementEvents,
        IndustryPlacementContext,
        IndustryPlacementStates
    > = {
        selectType: {
            action: (context, event) => {
                context.setSelectedType(event.industryType);
                context.hideTypeSelector();
            },
            defaultTargetState: 'POSITIONING',
        },
        cancel: {
            action: (context) => {
                context.hideTypeSelector();
            },
            defaultTargetState: 'IDLE',
        },
        endIndustryPlacement: {
            action: (context) => {
                context.hideTypeSelector();
            },
            defaultTargetState: 'IDLE',
        },
    };
}

class PositioningState extends TemplateState<
    IndustryPlacementEvents,
    IndustryPlacementContext,
    IndustryPlacementStates
> {
    protected _eventReactions: EventReactions<
        IndustryPlacementEvents,
        IndustryPlacementContext,
        IndustryPlacementStates
    > = {
        pointerMove: {
            action: (context, event) => {
                const worldPos = context.convert2WorldPosition({ x: event.x, y: event.y });
                context.updateGhostPosition(worldPos);
                context.showServiceRadiusOverlay(worldPos);
            },
        },
        pointerDown: {
            action: (context, event) => {
                const worldPos = context.convert2WorldPosition({ x: event.x, y: event.y });
                context.placeIndustry(worldPos);
                context.clearGhost();
            },
            defaultTargetState: 'IDLE',
        },
        cancel: {
            action: (context) => {
                context.clearGhost();
            },
            defaultTargetState: 'IDLE',
        },
        endIndustryPlacement: {
            action: (context) => {
                context.clearGhost();
            },
            defaultTargetState: 'IDLE',
        },
    };
}

export class IndustryPlacementStateMachine extends TemplateStateMachine<
    IndustryPlacementEvents,
    IndustryPlacementContext,
    IndustryPlacementStates
> {
    constructor(context: IndustryPlacementContext) {
        super(
            {
                IDLE: new IdleState(),
                SELECTING_TYPE: new SelectingTypeState(),
                POSITIONING: new PositioningState(),
            },
            'IDLE',
            context
        );
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/economy/industry-placement-state-machine.ts
git commit -m "feat(economy): add industry placement state machine"
```

---

## Task 16: Add Zone and Industry Tools to ToolSwitcher

**Files:**
- Modify: `src/trains/input-state-machine/tool-switcher-state-machine.ts`

- [ ] **Step 1: Read current tool-switcher-state-machine.ts**

Read the file fully to understand the current `TOOL_SWITCHER_STATES` array, `ToolSwitcherEvents` type, and how states are constructed.

- [ ] **Step 2: Add ZONE and INDUSTRY to states and events**

Add `'ZONE'` and `'INDUSTRY'` to the `TOOL_SWITCHER_STATES` array.

Add to `ToolSwitcherEvents`:
```typescript
switchToZone: {};
switchToIndustry: {};
```

- [ ] **Step 3: Add ToolSwitcherZoneState and ToolSwitcherIndustryState classes**

Follow the existing pattern (e.g., `ToolSwitcherStationState`). Each state holds a reference to its sub-state-machine and delegates events via `uponEnter`/`beforeExit`:

```typescript
class ToolSwitcherZoneState extends TemplateState<
    ToolSwitcherEvents,
    ToolSwitcherContext,
    ToolSwitcherStates
> {
    private _zoneSM: ZonePlacementStateMachine;

    constructor(zoneSM: ZonePlacementStateMachine) {
        super();
        this._zoneSM = zoneSM;
    }

    public uponEnter(
        context: ToolSwitcherContext,
        stateMachine: ToolSwitcherStateMachine,
        fromState: ToolSwitcherStates
    ): void {
        this._zoneSM.happens('startZonePlacement');
    }

    public beforeExit(
        context: ToolSwitcherContext,
        stateMachine: ToolSwitcherStateMachine,
        toState: ToolSwitcherStates
    ): void {
        this._zoneSM.happens('endZonePlacement');
    }

    protected _eventReactions: EventReactions<
        ToolSwitcherEvents,
        ToolSwitcherContext,
        ToolSwitcherStates
    > = {};
}
```

Same pattern for `ToolSwitcherIndustryState` with `IndustryPlacementStateMachine`.

- [ ] **Step 4: Register new states in the ToolSwitcherStateMachine constructor**

Add the new states to the state map passed to `super()`.

- [ ] **Step 5: Commit**

```bash
git add src/trains/input-state-machine/tool-switcher-state-machine.ts
git commit -m "feat(economy): add zone and industry tools to tool switcher"
```

---

## Task 17: Zone Render System

**Files:**
- Create: `src/economy/zone-render-system.ts`

- [ ] **Step 1: Read building-render-system.ts for the exact pattern**

Read `src/buildings/render-system.ts` to understand the `WorldRenderSystem` API, how graphics are added to render bands, and the subscribe/dispose pattern.

- [ ] **Step 2: Implement zone render system**

```typescript
// src/economy/zone-render-system.ts
import { Graphics } from 'pixi.js';
import type { WorldRenderSystem } from '../trains/tracks/render-system';
import type { ZoneManager } from './zone-manager';
import type { ZoneEntity } from './simulation-state';
import { ZoneType } from './types';

const ZONE_COLORS: Record<ZoneType, { fill: number; alpha: number; stroke: number }> = {
    [ZoneType.RESIDENTIAL]: { fill: 0x4caf50, alpha: 0.2, stroke: 0x4caf50 },
    [ZoneType.COMMERCIAL]: { fill: 0x2196f3, alpha: 0.2, stroke: 0x2196f3 },
    [ZoneType.INDUSTRIAL]: { fill: 0xff9800, alpha: 0.2, stroke: 0xff9800 },
};

export class ZoneRenderSystem {
    private _worldRenderSystem: WorldRenderSystem;
    private _zoneManager: ZoneManager;
    private _graphics: Map<number, Graphics> = new Map();
    private _abortController = new AbortController();

    constructor(worldRenderSystem: WorldRenderSystem, zoneManager: ZoneManager) {
        this._worldRenderSystem = worldRenderSystem;
        this._zoneManager = zoneManager;

        zoneManager.onAdd(this._onAdd.bind(this));
        zoneManager.onRemove(this._onRemove.bind(this));
    }

    private _onAdd(id: number, zone: ZoneEntity): void {
        const gfx = new Graphics();
        this._drawZone(gfx, zone);
        this._graphics.set(id, gfx);
        // Add to world render system at ground level
        this._worldRenderSystem.addToBand(`zone-${id}`, gfx, 0, 'drawable');
    }

    private _onRemove(id: number): void {
        const gfx = this._graphics.get(id);
        if (gfx) {
            gfx.destroy();
            this._graphics.delete(id);
            this._worldRenderSystem.removeFromBand(`zone-${id}`);
        }
    }

    private _drawZone(gfx: Graphics, zone: ZoneEntity): void {
        const colors = ZONE_COLORS[zone.type];
        gfx.clear();

        // Fill
        gfx.poly(zone.boundary.map((p) => ({ x: p.x, y: p.y })));
        gfx.fill({ color: colors.fill, alpha: colors.alpha });

        // Stroke
        gfx.poly(zone.boundary.map((p) => ({ x: p.x, y: p.y })));
        gfx.stroke({ color: colors.stroke, width: 2, alpha: 0.6 });
    }

    updateZone(id: number): void {
        const zone = this._zoneManager.getZone(id);
        const gfx = this._graphics.get(id);
        if (!zone || !gfx) return;
        this._drawZone(gfx, zone);
    }

    dispose(): void {
        this._abortController.abort();
        for (const gfx of this._graphics.values()) {
            gfx.destroy();
        }
        this._graphics.clear();
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/economy/zone-render-system.ts
git commit -m "feat(economy): add zone render system with colored boundary polygons"
```

---

## Task 18: Industry Render System

**Files:**
- Create: `src/economy/industry-render-system.ts`

- [ ] **Step 1: Implement industry render system**

```typescript
// src/economy/industry-render-system.ts
import { Graphics, Text, TextStyle } from 'pixi.js';
import type { WorldRenderSystem } from '../trains/tracks/render-system';
import type { IndustryManager } from './industry-manager';
import type { IndustryEntity } from './simulation-state';
import { IndustryType } from './types';

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

export class IndustryRenderSystem {
    private _worldRenderSystem: WorldRenderSystem;
    private _industryManager: IndustryManager;
    private _graphics: Map<number, { body: Graphics; label: Text }> = new Map();
    private _abortController = new AbortController();

    constructor(worldRenderSystem: WorldRenderSystem, industryManager: IndustryManager) {
        this._worldRenderSystem = worldRenderSystem;
        this._industryManager = industryManager;

        industryManager.onAdd(this._onAdd.bind(this));
        industryManager.onRemove(this._onRemove.bind(this));
    }

    private _onAdd(id: number, industry: IndustryEntity): void {
        const color = INDUSTRY_COLORS[industry.type];
        const body = new Graphics();
        const half = INDUSTRY_SIZE / 2;

        body.rect(industry.position.x - half, industry.position.y - half, INDUSTRY_SIZE, INDUSTRY_SIZE);
        body.fill({ color, alpha: 0.8 });
        body.stroke({ color: 0xffffff, width: 1, alpha: 0.5 });

        const label = new Text({
            text: INDUSTRY_LABELS[industry.type],
            style: new TextStyle({
                fontSize: 10,
                fill: 0xffffff,
                fontFamily: 'monospace',
            }),
        });
        label.anchor.set(0.5, -1);
        label.position.set(industry.position.x, industry.position.y - half);

        this._graphics.set(id, { body, label });
        this._worldRenderSystem.addToBand(`industry-${id}`, body, 1, 'drawable');
        this._worldRenderSystem.addToBand(`industry-label-${id}`, label, 1, 'drawable');
    }

    private _onRemove(id: number): void {
        const entry = this._graphics.get(id);
        if (entry) {
            entry.body.destroy();
            entry.label.destroy();
            this._graphics.delete(id);
            this._worldRenderSystem.removeFromBand(`industry-${id}`);
            this._worldRenderSystem.removeFromBand(`industry-label-${id}`);
        }
    }

    dispose(): void {
        this._abortController.abort();
        for (const entry of this._graphics.values()) {
            entry.body.destroy();
            entry.label.destroy();
        }
        this._graphics.clear();
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/economy/industry-render-system.ts
git commit -m "feat(economy): add industry render system"
```

---

## Task 19: Resource Overlay Render System

**Files:**
- Create: `src/economy/resource-overlay-render-system.ts`

- [ ] **Step 1: Implement resource overlay render system**

```typescript
// src/economy/resource-overlay-render-system.ts
import { Graphics, Text, TextStyle } from 'pixi.js';
import type { WorldRenderSystem } from '../trains/tracks/render-system';
import type { EconomyManager } from './economy-manager';
import { ResourceType } from './types';

const RESOURCE_COLORS: Record<ResourceType, number> = {
    [ResourceType.FOOD]: 0x4caf50,
    [ResourceType.GOODS]: 0x2196f3,
    [ResourceType.WORKERS]: 0xff9800,
    [ResourceType.BUILDING_MATERIALS]: 0x795548,
};

const BAR_WIDTH = 8;
const BAR_MAX_HEIGHT = 40;
const BAR_SPACING = 10;

export class ResourceOverlayRenderSystem {
    private _worldRenderSystem: WorldRenderSystem;
    private _economyManager: EconomyManager;
    private _overlayGraphics: Map<number, Graphics> = new Map();
    private _visible = false;

    constructor(
        worldRenderSystem: WorldRenderSystem,
        economyManager: EconomyManager
    ) {
        this._worldRenderSystem = worldRenderSystem;
        this._economyManager = economyManager;
    }

    setVisible(visible: boolean): void {
        this._visible = visible;
        if (!visible) {
            this._clearOverlays();
        }
    }

    update(stationPositions: Map<number, { x: number; y: number }>): void {
        if (!this._visible) return;

        this._clearOverlays();

        for (const [stationId, pos] of stationPositions) {
            const stationData = this._economyManager.getStationEconomy(stationId);
            if (!stationData) continue;

            const entries = stationData.stockpile.entries();
            if (entries.length === 0) continue;

            const gfx = new Graphics();
            let offsetX = -(entries.length * BAR_SPACING) / 2;

            for (const [resource, quantity] of entries) {
                const color = RESOURCE_COLORS[resource];
                const height = Math.min(quantity / 50, 1) * BAR_MAX_HEIGHT;

                gfx.rect(
                    pos.x + offsetX,
                    pos.y - 50 - height,
                    BAR_WIDTH,
                    height
                );
                gfx.fill({ color, alpha: 0.7 });

                offsetX += BAR_SPACING;
            }

            this._overlayGraphics.set(stationId, gfx);
            this._worldRenderSystem.addToBand(
                `resource-overlay-${stationId}`,
                gfx,
                2,
                'drawable'
            );
        }
    }

    private _clearOverlays(): void {
        for (const [stationId, gfx] of this._overlayGraphics) {
            gfx.destroy();
            this._worldRenderSystem.removeFromBand(`resource-overlay-${stationId}`);
        }
        this._overlayGraphics.clear();
    }

    dispose(): void {
        this._clearOverlays();
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/economy/resource-overlay-render-system.ts
git commit -m "feat(economy): add resource overlay render system with station stockpile bars"
```

---

## Task 20: Run Full Test Suite & Final Integration Check

**Files:** None new — verification only.

- [ ] **Step 1: Run all economy tests**

Run: `bun test test/economy/`
Expected: All tests pass across all test files.

- [ ] **Step 2: Run the full project test suite**

Run: `bun test`
Expected: No regressions — all existing tests still pass.

- [ ] **Step 3: Run the build**

Run: `bun run build`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 4: Start dev server and verify no runtime errors**

Run: `bun run dev`
Expected: App loads without console errors. Existing features (track drawing, train placement, stations) still work.

- [ ] **Step 5: Commit any fixes if needed**

If any issues were found and fixed in previous steps, commit them:
```bash
git add -A
git commit -m "fix(economy): address integration issues from full test suite"
```

---

## Deferred to Follow-Up Plan

The following spec items are covered by the data layer in this plan but need a separate follow-up plan for the React component implementation:

- **Zone info panel** — React component using `ZoneManager.getZone()` and `useEconomyUIStore.selectedZoneId`
- **City overview panel** — React component using `CityGrowthManager.getAllCities()`
- **Industry panel** — React component using `IndustryManager.getIndustry()` and `useEconomyUIStore.selectedIndustryId`
- **Transport demand view** — React component using `ResourceManager.getGlobalSummary()` and `ResourceManager.getStationStockpile()`
- **Station cargo config UI** — React panel for setting load/unload rules via `EconomyManager.setLoadRule()`/`setUnloadRule()`

These are standard React/Zustand panels that depend on the manager APIs built in this plan. They should be planned and built once the core economy loop is working end-to-end.
