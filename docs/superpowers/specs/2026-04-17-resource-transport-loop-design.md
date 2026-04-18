# Resource Transport Loop — Design

**Status:** draft
**Date:** 2026-04-17
**Scope:** MVP plumbing for moving abstract resources between stations via trains. No producer / consumer buildings, no passenger demand model, no economy — those are follow-up slices.

## Goal

Introduce the minimum data and runtime machinery needed to move resources from one platform to another on trains. The deliverable is a working transport loop: a platform can be marked as a source, a sink, or neither; a train that runs between them fills up at the source, unloads at the sink, and the numbers on screen change accordingly. Everything downstream (industries, passengers, economy) plugs into the same plumbing without schema changes.

## Non-goals

Calling these out so their absence is not mistaken for oversight:

- Producer / consumer buildings with real industrial logic.
- Passenger origin / destination, routing, or satisfaction.
- Economy, money, prices.
- Canvas indicators for cargo above cars or platforms (remains a numeric readout in side panels).
- Timetable gating on load completion (a scripted train still departs on schedule).
- Per-resource transfer rates, per-car capacity overrides, buffer capacity caps. Structurally supported where noted; no UI, no migration needed to add later.

## Design decisions (summary)

| Question | Decision |
|---|---|
| Load/unload policy | Greedy: on arrival, unload everything then load up to capacity. Designed so route-level rules can replace it. |
| Buffer location | Platform-level by default, with an opt-in "use the station's shared buffer" mode per platform. |
| Car capacity | Per-car typed buckets keyed by resource type. Uniform default capacity across cars for MVP. |
| Transfer timing | Rate-based: arriving starts a transfer, each tick moves `rate * dt` units per car until full / empty / departed. |
| Seeding | Per-platform source / sink role flags, per resource type. Auto-generates into / drains from the buffer at a constant rate. |
| Visibility | Numeric readouts in `PlatformEditorPanel` and `TrainPanel`. No new canvas rendering. |
| Resource types | Three built-in types from day one: `passenger`, `iron-ore`, `goods`. Registry is closed in MVP but all data is keyed by `ResourceTypeId`. |

## Architecture

### New module: `src/resources/`

```
src/resources/
  types.ts                  ResourceTypeId, Cargo, Buffer, PlatformResourceConfig, TransferState
  resource-registry.ts      Built-in types: passenger, iron-ore, goods
  platform-buffer-store.ts  Map<platformId, Buffer>; station-shared buffer override
  car-cargo-store.ts        Map<carId, CarCargo>
  transfer-manager.ts       Per-train transfer state + per-tick update
  source-sink-ticker.ts     Placeholder auto-generate / auto-drain loop
  index.ts                  Public API barrel
```

No new input state machines. Interaction for source / sink mode is a React checkbox that calls a store method — no `@ue-too/being` ceremony needed for that.

### Wiring points in existing code

- **`src/utils/init-app.ts`** — construct the stores, registry, transfer manager, source/sink ticker. Subscribe the transfer manager to `stationPresenceDetector`'s arrive/depart events. Expose on `BananaAppComponents`.
- **`src/trains/train-render-system.ts`** — in the existing per-frame update, after `stationPresenceDetector.update(...)`, call `transferManager.update(dt)` and `sourceSinkTicker.update(dt)`.
- **`src/components/toolbar/PlatformEditorPanel.tsx`** — new cargo section: buffer contents, shared-with-station toggle, source/sink mode dropdown per resource type.
- **`src/components/toolbar/TrainPanel.tsx`** — new cargo section: per-car contents and in-flight transfer progress.
- **`src/scene-serialization.ts`** — add buffer / cargo / config block to the scene envelope.

### Separation of concerns

- Stores own state and expose small method surfaces (`add`, `remove`, `getEffectiveBuffer`, etc.).
- `TransferManager` owns the arrive → transferring → depart lifecycle and the per-tick mutation logic.
- `SourceSinkTicker` owns the per-tick auto-generate / auto-drain clock.
- None of these three reach into each other's data directly; all reads and writes go through store methods.

## Data model

### Resource types

```ts
type ResourceTypeId = string;  // branded alias

type ResourceType = {
    id: ResourceTypeId;
    displayName: string;         // i18n key resolved at render time
    category: 'passenger' | 'freight';
};

// Built-in registry for MVP:
const RESOURCE_TYPES: readonly ResourceType[] = [
    { id: 'passenger', category: 'passenger', displayName: 'resource.passenger' },
    { id: 'iron-ore',  category: 'freight',   displayName: 'resource.ironOre'   },
    { id: 'goods',     category: 'freight',   displayName: 'resource.goods'     },
];
```

`category` is included now so passenger-specific behaviour (origin/destination) can branch off it later without a schema migration.

### Shared value type

```ts
type ResourceCounts = Record<ResourceTypeId, number>;  // absent keys mean 0
```

Plain-object is used for both cars and buffers to keep serialization direct (no `Map` → JSON transform).

### Car cargo

```ts
type CarCargo = {
    capacity: number;               // total units across all resource types
    contents: ResourceCounts;
};
```

**Invariant:** `sum(values(contents)) <= capacity`.

Uniform default capacity:

```ts
const DEFAULT_CAR_CAPACITY = 50;
```

Per-car override is structurally supported (the field is per-car) but intentionally has no MVP UI.

### Platform resource config

```ts
type PlatformResourceConfig = {
    bufferMode: 'private' | 'sharedWithStation';
    roles: Partial<Record<ResourceTypeId, 'source' | 'sink'>>;
    // Absent key == 'neither'. Store exposes getRole() that returns 'neither'
    // for missing keys and setRole() that deletes the key when passed 'neither'.
};
```

`getEffectiveBuffer(platformId)` resolves the mode: returns the station's shared buffer when `bufferMode === 'sharedWithStation'`, otherwise the platform-private buffer. All reads and writes go through the resolver, so downstream code does not branch on mode.

The station's shared buffer lives in `PlatformBufferStore` alongside the per-platform buffers, keeping the resource module self-contained rather than adding fields onto `StationManager`.

### Transfer state

```ts
type TransferState = {
    trainId: number;
    platformId: number;
    startedAt: number;  // sim time; used for the UI progress indicator
};
```

Kept per train (not per car). The manager holds `Map<trainId, TransferState>`. Per-car transfer budgeting happens inside `update(dt)` without needing per-car persisted state.

### Invariants protected by tests

1. Sum of a car's `contents` never exceeds its `capacity`.
2. No resource count in any car or buffer ever goes negative.
3. Loading / unloading conserves total units in the world. Creation and destruction happen only in `SourceSinkTicker`.

## Runtime flow

### Frame loop integration

The new calls hang off the existing `TrainRenderSystem.update(dt)`:

```
TrainRenderSystem.update(dt)
  ...existing train physics + occupancy registry...
  stationPresenceDetector.update(trains, occupancy)   // fires arrive/depart
  transferManager.update(dt)                          // NEW
  sourceSinkTicker.update(dt)                         // NEW
```

Order matters: presence detection fires events first, so the transfer manager can consume an arrive event in the same tick it fires.

### Arrive → transfer lifecycle

```
idle ──arrived event──> transferring ──update(dt)──> transferring
                             │
                             └──departed event──> idle  (TransferState deleted;
                                                          any in-flight units stay
                                                          wherever they currently are)
```

Subscription wired once in `init-app.ts`:

```ts
stationPresenceDetector.subscribe((event) => {
    if (event.type === 'arrived') {
        transferManager.begin(event.trainId, event.presence.platformId);
    } else {
        transferManager.end(event.trainId);
    }
});
```

### Per-tick transfer logic

```ts
update(dt: number): void {
    for (const [trainId, state] of this._active) {
        const train = this._trainManager.getTrain(trainId);
        if (!train) continue;

        const buffer = this._platformBufferStore.getEffectiveBuffer(state.platformId);

        for (const car of train.cars) {
            let budget = TRANSFER_RATE_UNITS_PER_CAR_PER_SEC * dt;

            // Greedy unload first: drain any cargo into the buffer.
            budget = this._drainCargoIntoBuffer(car, buffer, budget);

            // Greedy load: fill cargo from buffer up to car capacity.
            if (budget > 0) {
                budget = this._fillCargoFromBuffer(car, buffer, budget);
            }
        }
    }
}
```

Constant:

```ts
const TRANSFER_RATE_UNITS_PER_CAR_PER_SEC = 5;
```

Invariant enforcement lives in the store methods (`CarCargoStore.add` clamps at capacity; `PlatformBufferStore.remove` clamps at zero). The transfer helpers read the store's return values (actual amount moved) to compute the remaining budget, so they can't accidentally violate capacity or create negatives no matter what arithmetic they do.

A 10-car train therefore loads 10× faster than a 1-car train — train-level parallelism falls out for free.

### Source / sink ticker

```ts
update(dt: number): void {
    for (const platformId of this._platformBufferStore.getAllPlatformIds()) {
        const config = this._platformBufferStore.getConfig(platformId);
        // Object.entries skips absent keys, which is exactly the 'neither' case.
        for (const [resourceType, role] of Object.entries(config.roles)) {
            if (role === 'source') {
                this._platformBufferStore.add(platformId, resourceType, SOURCE_RATE * dt);
            } else if (role === 'sink') {
                this._platformBufferStore.remove(platformId, resourceType, SINK_RATE * dt);
            }
        }
    }
}
```

Constants (deliberately placeholder-looking, not tuned):

```ts
const SOURCE_RATE = 1;  // units per second
const SINK_RATE   = 1;  // units per second
```

Writes go through the buffer store's resolver, so a source platform configured to share with its station correctly pools resources into the shared buffer.

### Edge cases

- Train deleted mid-transfer: `TransferManager.end(trainId)` is called defensively. `update` additionally skips any state whose train has gone missing.
- Platform or station deleted mid-transfer: `TransferManager.endAllAtPlatform(platformId)` is called from the station-change hook.
- Arrive fires while already transferring somewhere (shouldn't per the presence detector, defensive anyway): `begin()` replaces the existing `TransferState` and logs a warning.
- Source generates into a shared-buffer platform: writes go through `add(platformId, ...)`, which resolves to the station's shared buffer correctly.

## Serialization

Scene envelope gains one new optional block:

```ts
type SceneResourcesV1 = {
    version: 1;
    platformConfigs: Array<{
        platformId: number;
        bufferMode: 'private' | 'sharedWithStation';
        roles: Record<ResourceTypeId, 'source' | 'sink' | 'neither'>;
    }>;
    platformBuffers:       Array<{ platformId: number; contents: ResourceCounts }>;
    stationSharedBuffers:  Array<{ stationId: number;  contents: ResourceCounts }>;
    carCargo:              Array<{ carId: string; capacity: number; contents: ResourceCounts }>;
    // TransferState intentionally NOT persisted — regenerates from presence on load.
};
```

Load path, after trains and platforms hydrate: `resourceStore.hydrate(scene.resources)`. If the block is missing, defaults (empty buffers, no roles, uniform default capacity) apply, so older scenes keep loading.

`version: 1` is the hook for a future migrator; none is needed yet.

## Testing

Unit tests with Bun's built-in runner (`bun test`), following CLAUDE.md. No React, no PIXI. Dependencies are injected, so in-memory fakes can stand in for `TrainManager`, `StationManager`, etc.

- `test/resources/car-cargo-store.test.ts` — capacity invariant, negative guard, `add`/`remove` return values (actual amounts moved).
- `test/resources/platform-buffer-store.test.ts` — resolver correctness across `private` and `sharedWithStation` modes, including writes routed through the resolver.
- `test/resources/transfer-manager.test.ts` — greedy unload-then-load ordering, budget exhaustion, train-deleted and platform-deleted mid-transfer paths, clean teardown on `departed`.
- `test/resources/source-sink-ticker.test.ts` — rate accuracy over N simulated ticks, sink clamps at zero, no-op when no roles set.
- `test/resources/integration.test.ts` — mini scenario: one platform marked source, one marked sink, a two-car train oscillating between them. After a bounded number of simulated seconds, assert the sink buffer has received the expected unit total within one tick's worth of tolerance.

## Open items left for the implementation plan

- Exact method signatures for `PlatformBufferStore` and `CarCargoStore` (roughly implied above; to be nailed down by the plan).
- How the React panels subscribe to store changes (likely a `SynchronousObservable` per the pattern used elsewhere in the codebase).
- i18n keys for the three built-in resource types.
- Wiring of the platform-change hook that calls `transferManager.endAllAtPlatform(...)`.
