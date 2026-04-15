# Resource Transportation & City Building — Design Spec

## Overview

Evolve the Banana railway simulator into a hybrid transport/city builder (Transport Fever / A-Train style). The player builds rail routes that drive where and how cities develop. Good service grows cities and unlocks industries; poor service causes stagnation.

**Core loop:** Place industries → zone cities → lay track → configure train routes → resources flow → cities grow → demand increases → expand network.

**Design principles:**
- Rail-first, extensible — trains are the only transport mode in v1, but the architecture supports adding roads/ships/air later
- Reputation/demand feedback — no money, no bankruptcy. The constraint is logistics capacity.
- Continuous sandbox — no win condition, no eras. Build at your own pace.
- Layered economy — simple direct resources first, production chains for advanced goods later

## Architecture

**Hybrid: Manager Facades + Internal ECS**

New systems follow the existing manager pattern externally (`ResourceManager`, `IndustryManager`, `ZoneManager`, `CityGrowthManager`) so they look and behave like `TrainManager`, `StationManager`, etc. Internally, the economic simulation runs on a lightweight entity-component store.

### Manager Facades (public API)

| Manager | Responsibility |
|---|---|
| `ResourceManager` | Query stockpiles, resource flow stats, global supply/demand overview |
| `IndustryManager` | Create/remove industries, query production status |
| `ZoneManager` | Create/designate zones, query zone satisfaction and growth state |
| `CityGrowthManager` | Evaluate growth ticks, spawn/remove buildings, track city-level reputation |

Each manager is a thin facade that delegates to the simulation core. External code (UI, serialization, rendering) interacts only with these facades.

### Economic Simulation Core (internal ECS)

A tick-based simulation that runs inside the existing `TimeManager` loop. Implemented as a pure function: `(currentState, deltaTime) → newState`.

**Tick pipeline (executed each game tick):**

1. **Production** — Industries with satisfied inputs (including workers) produce outputs into their nearest station's stockpile
2. **Demand calculation** — Zones calculate what they need based on type, population, and current satisfaction
3. **Transfer** — Resources move between station stockpiles and nearby zones/industries within service radius
4. **Growth evaluation** — Zones with sustained satisfaction spawn new buildings; starved zones stagnate

**Entity types:**

| Entity | Key Data |
|---|---|
| Industry | type, recipe, position, assigned station |
| Zone | type, boundary polygon, population, satisfaction history |
| Stockpile | `Map<ResourceType, quantity>`, attached to stations/industries/zones |
| TransportOrder | resource, quantity, source station, destination station, priority (informational only) |

**Components:**

| Component | Description |
|---|---|
| Satisfaction | Per-zone, 0.0–1.0, based on resource delivery over a rolling time window |
| Reputation | Per city cluster, weighted average of constituent zone satisfaction scores |
| Recipe | Per industry, defines inputs consumed and outputs produced with a production rate |
| CargoSlot | Per freight car, which ResourceType is carried and current quantity |

## Resources (v1)

Four resources for the initial version, proving the core loop.

| Resource | Source | Consumers | Type |
|---|---|---|---|
| **Food** | Farm | Residential zones | Direct (no processing) |
| **Goods** | Workshop (needs Building Materials) | Commercial zones | Production chain |
| **Workers** | Residential zones (when satisfied) | Industries, Commercial zones | Reverse logistics |
| **Building Materials** | Lumber Mill | Zones (for growth), Workshop | Direct (no processing) |

### Production rules

- **Farm** — No inputs. Produces Food at a base rate. Requires Workers.
- **Lumber Mill** — No inputs. Produces Building Materials at a base rate. Requires Workers.
- **Workshop** — Consumes Building Materials → produces Goods. Requires Workers.
- Production only occurs when the industry has Workers delivered from residential zones.

### Industry placement

Industries are placed freely in the continuous world (same as existing building placement). Each industry snaps to the service area of the nearest station. An industry without a station in range is orphaned and non-functional.

## Zones & City Growth

### Zone types (v1)

| Zone | Purpose | Needs | Produces |
|---|---|---|---|
| **Residential** | Housing | Food, Goods | Workers |
| **Commercial** | Shops, services | Goods, Workers | Satisfaction boost to nearby Residential |
| **Industrial** | Contains player-placed industries | Workers, raw inputs | Resource outputs |

### Zoning mechanics

The player designates a zone by drawing a freeform boundary polygon (consistent with the continuous world — no grid). Similar to how terrain painting works in the existing sim. The zone is a polygon with an assigned type.

### Building spawning

- Each zone tracks **satisfaction** (0.0–1.0) based on resource delivery over a rolling time window
- When satisfaction stays above **growth threshold** (0.6) for a sustained period (e.g., 5 game-minutes — tunable), a new building spawns at an available position within the zone boundary
- Building type is determined by zone type (houses in residential, shops in commercial)
- Buildings are cosmetic + population markers — each building represents a unit of population/capacity
- If satisfaction drops below **decay threshold** (0.3) for a sustained period (e.g., 10 game-minutes — tunable), buildings are abandoned (visual change, reduced population)

### Reputation system

- Each zone has a local satisfaction score
- A **city** is an emergent concept — a cluster of connected zones near the same station(s)
- City-level reputation = weighted average of its zones' satisfaction
- Higher reputation → increased demand → more transport pressure → growth spiral
- Low reputation → demand stagnation, no new buildings, eventual decline

### Growth unlocks

- Zones reaching population thresholds unlock visual upgrades (small houses → larger buildings)
- City-wide reputation milestones unlock new industry types (entry point for future production chains)

## Transport Integration

**Key principle: trains don't change — the cargo system wraps around them.**

### Cargo on trains

- Existing `CarType.FREIGHT` cars gain a **cargo slot**: `{ resourceType: ResourceType, quantity: number, capacity: number }`
- A train's cargo manifest = sum of its freight cars' cargo slots
- Passenger coaches carry Workers (workers are a resource that rides in coaches)

### Station cargo operations

Stations gain three new properties:

1. **Stockpile** — holding area for resources (`Map<ResourceType, quantity>`)
2. **Service radius** — circular area (configurable, default ~500 units). Industries and zones within this radius are served by the station.
3. **Load/unload rules** — player-configured per resource type:
   - "Load [Resource]" — train picks up from station stockpile
   - "Unload [Resource]" — train drops into station stockpile
   - "Auto" — load whatever's available, unload whatever local zones need

When a train stops at a station (handled by existing timetable/auto-driver), the cargo system transfers resources between train and station stockpile based on these rules.

### Demand matching

Emergent, not prescriptive. No AI freight dispatcher. If the player builds a route between a farm's station and a city's station with the right load/unload rules, food flows.

TransportOrders track *unmet demand* — purely informational. Shows the player "City A needs 50 Food/min, currently receiving 20" to indicate where to add capacity.

### Resource flow path

```
Industry → (service radius) → Station Stockpile → Train → Station Stockpile → (service radius) → Zone
```

## UI & Player Interaction

### New state machines (following `@ue-too/being` patterns)

| State Machine | States | Purpose |
|---|---|---|
| Zone placement | `idle → drawing_boundary → confirming_type → placed` | Player draws polygon, picks zone type |
| Industry placement | `idle → selecting_type → positioning → placed` | Player picks industry type, places it. Shows service radius overlay. |

Cargo configuration at stations is a React UI panel (no state machine needed).

### New UI panels (React + Zustand)

| Panel | Shows |
|---|---|
| **Resource overlay** | Colored flow lines along train routes, station stockpile bar charts (toggle on/off) |
| **Zone info** | Type, satisfaction, population, demand breakdown, served-by station |
| **City overview** | All city clusters with reputation, population, unmet demands |
| **Industry panel** | Recipe, production rate, input/output levels, worker count |
| **Transport demand** | Unmet demand icons at stations (e.g., Food icon + "need 30 more/min") |

### Toolbar additions

- Zone brush tool
- Industry placement tool
- Resource overlay toggle

All integrate with the existing `ToolSwitcherStateMachine` as new tool states.

## Serialization

Each new manager facade implements the same serialization interface used by existing managers.

**New data serialized (added to scene format):**

- Simulation core state — all ECS entity/component data (stockpiles, satisfaction, production timers, reputation)
- Industries — type, position, recipe reference, assigned station
- Zones — type, boundary polygon, population, satisfaction history
- Station cargo config — load/unload rules per station
- Train cargo state — current cargo per freight car

The serialization layer interacts only with manager facades, never the ECS directly. The internal state is flattened to plain JSON by the facades.

Auto-save via existing IndexedDB infrastructure picks this up automatically — just more data in the scene blob.

## Extensibility notes

The design explicitly supports future additions without architectural changes:

- **New resources & production chains** — Add entries to `ResourceType` enum and new `Recipe` definitions. The tick pipeline handles them automatically.
- **New transport modes** — The cargo system is station-to-station, not train-specific. A road vehicle delivering to the same station stockpile would work identically. The `CargoSlot` component can attach to any vehicle type.
- **New zone types** — Add to zone type enum, define demand/production rules. Growth system handles them.
- **Scenarios/milestones** — The reputation system provides natural hooks for win conditions or era transitions if sandbox mode is ever complemented with structured play.
