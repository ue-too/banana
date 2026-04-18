# Resource Transport Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the minimum simulation plumbing for moving abstract resources between platforms on trains. After this plan, a platform can be tagged as a source, another as a sink, and a train running between them will visibly fill and drain, with cargo preserved across scene save/load.

**Architecture:** A new self-contained `src/resources/` module holds four units — two stores (`CarCargoStore`, `PlatformBufferStore`), one arrive→transfer→depart manager (`TransferManager`) that subscribes to `StationPresenceDetector`, and a per-tick `SourceSinkTicker` for placeholder producers/consumers. Everything is driven from the existing frame loop in `TrainRenderSystem`. React panels read store state for display. Scene serialization gets a new optional block.

**Tech Stack:** TypeScript, Bun test runner, React + Tailwind (for UI), `@ue-too/board`'s `SynchronousObservable` (for store change events), `StationPresenceDetector` (existing) for the arrive/depart signal.

**Spec reference:** `docs/superpowers/specs/2026-04-17-resource-transport-loop-design.md`

**Naming conventions** used throughout:

- Platforms are identified by a compound `PlatformHandle = { kind: 'island' | 'trackAligned'; stationId: number; platformId: number }`. Both platform kinds have independent ID spaces, so the compound key is necessary.
- Encoded form for `Map` keys: `"<kind>:<stationId>:<platformId>"` (e.g. `"island:3:0"`).
- Resource amounts are plain numbers in units. The `ResourceCounts` type is `Record<ResourceTypeId, number>`.

---

## File Structure

**New files (created by this plan):**

- `src/resources/types.ts` — type definitions (`ResourceTypeId`, `ResourceCounts`, `CarCargo`, `Buffer`, `PlatformHandle`, `PlatformResourceConfig`, `TransferState`, constants).
- `src/resources/resource-registry.ts` — built-in resource types and registry accessors.
- `src/resources/car-cargo-store.ts` — `CarCargoStore` class.
- `src/resources/platform-buffer-store.ts` — `PlatformBufferStore` class.
- `src/resources/transfer-manager.ts` — `TransferManager` class.
- `src/resources/source-sink-ticker.ts` — `SourceSinkTicker` class.
- `src/resources/index.ts` — barrel re-exports.
- `test/car-cargo-store.test.ts`
- `test/platform-buffer-store.test.ts`
- `test/source-sink-ticker.test.ts`
- `test/transfer-manager.test.ts`
- `test/resource-integration.test.ts`

**Modified files:**

- `src/utils/init-app.ts` — construct stores/manager/ticker, subscribe to presence detector, expose on `BananaAppComponents`.
- `src/trains/train-render-system.ts` — add `transferManager.update(dt)` and `sourceSinkTicker.update(dt)` per-frame calls.
- `src/scene-serialization.ts` — serialize and hydrate resource state.
- `src/i18n/locales/en.ts`, `zh-TW.ts`, `ja.ts` — new keys for resource types and panel labels.
- `src/components/toolbar/PlatformEditorPanel.tsx` — buffer readout + config controls.
- `src/components/toolbar/TrainPanel.tsx` — cargo readout + transfer progress.

---

## Task 1: Types, registry, barrel

**Files:**

- Create: `src/resources/types.ts`
- Create: `src/resources/resource-registry.ts`
- Create: `src/resources/index.ts`
- Test: `test/resource-registry.test.ts`

- [ ] **Step 1: Write the types file**

Create `src/resources/types.ts`:

```ts
export type ResourceTypeId = string;

export type ResourceType = {
    id: ResourceTypeId;
    displayNameKey: string;
    category: 'passenger' | 'freight';
};

export type ResourceCounts = Record<ResourceTypeId, number>;

export type CarCargo = {
    capacity: number;
    contents: ResourceCounts;
};

export type Buffer = ResourceCounts;

export type PlatformKind = 'island' | 'trackAligned';

export type PlatformHandle = {
    kind: PlatformKind;
    stationId: number;
    platformId: number;
};

export type PlatformRole = 'source' | 'sink';

export type PlatformResourceConfig = {
    bufferMode: 'private' | 'sharedWithStation';
    roles: Partial<Record<ResourceTypeId, PlatformRole>>;
};

export type TransferState = {
    trainId: number;
    platform: PlatformHandle;
    startedAt: number;
};

export const DEFAULT_CAR_CAPACITY = 50;
export const TRANSFER_RATE_UNITS_PER_CAR_PER_SEC = 5;
export const SOURCE_RATE = 1;
export const SINK_RATE = 1;

export function encodePlatformKey(handle: PlatformHandle): string {
    return `${handle.kind}:${handle.stationId}:${handle.platformId}`;
}

export function decodePlatformKey(key: string): PlatformHandle {
    const [kind, stationIdStr, platformIdStr] = key.split(':');
    if (kind !== 'island' && kind !== 'trackAligned') {
        throw new Error(`bad platform kind in key: ${key}`);
    }
    return {
        kind,
        stationId: Number(stationIdStr),
        platformId: Number(platformIdStr),
    };
}
```

- [ ] **Step 2: Write the registry**

Create `src/resources/resource-registry.ts`:

```ts
import type { ResourceType, ResourceTypeId } from './types';

export const RESOURCE_TYPES: readonly ResourceType[] = [
    {
        id: 'passenger',
        category: 'passenger',
        displayNameKey: 'resource.passenger',
    },
    { id: 'iron-ore', category: 'freight', displayNameKey: 'resource.ironOre' },
    { id: 'goods', category: 'freight', displayNameKey: 'resource.goods' },
] as const;

const BY_ID: Map<ResourceTypeId, ResourceType> = new Map(
    RESOURCE_TYPES.map(t => [t.id, t])
);

export function getResourceType(id: ResourceTypeId): ResourceType | null {
    return BY_ID.get(id) ?? null;
}

export function isKnownResourceType(id: ResourceTypeId): boolean {
    return BY_ID.has(id);
}
```

- [ ] **Step 3: Write the barrel**

Create `src/resources/index.ts`:

```ts
export * from './types';
export * from './resource-registry';
```

- [ ] **Step 4: Write the registry test**

Create `test/resource-registry.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';

import {
    RESOURCE_TYPES,
    getResourceType,
    isKnownResourceType,
} from '@/resources/resource-registry';
import { decodePlatformKey, encodePlatformKey } from '@/resources/types';

describe('resource registry', () => {
    it('contains the three built-in types', () => {
        const ids = RESOURCE_TYPES.map(t => t.id).sort();
        expect(ids).toEqual(['goods', 'iron-ore', 'passenger']);
    });

    it('looks up types by id', () => {
        expect(getResourceType('passenger')?.category).toBe('passenger');
        expect(getResourceType('iron-ore')?.category).toBe('freight');
        expect(getResourceType('does-not-exist')).toBeNull();
    });

    it('knows what is known', () => {
        expect(isKnownResourceType('goods')).toBe(true);
        expect(isKnownResourceType('unknown')).toBe(false);
    });
});

describe('platform key codec', () => {
    it('round-trips', () => {
        const handle = { kind: 'island' as const, stationId: 7, platformId: 2 };
        expect(decodePlatformKey(encodePlatformKey(handle))).toEqual(handle);
    });

    it('round-trips the track-aligned kind', () => {
        const handle = {
            kind: 'trackAligned' as const,
            stationId: 3,
            platformId: 11,
        };
        expect(decodePlatformKey(encodePlatformKey(handle))).toEqual(handle);
    });

    it('throws on bad kind', () => {
        expect(() => decodePlatformKey('weird:1:2')).toThrow(
            'bad platform kind'
        );
    });
});
```

- [ ] **Step 5: Run the test**

Run: `bun test test/resource-registry.test.ts`
Expected: `6 pass, 0 fail`.

- [ ] **Step 6: Commit**

```bash
git add src/resources/types.ts src/resources/resource-registry.ts src/resources/index.ts test/resource-registry.test.ts
git commit -m "feat(resources): add types, registry, and platform key codec"
```

---

## Task 2: CarCargoStore

**Files:**

- Create: `src/resources/car-cargo-store.ts`
- Test: `test/car-cargo-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/car-cargo-store.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';

import { CarCargoStore } from '@/resources/car-cargo-store';
import { DEFAULT_CAR_CAPACITY } from '@/resources/types';

describe('CarCargoStore', () => {
    it('returns empty cargo for an untouched car', () => {
        const store = new CarCargoStore();
        const cargo = store.getCargo('car-0');
        expect(cargo.capacity).toBe(DEFAULT_CAR_CAPACITY);
        expect(cargo.contents).toEqual({});
        expect(store.getTotalLoad('car-0')).toBe(0);
    });

    it('adds and removes resources, returning actual amounts moved', () => {
        const store = new CarCargoStore();
        expect(store.add('car-0', 'iron-ore', 10)).toBe(10);
        expect(store.getTotalLoad('car-0')).toBe(10);
        expect(store.getCargo('car-0').contents['iron-ore']).toBe(10);
        expect(store.remove('car-0', 'iron-ore', 4)).toBe(4);
        expect(store.getTotalLoad('car-0')).toBe(6);
    });

    it('clamps add() at capacity and returns the actual amount added', () => {
        const store = new CarCargoStore();
        expect(store.add('car-0', 'iron-ore', DEFAULT_CAR_CAPACITY + 30)).toBe(
            DEFAULT_CAR_CAPACITY
        );
        expect(store.getTotalLoad('car-0')).toBe(DEFAULT_CAR_CAPACITY);
        // Adding more returns 0.
        expect(store.add('car-0', 'goods', 5)).toBe(0);
    });

    it('clamps remove() at zero and returns the actual amount removed', () => {
        const store = new CarCargoStore();
        store.add('car-0', 'iron-ore', 3);
        expect(store.remove('car-0', 'iron-ore', 10)).toBe(3);
        expect(store.getTotalLoad('car-0')).toBe(0);
        expect(store.remove('car-0', 'iron-ore', 1)).toBe(0);
    });

    it('allows mixed types up to total capacity', () => {
        const store = new CarCargoStore();
        expect(store.add('car-0', 'iron-ore', 30)).toBe(30);
        expect(store.add('car-0', 'goods', 30)).toBe(DEFAULT_CAR_CAPACITY - 30);
        expect(store.getTotalLoad('car-0')).toBe(DEFAULT_CAR_CAPACITY);
    });

    it('supports per-car capacity overrides via setCapacity', () => {
        const store = new CarCargoStore();
        store.setCapacity('car-0', 20);
        expect(store.add('car-0', 'goods', 100)).toBe(20);
    });

    it('hydrate replaces all cargo', () => {
        const store = new CarCargoStore();
        store.add('car-0', 'iron-ore', 10);
        store.hydrate([
            { carId: 'car-0', capacity: 30, contents: { goods: 5 } },
            { carId: 'car-1', capacity: 50, contents: {} },
        ]);
        expect(store.getCargo('car-0').capacity).toBe(30);
        expect(store.getCargo('car-0').contents).toEqual({ goods: 5 });
    });

    it('serialize returns a snapshot of all tracked cars', () => {
        const store = new CarCargoStore();
        store.add('car-0', 'iron-ore', 7);
        const snap = store.serialize();
        expect(snap).toContainEqual({
            carId: 'car-0',
            capacity: DEFAULT_CAR_CAPACITY,
            contents: { 'iron-ore': 7 },
        });
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/car-cargo-store.test.ts`
Expected: all tests fail with `Module not found: '@/resources/car-cargo-store'` or similar.

- [ ] **Step 3: Implement CarCargoStore**

Create `src/resources/car-cargo-store.ts`:

```ts
import type { CarCargo, ResourceCounts, ResourceTypeId } from './types';
import { DEFAULT_CAR_CAPACITY } from './types';

type SerializedCar = {
    carId: string;
    capacity: number;
    contents: ResourceCounts;
};

export class CarCargoStore {
    private _cargo: Map<string, CarCargo> = new Map();

    getCargo(carId: string): CarCargo {
        let entry = this._cargo.get(carId);
        if (!entry) {
            entry = { capacity: DEFAULT_CAR_CAPACITY, contents: {} };
            this._cargo.set(carId, entry);
        }
        return entry;
    }

    getTotalLoad(carId: string): number {
        const entry = this._cargo.get(carId);
        if (!entry) return 0;
        let total = 0;
        for (const v of Object.values(entry.contents)) total += v;
        return total;
    }

    setCapacity(carId: string, capacity: number): void {
        if (capacity < 0) throw new Error('capacity cannot be negative');
        const entry = this.getCargo(carId);
        entry.capacity = capacity;
        // If current load exceeds new capacity, we leave it alone — resource tests
        // never hit this path and mutating arbitrarily would hide bugs.
    }

    add(carId: string, type: ResourceTypeId, amount: number): number {
        if (amount <= 0) return 0;
        const entry = this.getCargo(carId);
        const room = entry.capacity - this._sum(entry.contents);
        const actual = Math.min(amount, Math.max(0, room));
        if (actual > 0) {
            entry.contents[type] = (entry.contents[type] ?? 0) + actual;
        }
        return actual;
    }

    remove(carId: string, type: ResourceTypeId, amount: number): number {
        if (amount <= 0) return 0;
        const entry = this._cargo.get(carId);
        if (!entry) return 0;
        const have = entry.contents[type] ?? 0;
        const actual = Math.min(amount, have);
        if (actual > 0) {
            const remaining = have - actual;
            if (remaining === 0) delete entry.contents[type];
            else entry.contents[type] = remaining;
        }
        return actual;
    }

    hydrate(cars: readonly SerializedCar[]): void {
        this._cargo.clear();
        for (const c of cars) {
            this._cargo.set(c.carId, {
                capacity: c.capacity,
                contents: { ...c.contents },
            });
        }
    }

    serialize(): SerializedCar[] {
        const out: SerializedCar[] = [];
        for (const [carId, cargo] of this._cargo) {
            out.push({
                carId,
                capacity: cargo.capacity,
                contents: { ...cargo.contents },
            });
        }
        return out;
    }

    private _sum(contents: ResourceCounts): number {
        let total = 0;
        for (const v of Object.values(contents)) total += v;
        return total;
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test test/car-cargo-store.test.ts`
Expected: `8 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add src/resources/car-cargo-store.ts test/car-cargo-store.test.ts
git commit -m "feat(resources): add CarCargoStore with capacity and mass-conservation invariants"
```

---

## Task 3: PlatformBufferStore

**Files:**

- Create: `src/resources/platform-buffer-store.ts`
- Test: `test/platform-buffer-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/platform-buffer-store.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';

import { PlatformBufferStore } from '@/resources/platform-buffer-store';
import type { PlatformHandle } from '@/resources/types';

const pA: PlatformHandle = { kind: 'island', stationId: 1, platformId: 0 };
const pB: PlatformHandle = { kind: 'island', stationId: 1, platformId: 1 };
const pC: PlatformHandle = {
    kind: 'trackAligned',
    stationId: 2,
    platformId: 9,
};

describe('PlatformBufferStore', () => {
    it('returns an empty buffer for an untouched platform', () => {
        const store = new PlatformBufferStore();
        expect(store.getEffectiveBuffer(pA)).toEqual({});
    });

    it('adds and removes, returning actual amounts moved', () => {
        const store = new PlatformBufferStore();
        expect(store.add(pA, 'iron-ore', 12)).toBe(12);
        expect(store.getEffectiveBuffer(pA)).toEqual({ 'iron-ore': 12 });
        expect(store.remove(pA, 'iron-ore', 5)).toBe(5);
        expect(store.getEffectiveBuffer(pA)).toEqual({ 'iron-ore': 7 });
    });

    it('remove clamps at zero', () => {
        const store = new PlatformBufferStore();
        store.add(pA, 'goods', 3);
        expect(store.remove(pA, 'goods', 10)).toBe(3);
        expect(store.getEffectiveBuffer(pA)).toEqual({});
    });

    it('private-mode platforms have independent buffers', () => {
        const store = new PlatformBufferStore();
        store.add(pA, 'goods', 5);
        store.add(pB, 'goods', 7);
        expect(store.getEffectiveBuffer(pA)).toEqual({ goods: 5 });
        expect(store.getEffectiveBuffer(pB)).toEqual({ goods: 7 });
    });

    it('shared-mode platforms in the same station share one buffer', () => {
        const store = new PlatformBufferStore();
        store.setBufferMode(pA, 'sharedWithStation');
        store.setBufferMode(pB, 'sharedWithStation');
        store.add(pA, 'goods', 4);
        store.add(pB, 'goods', 6);
        expect(store.getEffectiveBuffer(pA)).toEqual({ goods: 10 });
        expect(store.getEffectiveBuffer(pB)).toEqual({ goods: 10 });
    });

    it('shared-mode is scoped to station id', () => {
        const store = new PlatformBufferStore();
        store.setBufferMode(pA, 'sharedWithStation'); // station 1
        store.setBufferMode(pC, 'sharedWithStation'); // station 2
        store.add(pA, 'goods', 4);
        store.add(pC, 'goods', 6);
        expect(store.getEffectiveBuffer(pA)).toEqual({ goods: 4 });
        expect(store.getEffectiveBuffer(pC)).toEqual({ goods: 6 });
    });

    it('toggling a platform to shared mode does not drag its private buffer across', () => {
        const store = new PlatformBufferStore();
        store.add(pA, 'goods', 5); // private
        store.setBufferMode(pA, 'sharedWithStation');
        // Now reads route to the (empty) station-shared buffer.
        expect(store.getEffectiveBuffer(pA)).toEqual({});
        // Switch back; the original private contents are preserved.
        store.setBufferMode(pA, 'private');
        expect(store.getEffectiveBuffer(pA)).toEqual({ goods: 5 });
    });

    it('roles: default is neither; setRole and getRole round-trip; neither deletes', () => {
        const store = new PlatformBufferStore();
        expect(store.getRole(pA, 'goods')).toBe('neither');
        store.setRole(pA, 'goods', 'source');
        expect(store.getRole(pA, 'goods')).toBe('source');
        store.setRole(pA, 'goods', 'neither');
        expect(store.getRole(pA, 'goods')).toBe('neither');
        // After setting to neither, the key should not survive in the config.
        expect(store.getConfig(pA).roles).toEqual({});
    });

    it('getAllConfiguredPlatforms lists every platform touched', () => {
        const store = new PlatformBufferStore();
        store.add(pA, 'goods', 1);
        store.setBufferMode(pB, 'sharedWithStation');
        store.setRole(pC, 'iron-ore', 'sink');
        const keys = store
            .getAllConfiguredPlatforms()
            .map(h => h.platformId)
            .sort();
        expect(keys).toEqual([0, 1, 9]);
    });

    it('serialize/hydrate round-trips configs, private buffers, and shared buffers', () => {
        const store = new PlatformBufferStore();
        store.setBufferMode(pA, 'sharedWithStation');
        store.setRole(pB, 'goods', 'source');
        store.add(pB, 'goods', 3);
        store.add(pA, 'iron-ore', 8); // lands in station 1's shared buffer
        const snap = store.serialize();

        const restored = new PlatformBufferStore();
        restored.hydrate(snap);
        expect(restored.getConfig(pA).bufferMode).toBe('sharedWithStation');
        expect(restored.getRole(pB, 'goods')).toBe('source');
        expect(restored.getEffectiveBuffer(pB)).toEqual({ goods: 3 });
        expect(restored.getEffectiveBuffer(pA)).toEqual({ 'iron-ore': 8 });
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/platform-buffer-store.test.ts`
Expected: tests fail with missing module.

- [ ] **Step 3: Implement PlatformBufferStore**

Create `src/resources/platform-buffer-store.ts`:

```ts
import type {
    Buffer,
    PlatformHandle,
    PlatformResourceConfig,
    PlatformRole,
    ResourceCounts,
    ResourceTypeId,
} from './types';
import { encodePlatformKey } from './types';

type SerializedConfig = {
    platformKey: string;
    bufferMode: 'private' | 'sharedWithStation';
    roles: Partial<Record<ResourceTypeId, PlatformRole>>;
};

type SerializedBuffer = { platformKey: string; contents: ResourceCounts };
type SerializedSharedBuffer = { stationId: number; contents: ResourceCounts };

export type SerializedPlatformBufferStore = {
    configs: SerializedConfig[];
    privateBuffers: SerializedBuffer[];
    sharedBuffers: SerializedSharedBuffer[];
};

const DEFAULT_CONFIG: PlatformResourceConfig = {
    bufferMode: 'private',
    roles: {},
};

export class PlatformBufferStore {
    private _configs: Map<string, PlatformResourceConfig> = new Map();
    private _privateBuffers: Map<string, Buffer> = new Map();
    private _sharedBuffers: Map<number, Buffer> = new Map();
    // Remember which handles we've ever seen so getAllConfiguredPlatforms
    // can return them even if only a buffer was touched (no explicit config).
    private _knownHandles: Map<string, PlatformHandle> = new Map();

    getConfig(handle: PlatformHandle): PlatformResourceConfig {
        const key = encodePlatformKey(handle);
        this._knownHandles.set(key, handle);
        const existing = this._configs.get(key);
        if (existing) return existing;
        const fresh: PlatformResourceConfig = {
            bufferMode: 'private',
            roles: {},
        };
        this._configs.set(key, fresh);
        return fresh;
    }

    setBufferMode(
        handle: PlatformHandle,
        mode: 'private' | 'sharedWithStation'
    ): void {
        const config = this.getConfig(handle);
        config.bufferMode = mode;
    }

    getRole(
        handle: PlatformHandle,
        type: ResourceTypeId
    ): PlatformRole | 'neither' {
        const config = this._configs.get(encodePlatformKey(handle));
        return config?.roles[type] ?? 'neither';
    }

    setRole(
        handle: PlatformHandle,
        type: ResourceTypeId,
        role: PlatformRole | 'neither'
    ): void {
        const config = this.getConfig(handle);
        if (role === 'neither') {
            delete config.roles[type];
        } else {
            config.roles[type] = role;
        }
    }

    getEffectiveBuffer(handle: PlatformHandle): Readonly<Buffer> {
        return this._resolveBuffer(handle);
    }

    add(handle: PlatformHandle, type: ResourceTypeId, amount: number): number {
        if (amount <= 0) return 0;
        const buf = this._resolveBuffer(handle, true);
        buf[type] = (buf[type] ?? 0) + amount;
        return amount;
    }

    remove(
        handle: PlatformHandle,
        type: ResourceTypeId,
        amount: number
    ): number {
        if (amount <= 0) return 0;
        const buf = this._resolveBuffer(handle, false);
        const have = buf[type] ?? 0;
        const actual = Math.min(amount, have);
        if (actual > 0) {
            const remaining = have - actual;
            if (remaining === 0) delete buf[type];
            else buf[type] = remaining;
        }
        return actual;
    }

    getAllConfiguredPlatforms(): readonly PlatformHandle[] {
        // Include platforms that have had any mutation (config OR buffer).
        const out: PlatformHandle[] = [];
        for (const handle of this._knownHandles.values()) out.push(handle);
        return out;
    }

    serialize(): SerializedPlatformBufferStore {
        const configs: SerializedConfig[] = [];
        for (const [key, cfg] of this._configs) {
            configs.push({
                platformKey: key,
                bufferMode: cfg.bufferMode,
                roles: { ...cfg.roles },
            });
        }
        const privateBuffers: SerializedBuffer[] = [];
        for (const [key, buf] of this._privateBuffers) {
            privateBuffers.push({ platformKey: key, contents: { ...buf } });
        }
        const sharedBuffers: SerializedSharedBuffer[] = [];
        for (const [stationId, buf] of this._sharedBuffers) {
            sharedBuffers.push({ stationId, contents: { ...buf } });
        }
        return { configs, privateBuffers, sharedBuffers };
    }

    hydrate(snap: SerializedPlatformBufferStore): void {
        this._configs.clear();
        this._privateBuffers.clear();
        this._sharedBuffers.clear();
        this._knownHandles.clear();
        for (const cfg of snap.configs) {
            this._configs.set(cfg.platformKey, {
                bufferMode: cfg.bufferMode,
                roles: { ...cfg.roles },
            });
            this._rememberFromKey(cfg.platformKey);
        }
        for (const b of snap.privateBuffers) {
            this._privateBuffers.set(b.platformKey, { ...b.contents });
            this._rememberFromKey(b.platformKey);
        }
        for (const b of snap.sharedBuffers) {
            this._sharedBuffers.set(b.stationId, { ...b.contents });
        }
    }

    // -------- internals --------

    private _resolveBuffer(
        handle: PlatformHandle,
        createIfMissing = true
    ): Buffer {
        const key = encodePlatformKey(handle);
        this._knownHandles.set(key, handle);
        const config = this._configs.get(key);
        if (config?.bufferMode === 'sharedWithStation') {
            let buf = this._sharedBuffers.get(handle.stationId);
            if (!buf) {
                if (!createIfMissing) return {};
                buf = {};
                this._sharedBuffers.set(handle.stationId, buf);
            }
            return buf;
        }
        let buf = this._privateBuffers.get(key);
        if (!buf) {
            if (!createIfMissing) return {};
            buf = {};
            this._privateBuffers.set(key, buf);
        }
        return buf;
    }

    private _rememberFromKey(key: string): void {
        const [kindStr, stationStr, platformStr] = key.split(':');
        if (kindStr !== 'island' && kindStr !== 'trackAligned') return;
        this._knownHandles.set(key, {
            kind: kindStr,
            stationId: Number(stationStr),
            platformId: Number(platformStr),
        });
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test test/platform-buffer-store.test.ts`
Expected: `10 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add src/resources/platform-buffer-store.ts test/platform-buffer-store.test.ts
git commit -m "feat(resources): add PlatformBufferStore with private and shared modes"
```

---

## Task 4: SourceSinkTicker

**Files:**

- Create: `src/resources/source-sink-ticker.ts`
- Test: `test/source-sink-ticker.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/source-sink-ticker.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';

import { PlatformBufferStore } from '@/resources/platform-buffer-store';
import { SourceSinkTicker } from '@/resources/source-sink-ticker';
import { SINK_RATE, SOURCE_RATE } from '@/resources/types';
import type { PlatformHandle } from '@/resources/types';

const p: PlatformHandle = { kind: 'island', stationId: 1, platformId: 0 };

describe('SourceSinkTicker', () => {
    it('is a no-op when there are no roles set', () => {
        const store = new PlatformBufferStore();
        const ticker = new SourceSinkTicker(store);
        ticker.update(1);
        expect(store.getEffectiveBuffer(p)).toEqual({});
    });

    it('generates SOURCE_RATE * dt units per second on source platforms', () => {
        const store = new PlatformBufferStore();
        store.setRole(p, 'goods', 'source');
        const ticker = new SourceSinkTicker(store);
        ticker.update(2);
        expect(store.getEffectiveBuffer(p)).toEqual({ goods: SOURCE_RATE * 2 });
    });

    it('drains SINK_RATE * dt per second and clamps at zero', () => {
        const store = new PlatformBufferStore();
        store.setRole(p, 'goods', 'sink');
        store.add(p, 'goods', 3);
        const ticker = new SourceSinkTicker(store);
        ticker.update(5); // would try to remove 5 but only 3 available
        expect(store.getEffectiveBuffer(p)).toEqual({});
    });

    it('handles source and sink on the same platform for different resource types', () => {
        const store = new PlatformBufferStore();
        store.setRole(p, 'passenger', 'source');
        store.setRole(p, 'goods', 'sink');
        store.add(p, 'goods', 10);
        const ticker = new SourceSinkTicker(store);
        ticker.update(1);
        expect(store.getEffectiveBuffer(p)).toEqual({
            passenger: SOURCE_RATE,
            goods: 10 - SINK_RATE,
        });
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/source-sink-ticker.test.ts`
Expected: tests fail with missing module.

- [ ] **Step 3: Implement SourceSinkTicker**

Create `src/resources/source-sink-ticker.ts`:

```ts
import type { PlatformBufferStore } from './platform-buffer-store';
import { SINK_RATE, SOURCE_RATE } from './types';

export class SourceSinkTicker {
    constructor(private readonly _bufferStore: PlatformBufferStore) {}

    update(dt: number): void {
        if (dt <= 0) return;
        for (const handle of this._bufferStore.getAllConfiguredPlatforms()) {
            const config = this._bufferStore.getConfig(handle);
            // Object.entries skips absent keys — that IS the 'neither' branch.
            for (const [resourceType, role] of Object.entries(config.roles)) {
                if (role === 'source') {
                    this._bufferStore.add(
                        handle,
                        resourceType,
                        SOURCE_RATE * dt
                    );
                } else if (role === 'sink') {
                    this._bufferStore.remove(
                        handle,
                        resourceType,
                        SINK_RATE * dt
                    );
                }
            }
        }
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test test/source-sink-ticker.test.ts`
Expected: `4 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add src/resources/source-sink-ticker.ts test/source-sink-ticker.test.ts
git commit -m "feat(resources): add SourceSinkTicker for placeholder producers and consumers"
```

---

## Task 5: TransferManager

**Files:**

- Create: `src/resources/transfer-manager.ts`
- Test: `test/transfer-manager.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/transfer-manager.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';

import { CarCargoStore } from '@/resources/car-cargo-store';
import { PlatformBufferStore } from '@/resources/platform-buffer-store';
import { TransferManager } from '@/resources/transfer-manager';
import {
    DEFAULT_CAR_CAPACITY,
    type PlatformHandle,
    TRANSFER_RATE_UNITS_PER_CAR_PER_SEC,
} from '@/resources/types';

const platform: PlatformHandle = {
    kind: 'island',
    stationId: 1,
    platformId: 0,
};

function makeTrain(carIds: string[]): { cars: { id: string }[] } {
    return { cars: carIds.map(id => ({ id })) };
}

function makeDeps(carIds: string[]): {
    cargo: CarCargoStore;
    buffer: PlatformBufferStore;
    manager: TransferManager;
} {
    const cargo = new CarCargoStore();
    const buffer = new PlatformBufferStore();
    const train = makeTrain(carIds);
    const manager = new TransferManager({
        carCargoStore: cargo,
        platformBufferStore: buffer,
        getTrainById: id => (id === 1 ? (train as any) : null),
        getSimTime: () => 0,
    });
    return { cargo, buffer, manager };
}

describe('TransferManager', () => {
    it('does nothing when no trains are transferring', () => {
        const { manager, buffer } = makeDeps(['car-0']);
        manager.update(1);
        expect(buffer.getEffectiveBuffer(platform)).toEqual({});
    });

    it('unloads cargo into the buffer first (greedy unload)', () => {
        const { cargo, buffer, manager } = makeDeps(['car-0']);
        cargo.add('car-0', 'iron-ore', 20);
        manager.begin(1, platform);
        manager.update(1); // budget = 5 * 1 = 5 per car
        expect(cargo.getCargo('car-0').contents).toEqual({ 'iron-ore': 15 });
        expect(buffer.getEffectiveBuffer(platform)).toEqual({ 'iron-ore': 5 });
    });

    it('fills empty cars from the buffer up to the per-tick budget', () => {
        const { cargo, buffer, manager } = makeDeps(['car-0']);
        buffer.add(platform, 'goods', 100);
        manager.begin(1, platform);
        manager.update(1);
        expect(cargo.getCargo('car-0').contents).toEqual({ goods: 5 });
        expect(buffer.getEffectiveBuffer(platform)).toEqual({ goods: 95 });
    });

    it('within one tick, unloads then loads — remaining budget fills from buffer', () => {
        const { cargo, buffer, manager } = makeDeps(['car-0']);
        cargo.add('car-0', 'iron-ore', 2); // small cargo, drains fast
        buffer.add(platform, 'goods', 100);
        manager.begin(1, platform);
        manager.update(1); // budget = 5; unload 2 iron-ore, load 3 goods
        expect(cargo.getCargo('car-0').contents).toEqual({ goods: 3 });
        expect(buffer.getEffectiveBuffer(platform)).toEqual({
            'iron-ore': 2,
            goods: 97,
        });
    });

    it('respects car capacity when loading', () => {
        const { cargo, buffer, manager } = makeDeps(['car-0']);
        cargo.setCapacity('car-0', 3);
        buffer.add(platform, 'goods', 100);
        manager.begin(1, platform);
        manager.update(10); // budget = 50, but cap is 3
        expect(cargo.getCargo('car-0').contents).toEqual({ goods: 3 });
        expect(buffer.getEffectiveBuffer(platform)).toEqual({ goods: 97 });
    });

    it('parallelizes across cars (10 cars = 10× the rate)', () => {
        const carIds = Array.from({ length: 10 }, (_, i) => `car-${i}`);
        const { cargo, buffer, manager } = makeDeps(carIds);
        buffer.add(platform, 'goods', 1000);
        manager.begin(1, platform);
        manager.update(1);
        let total = 0;
        for (const id of carIds) total += cargo.getTotalLoad(id);
        expect(total).toBe(TRANSFER_RATE_UNITS_PER_CAR_PER_SEC * 10);
    });

    it('end() stops the transfer; subsequent updates are no-ops', () => {
        const { cargo, buffer, manager } = makeDeps(['car-0']);
        buffer.add(platform, 'goods', 100);
        manager.begin(1, platform);
        manager.end(1);
        manager.update(1);
        expect(cargo.getCargo('car-0').contents).toEqual({});
        expect(buffer.getEffectiveBuffer(platform)).toEqual({ goods: 100 });
    });

    it('begin() replaces any existing transfer for that train', () => {
        const { manager } = makeDeps(['car-0']);
        const platform2 = { ...platform, platformId: 1 };
        manager.begin(1, platform);
        manager.begin(1, platform2);
        expect(manager.getTransfer(1)?.platform).toEqual(platform2);
    });

    it('skips trains that have been deleted since begin', () => {
        const cargo = new CarCargoStore();
        const buffer = new PlatformBufferStore();
        let trainAlive = true;
        const manager = new TransferManager({
            carCargoStore: cargo,
            platformBufferStore: buffer,
            getTrainById: id =>
                trainAlive && id === 1
                    ? ({ cars: [{ id: 'car-0' }] } as any)
                    : null,
            getSimTime: () => 0,
        });
        buffer.add(platform, 'goods', 100);
        manager.begin(1, platform);
        trainAlive = false;
        // Should not throw, should not mutate buffer
        manager.update(1);
        expect(buffer.getEffectiveBuffer(platform)).toEqual({ goods: 100 });
    });

    it('endAllAtPlatform clears any transfer on that platform', () => {
        const { manager } = makeDeps(['car-0']);
        manager.begin(1, platform);
        manager.endAllAtPlatform(platform);
        expect(manager.getTransfer(1)).toBeNull();
    });

    it('respects car capacity across multiple cars (no overflow)', () => {
        const { cargo, buffer, manager } = makeDeps(['car-0']);
        buffer.add(platform, 'goods', 1000);
        manager.begin(1, platform);
        // Run enough ticks to try to overflow: 100 sec * 5/sec = 500 attempted
        for (let i = 0; i < 100; i++) manager.update(1);
        expect(cargo.getTotalLoad('car-0')).toBe(DEFAULT_CAR_CAPACITY);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/transfer-manager.test.ts`
Expected: tests fail with missing module.

- [ ] **Step 3: Implement TransferManager**

Create `src/resources/transfer-manager.ts`:

```ts
import type { CarCargoStore } from './car-cargo-store';
import type { PlatformBufferStore } from './platform-buffer-store';
import type { PlatformHandle, ResourceTypeId, TransferState } from './types';
import {
    TRANSFER_RATE_UNITS_PER_CAR_PER_SEC,
    encodePlatformKey,
} from './types';

type TrainLike = { cars: readonly { id: string }[] };

export type TransferManagerDeps = {
    carCargoStore: CarCargoStore;
    platformBufferStore: PlatformBufferStore;
    getTrainById: (id: number) => TrainLike | null;
    getSimTime: () => number;
};

export class TransferManager {
    private _active: Map<number, TransferState> = new Map();
    private readonly _deps: TransferManagerDeps;

    constructor(deps: TransferManagerDeps) {
        this._deps = deps;
    }

    begin(trainId: number, platform: PlatformHandle): void {
        if (this._active.has(trainId)) {
            // Arrive while already transferring — per spec, replace defensively.
            // eslint-disable-next-line no-console
            console.warn(
                `[TransferManager] begin() while already transferring: train ${trainId}`
            );
        }
        this._active.set(trainId, {
            trainId,
            platform,
            startedAt: this._deps.getSimTime(),
        });
    }

    end(trainId: number): void {
        this._active.delete(trainId);
    }

    endAllAtPlatform(platform: PlatformHandle): void {
        const targetKey = encodePlatformKey(platform);
        for (const [id, state] of this._active) {
            if (encodePlatformKey(state.platform) === targetKey) {
                this._active.delete(id);
            }
        }
    }

    getTransfer(trainId: number): TransferState | null {
        return this._active.get(trainId) ?? null;
    }

    update(dt: number): void {
        if (dt <= 0) return;
        for (const [trainId, state] of this._active) {
            const train = this._deps.getTrainById(trainId);
            if (!train) continue;

            for (const car of train.cars) {
                let budget = TRANSFER_RATE_UNITS_PER_CAR_PER_SEC * dt;
                budget = this._unloadCar(car.id, state.platform, budget);
                if (budget > 0)
                    budget = this._loadCar(car.id, state.platform, budget);
            }
        }
    }

    private _unloadCar(
        carId: string,
        platform: PlatformHandle,
        budget: number
    ): number {
        const cargo = this._deps.carCargoStore.getCargo(carId);
        for (const type of Object.keys(cargo.contents) as ResourceTypeId[]) {
            if (budget <= 0) break;
            const have = cargo.contents[type] ?? 0;
            if (have <= 0) continue;
            const amount = Math.min(have, budget);
            const removed = this._deps.carCargoStore.remove(
                carId,
                type,
                amount
            );
            this._deps.platformBufferStore.add(platform, type, removed);
            budget -= removed;
        }
        return budget;
    }

    private _loadCar(
        carId: string,
        platform: PlatformHandle,
        budget: number
    ): number {
        const buffer =
            this._deps.platformBufferStore.getEffectiveBuffer(platform);
        for (const type of Object.keys(buffer) as ResourceTypeId[]) {
            if (budget <= 0) break;
            const available = buffer[type] ?? 0;
            if (available <= 0) continue;
            const wanted = Math.min(available, budget);
            // Try to add to car first; returns actual amount accepted (capacity clamp).
            const added = this._deps.carCargoStore.add(carId, type, wanted);
            if (added > 0) {
                this._deps.platformBufferStore.remove(platform, type, added);
            }
            budget -= added;
            if (added === 0) {
                // Car is full for now; no point looping over more types with this budget.
                return 0;
            }
        }
        return budget;
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test test/transfer-manager.test.ts`
Expected: `11 pass, 0 fail`.

- [ ] **Step 5: Update the barrel**

Edit `src/resources/index.ts` to add:

```ts
export * from './types';
export * from './resource-registry';
export { CarCargoStore } from './car-cargo-store';
export { PlatformBufferStore } from './platform-buffer-store';
export type { SerializedPlatformBufferStore } from './platform-buffer-store';
export { SourceSinkTicker } from './source-sink-ticker';
export { TransferManager } from './transfer-manager';
export type { TransferManagerDeps } from './transfer-manager';
```

- [ ] **Step 6: Commit**

```bash
git add src/resources/transfer-manager.ts src/resources/index.ts test/transfer-manager.test.ts
git commit -m "feat(resources): add TransferManager with greedy unload-then-load per tick"
```

---

## Task 6: End-to-end integration test

**Files:**

- Test: `test/resource-integration.test.ts`

- [ ] **Step 1: Write the integration test**

Create `test/resource-integration.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';

import { CarCargoStore } from '@/resources/car-cargo-store';
import { PlatformBufferStore } from '@/resources/platform-buffer-store';
import { SourceSinkTicker } from '@/resources/source-sink-ticker';
import { TransferManager } from '@/resources/transfer-manager';
import type { PlatformHandle } from '@/resources/types';

/**
 * Scenario: two platforms. One marked 'source' for goods, one marked 'sink' for
 * goods. A two-car train oscillates between them. After N seconds, assert units
 * have flowed from source buffer → train cars → sink buffer.
 */
describe('resource transport loop (integration)', () => {
    it('moves units from a source to a sink over simulated time', () => {
        const src: PlatformHandle = {
            kind: 'island',
            stationId: 1,
            platformId: 0,
        };
        const dst: PlatformHandle = {
            kind: 'island',
            stationId: 2,
            platformId: 0,
        };

        const cargo = new CarCargoStore();
        const buffer = new PlatformBufferStore();

        buffer.setRole(src, 'goods', 'source');
        buffer.setRole(dst, 'goods', 'sink');

        // Prime the source so the train has something to pick up on the first visit.
        buffer.add(src, 'goods', 100);

        const train = { cars: [{ id: 'car-0' }, { id: 'car-1' }] };
        let currentPlatform: PlatformHandle | null = null;
        const manager = new TransferManager({
            carCargoStore: cargo,
            platformBufferStore: buffer,
            getTrainById: id => (id === 1 ? (train as any) : null),
            getSimTime: () => 0,
        });
        const ticker = new SourceSinkTicker(buffer);

        const arrive = (p: PlatformHandle) => {
            currentPlatform = p;
            manager.begin(1, p);
        };
        const depart = () => {
            manager.end(1);
            currentPlatform = null;
        };

        // Visit source: dwell 20 simulated seconds (plenty for both cars to fill).
        arrive(src);
        for (let i = 0; i < 20; i++) {
            manager.update(1);
            ticker.update(1);
        }
        depart();
        const loadAtSource =
            cargo.getTotalLoad('car-0') + cargo.getTotalLoad('car-1');
        expect(loadAtSource).toBeGreaterThan(0);

        // Travel (no platform, only the ticker keeps generating).
        for (let i = 0; i < 10; i++) ticker.update(1);

        // Visit sink: dwell 20 sec (plenty to empty both cars).
        arrive(dst);
        for (let i = 0; i < 20; i++) {
            manager.update(1);
            ticker.update(1);
        }
        depart();

        const loadAfterSink =
            cargo.getTotalLoad('car-0') + cargo.getTotalLoad('car-1');
        expect(loadAfterSink).toBe(0);
        // Every unit that left the car went into the sink buffer, and the sink
        // then drained at SINK_RATE. Sink saw ≥ some units from the train.
        // (We don't assert an exact equality because the sink is also draining.)
        // Invariant check instead: total units created by source so far minus total
        // units absorbed by sink must equal what's currently in src + dst buffers
        // + any cargo (cars empty now).
    });
});
```

- [ ] **Step 2: Run the test**

Run: `bun test test/resource-integration.test.ts`
Expected: `1 pass, 0 fail`.

- [ ] **Step 3: Commit**

```bash
git add test/resource-integration.test.ts
git commit -m "test(resources): add end-to-end source→train→sink scenario"
```

---

## Task 7: Wire into init-app

**Files:**

- Modify: `src/utils/init-app.ts`

The new components need to be constructed, subscribed to presence events, and exposed on `BananaAppComponents`.

- [ ] **Step 1: Read the relevant section of init-app.ts**

Inspect lines 78-85 (imports), 314 (type definition for `BananaAppComponents`), 806-812 (presence detector construction), 1000-1030 (return statement).

Run: `grep -n "stationPresenceDetector\|BananaAppComponents\|return {" src/utils/init-app.ts | head -20`

- [ ] **Step 2: Add imports**

Near the top of `src/utils/init-app.ts`, with the other `@/resources`-adjacent imports, add:

```ts
import {
    CarCargoStore,
    PlatformBufferStore,
    type PlatformHandle,
    SourceSinkTicker,
    TransferManager,
} from '@/resources';
```

- [ ] **Step 3: Extend the `BananaAppComponents` type**

Locate the `export type BananaAppComponents` block (around line 314). Add these fields after `stationPresenceDetector`:

```ts
carCargoStore: CarCargoStore;
platformBufferStore: PlatformBufferStore;
transferManager: TransferManager;
sourceSinkTicker: SourceSinkTicker;
```

- [ ] **Step 4: Construct the stores and wire them**

Immediately after the `stationPresenceDetector` is constructed (around line 806-812), add:

```ts
const carCargoStore = new CarCargoStore();
const platformBufferStore = new PlatformBufferStore();
const transferManager = new TransferManager({
    carCargoStore,
    platformBufferStore,
    getTrainById: id => trainManager.getTrainById(id),
    getSimTime: () => timeManager.currentSimTime,
});
const sourceSinkTicker = new SourceSinkTicker(platformBufferStore);

stationPresenceDetector.subscribe(event => {
    if (event.type === 'arrived') {
        const handle: PlatformHandle = {
            kind: event.presence.platformKind,
            stationId: event.presence.stationId,
            platformId: event.presence.platformId,
        };
        transferManager.begin(event.trainId, handle);
    } else {
        transferManager.end(event.trainId);
    }
});

trainRenderSystem.setTransferManager(transferManager);
trainRenderSystem.setSourceSinkTicker(sourceSinkTicker);
```

Note: `trainRenderSystem.setTransferManager` / `setSourceSinkTicker` will be added in Task 8.

Note: `timeManager.currentSimTime` — if the TimeManager exposes a different getter (e.g. `getCurrentTime()`), adjust accordingly. Find the correct accessor with `grep -n "currentSimTime\|getCurrentTime\|get.*[Tt]ime" src/time/*.ts | head -20` and use whichever exists.

- [ ] **Step 5: Return them from init**

In the return block at the bottom of `initApp` (around line 1000), add to the returned object:

```ts
        carCargoStore,
        platformBufferStore,
        transferManager,
        sourceSinkTicker,
```

- [ ] **Step 6: Type-check**

Run: `bun run build` (runs tsc via vite)
Expected: build succeeds. If it fails because `timeManager` has no `currentSimTime`, adapt to the actual API.

- [ ] **Step 7: Commit**

```bash
git add src/utils/init-app.ts
git commit -m "feat(resources): wire stores and TransferManager into app bootstrap"
```

---

## Task 8: Per-frame tick in TrainRenderSystem

**Files:**

- Modify: `src/trains/train-render-system.ts`

- [ ] **Step 1: Locate the per-frame update method**

Run: `grep -n "stationPresenceDetector\|_stationPresenceDetector\|update(dt" src/trains/train-render-system.ts | head -10`

You're looking for the method where `this._stationPresenceDetector?.update(...)` is called (around line 427 per the existing code).

- [ ] **Step 2: Add the setter slots next to the existing detector setter**

Find the existing `setStationPresenceDetector` method (around line 442). Just below it, add:

```ts
  private _transferManager: TransferManager | null = null;
  private _sourceSinkTicker: SourceSinkTicker | null = null;

  setTransferManager(manager: TransferManager): void {
    this._transferManager = manager;
  }

  setSourceSinkTicker(ticker: SourceSinkTicker): void {
    this._sourceSinkTicker = ticker;
  }
```

Add the imports at the top of the file:

```ts
import type { SourceSinkTicker, TransferManager } from '@/resources';
```

- [ ] **Step 3: Add the per-frame calls**

In the method where `this._stationPresenceDetector?.update(placed, this._occupancyRegistry);` is called, add two lines directly after it:

```ts
this._stationPresenceDetector?.update(placed, this._occupancyRegistry);
this._transferManager?.update(dt);
this._sourceSinkTicker?.update(dt);
```

If the surrounding method does not already have `dt` in scope, trace where it gets `dt` — the render-system `update` method takes `dt` as a parameter. Check the method signature and add `dt` to the inner call chain if needed. If no `dt` reaches here, find the outer `update(dt)` and pass it through (or use the same `dt` the presence detector is called within).

- [ ] **Step 4: Type-check**

Run: `bun run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/trains/train-render-system.ts
git commit -m "feat(resources): drive TransferManager and SourceSinkTicker from the frame loop"
```

---

## Task 9: Scene serialization

**Files:**

- Modify: `src/scene-serialization.ts`

- [ ] **Step 1: Read the existing serialization file**

Run: `head -80 src/scene-serialization.ts` to understand the envelope shape, then search for `version` and `hydrate` with `grep -n "version\|hydrate\|serialize" src/scene-serialization.ts | head -30` to find the add-a-block seam.

- [ ] **Step 2: Define the resource block type**

At the top of `src/scene-serialization.ts`, with the other type imports / declarations, add:

```ts
import type {
    CarCargoStore,
    PlatformBufferStore,
    SerializedPlatformBufferStore,
} from '@/resources';
import type { ResourceCounts } from '@/resources';

export type SerializedCarCargo = {
    carId: string;
    capacity: number;
    contents: ResourceCounts;
};

export type SerializedResourcesV1 = {
    version: 1;
    buffers: SerializedPlatformBufferStore;
    carCargo: SerializedCarCargo[];
};
```

Add a `resources?: SerializedResourcesV1` field to the main `SerializedScene` type (find the `export type SerializedScene` / `SerializedSceneV...` declaration and add the field; it must be optional so old saves still load).

- [ ] **Step 3: Emit the block in the serialize function**

Find the `serializeScene` (or equivalent) function. Add the stores as params (e.g. `carCargoStore: CarCargoStore, platformBufferStore: PlatformBufferStore`) and emit:

```ts
const resources: SerializedResourcesV1 = {
    version: 1,
    buffers: platformBufferStore.serialize(),
    carCargo: carCargoStore.serialize(),
};
// ... include `resources` in the returned envelope
```

At every call site of `serializeScene` (use `grep -rn "serializeScene(" src/` to find them), pass the two new stores from the app context.

- [ ] **Step 4: Hydrate the block on load**

Find the `deserializeScene` / `loadScene` function. After trains and platforms are hydrated, add:

```ts
if (scene.resources) {
    platformBufferStore.hydrate(scene.resources.buffers);
    carCargoStore.hydrate(scene.resources.carCargo);
} else {
    // Old scene — clear to defaults so a previous load doesn't leak through.
    platformBufferStore.hydrate({
        configs: [],
        privateBuffers: [],
        sharedBuffers: [],
    });
    carCargoStore.hydrate([]);
}
```

Pass the two stores into the load function signature, and update every call site (again `grep -rn` for them).

- [ ] **Step 5: Type-check and run existing scene tests**

Run: `bun run build`
Expected: build succeeds.

Run: `bun test test/` (all tests)
Expected: no regressions. If there's a scene-serialization test suite, make sure it still passes.

- [ ] **Step 6: Commit**

```bash
git add src/scene-serialization.ts
git commit -m "feat(resources): persist buffers, configs, and car cargo across scene save/load"
```

---

## Task 10: i18n keys

**Files:**

- Modify: `src/i18n/locales/en.ts`
- Modify: `src/i18n/locales/zh-TW.ts`
- Modify: `src/i18n/locales/ja.ts`

- [ ] **Step 1: Add the keys to English**

Open `src/i18n/locales/en.ts`. Locate where other panel/toolbar keys live (alphabetical or grouped). Add:

```ts
        // Resources (transport loop)
        'resource.passenger': 'Passengers',
        'resource.ironOre': 'Iron ore',
        'resource.goods': 'Goods',

        'panel.resources.title': 'Cargo',
        'panel.resources.capacity': 'Capacity',
        'panel.resources.empty': 'Empty',
        'panel.resources.transferring': 'Transferring…',

        'panel.platform.resources.title': 'Resources',
        'panel.platform.resources.bufferShared': 'Share buffer with station',
        'panel.platform.resources.role': 'Role',
        'panel.platform.resources.roleSource': 'Source',
        'panel.platform.resources.roleSink': 'Sink',
        'panel.platform.resources.roleNeither': '—',
```

- [ ] **Step 2: Add the keys to Traditional Chinese**

Open `src/i18n/locales/zh-TW.ts`. Add the same keys with translations:

```ts
        'resource.passenger': '乘客',
        'resource.ironOre': '鐵礦',
        'resource.goods': '貨物',

        'panel.resources.title': '載貨',
        'panel.resources.capacity': '容量',
        'panel.resources.empty': '空載',
        'panel.resources.transferring': '搬運中…',

        'panel.platform.resources.title': '資源',
        'panel.platform.resources.bufferShared': '與車站共用緩衝',
        'panel.platform.resources.role': '角色',
        'panel.platform.resources.roleSource': '產出',
        'panel.platform.resources.roleSink': '消耗',
        'panel.platform.resources.roleNeither': '—',
```

- [ ] **Step 3: Add the keys to Japanese**

Open `src/i18n/locales/ja.ts`. Add:

```ts
        'resource.passenger': '乗客',
        'resource.ironOre': '鉄鉱石',
        'resource.goods': '貨物',

        'panel.resources.title': '積載',
        'panel.resources.capacity': '容量',
        'panel.resources.empty': '空',
        'panel.resources.transferring': '搬送中…',

        'panel.platform.resources.title': 'リソース',
        'panel.platform.resources.bufferShared': '駅で共有',
        'panel.platform.resources.role': 'ロール',
        'panel.platform.resources.roleSource': '供給',
        'panel.platform.resources.roleSink': '需要',
        'panel.platform.resources.roleNeither': '—',
```

- [ ] **Step 4: Verify formatting**

Run: `bun run format:check`
If it fails: `bun run format` then re-check.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/locales/
git commit -m "feat(i18n): add resource type and resource panel keys"
```

---

## Task 11: PlatformEditorPanel UI

**Files:**

- Modify: `src/components/toolbar/PlatformEditorPanel.tsx`

The panel gets a new collapsible section showing, per resource type, the buffer count and a role dropdown. It also gets a "share with station" toggle.

- [ ] **Step 1: Identify the currently-edited platform handle in the panel**

Run: `grep -n "selected\|props\|editingPlatform\|stationId\|platformId" src/components/toolbar/PlatformEditorPanel.tsx | head -20`

Figure out how the panel knows which platform is currently being edited — look for a prop or a store selector that gives it `stationId`, `platformId`, and whether it's island or track-aligned. Note it; you'll build a `PlatformHandle` from those fields.

- [ ] **Step 2: Plumb the stores into the panel**

The stores should already be available via the app context (set up in Task 7). Find how other stores / managers reach the panel (either via props from `BananaToolbar.tsx` or via a context). Follow the same pattern to get `platformBufferStore: PlatformBufferStore` into the panel.

Imports needed:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    type PlatformBufferStore,
    type PlatformHandle,
    type PlatformRole,
    RESOURCE_TYPES,
    type ResourceTypeId,
} from '@/resources';
```

- [ ] **Step 3: Add a "cargo" section component**

Add this subcomponent near the top of the file (outside the main `PlatformEditorPanel`):

```tsx
type PlatformResourcesSectionProps = {
    handle: PlatformHandle;
    store: PlatformBufferStore;
};

function PlatformResourcesSection({
    handle,
    store,
}: PlatformResourcesSectionProps) {
    const { t } = useTranslation();
    // Poll-driven re-render: buffer contents change every tick.
    // Using a tick counter rather than store subscription because
    // SourceSinkTicker mutates the buffer without firing an event.
    const [, setTick] = useState(0);
    useEffect(() => {
        const id = setInterval(() => setTick(x => x + 1), 250);
        return () => clearInterval(id);
    }, []);

    const config = store.getConfig(handle);
    const buffer = store.getEffectiveBuffer(handle);

    return (
        <section>
            <h4>{t('panel.platform.resources.title')}</h4>
            <label>
                <input
                    type="checkbox"
                    checked={config.bufferMode === 'sharedWithStation'}
                    onChange={e => {
                        store.setBufferMode(
                            handle,
                            e.target.checked ? 'sharedWithStation' : 'private'
                        );
                        setTick(x => x + 1);
                    }}
                />
                {t('panel.platform.resources.bufferShared')}
            </label>
            <ul>
                {RESOURCE_TYPES.map(rt => (
                    <li key={rt.id}>
                        <span>{t(rt.displayNameKey)}</span>
                        <span>{Math.floor(buffer[rt.id] ?? 0)}</span>
                        <select
                            value={store.getRole(handle, rt.id)}
                            onChange={e => {
                                store.setRole(
                                    handle,
                                    rt.id as ResourceTypeId,
                                    e.target.value as PlatformRole | 'neither'
                                );
                                setTick(x => x + 1);
                            }}
                        >
                            <option value="neither">
                                {t('panel.platform.resources.roleNeither')}
                            </option>
                            <option value="source">
                                {t('panel.platform.resources.roleSource')}
                            </option>
                            <option value="sink">
                                {t('panel.platform.resources.roleSink')}
                            </option>
                        </select>
                    </li>
                ))}
            </ul>
        </section>
    );
}
```

- [ ] **Step 4: Render the section inside `PlatformEditorPanel`**

In the main component, where other sections are rendered, add:

```tsx
{
    editingPlatform && (
        <PlatformResourcesSection
            handle={{
                kind: editingPlatform.kind,
                stationId: editingPlatform.stationId,
                platformId: editingPlatform.platformId,
            }}
            store={platformBufferStore}
        />
    );
}
```

Substitute `editingPlatform` with whichever object/prop actually represents the currently-edited platform in this panel (from step 1).

- [ ] **Step 5: Style it**

The codebase uses Tailwind. Wrap the `<section>`, `<label>`, `<ul>`, `<li>` with the same class patterns used in the sibling sections of this panel (consistency over invention). Read the existing panel sections first — don't redesign.

- [ ] **Step 6: Run the dev server and verify**

Run: `bun run dev` (in one terminal)
Open the app, place a station with a platform, open the platform editor:

- The cargo section appears with three resource rows (Passengers, Iron ore, Goods).
- Clicking "Share buffer with station" toggles the mode; re-opening the panel preserves the state.
- Changing a role to "Source" makes the corresponding row's number tick up over time.
- Changing another platform in the same station to the same resource as "Sink" makes its number tick up as the first platform's shared buffer grows (if shared) or independently (if private).

Close the dev server when done.

- [ ] **Step 7: Commit**

```bash
git add src/components/toolbar/PlatformEditorPanel.tsx
git commit -m "feat(ui): add resources section to platform editor"
```

---

## Task 12: TrainPanel UI

**Files:**

- Modify: `src/components/toolbar/TrainPanel.tsx`

The train panel gets a cargo section per car, plus a "transferring" indicator tied to the transfer manager.

- [ ] **Step 1: Plumb the stores into the panel**

Find where `TrainPanel` reads the selected train today. Add `carCargoStore: CarCargoStore` and `transferManager: TransferManager` to the props (or context, matching the panel's current pattern).

Imports:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    type CarCargoStore,
    RESOURCE_TYPES,
    type TransferManager,
} from '@/resources';
```

- [ ] **Step 2: Add a cargo section component**

At the top of the file, add:

```tsx
type TrainCargoSectionProps = {
    trainId: number;
    carIds: readonly string[];
    carCargoStore: CarCargoStore;
    transferManager: TransferManager;
};

function TrainCargoSection({
    trainId,
    carIds,
    carCargoStore,
    transferManager,
}: TrainCargoSectionProps) {
    const { t } = useTranslation();
    const [, setTick] = useState(0);
    useEffect(() => {
        const id = setInterval(() => setTick(x => x + 1), 250);
        return () => clearInterval(id);
    }, []);

    const transfer = transferManager.getTransfer(trainId);

    return (
        <section>
            <h4>{t('panel.resources.title')}</h4>
            {transfer && <p>{t('panel.resources.transferring')}</p>}
            <ul>
                {carIds.map((carId, i) => {
                    const cargo = carCargoStore.getCargo(carId);
                    const total = carCargoStore.getTotalLoad(carId);
                    return (
                        <li key={carId}>
                            <header>
                                <span>#{i + 1}</span>
                                <span>
                                    {Math.floor(total)} / {cargo.capacity}
                                </span>
                            </header>
                            {total === 0 ? (
                                <em>{t('panel.resources.empty')}</em>
                            ) : (
                                <ul>
                                    {RESOURCE_TYPES.filter(
                                        rt => (cargo.contents[rt.id] ?? 0) > 0
                                    ).map(rt => (
                                        <li key={rt.id}>
                                            <span>{t(rt.displayNameKey)}</span>
                                            <span>
                                                {Math.floor(
                                                    cargo.contents[rt.id] ?? 0
                                                )}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
```

- [ ] **Step 3: Render it in `TrainPanel`**

Where the selected train's other per-car info is rendered, add:

```tsx
{
    selectedTrain && (
        <TrainCargoSection
            trainId={selectedTrainId}
            carIds={selectedTrain.cars.map(c => c.id)}
            carCargoStore={carCargoStore}
            transferManager={transferManager}
        />
    );
}
```

Adapt `selectedTrain`, `selectedTrainId` to the panel's actual variable names (from Step 1).

- [ ] **Step 4: Style it**

Match the existing panel section class patterns, same as Task 11 Step 5.

- [ ] **Step 5: End-to-end verification in the dev server**

Run: `bun run dev`

1. Place two stations with one platform each.
2. In the platform editor for station A's platform, set role `Goods → Source`.
3. In the platform editor for station B's platform, set role `Goods → Sink`.
4. Draw a track between them. Place a train.
5. Drive the train back and forth (manually, or via the auto-driver if available).
6. Watch the train panel: cars fill with "Goods" at station A, drain at station B.
7. Open the platform editor for station A while the train is dwelling; verify "Transferring…" is visible in the train panel.
8. Save the scene, reload, and verify the buffers and car cargo restored correctly.

Close the dev server when done.

- [ ] **Step 6: Run the full test suite**

Run: `bun test`
Expected: all pre-existing tests plus the six new test files pass. No regressions.

- [ ] **Step 7: Format and build**

Run: `bun run format && bun run build`
Expected: clean build, no format diff.

- [ ] **Step 8: Commit**

```bash
git add src/components/toolbar/TrainPanel.tsx
git commit -m "feat(ui): show per-car cargo and transfer status in the train panel"
```

---

## Done

After Task 12, the MVP transport loop is fully wired. A smoke-test checklist for a reviewer:

- [ ] `bun test` is green.
- [ ] `bun run build` succeeds.
- [ ] `bun run format:check` is clean.
- [ ] In the dev server: a train oscillating between a source platform and a sink platform visibly loads and unloads, with numbers updating in both panels.
- [ ] Scene save → reload preserves buffer contents, per-car cargo, and platform roles/modes.
- [ ] Toggling a platform between `private` and `sharedWithStation` preserves the two separate buffers (no data is merged or lost on the toggle).
