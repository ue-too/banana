# Economy UI Panels — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 5 React panels (Zone Info, Industry Info, City Overview, Station Cargo, Transport Demand) to give players visibility and control over the economy system.

**Architecture:** Each panel is a React component using `DraggablePanel`. Panel visibility is managed via `toolbar-ui-store` (consistent with existing panels). Economy-specific selection state lives in `economy-ui-store`. Panels receive manager instances as props from `BananaToolbar`.

**Tech Stack:** React 19, Zustand 5, Tailwind CSS 4, DraggablePanel, i18next, Lucide icons via `@/assets/icons`

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `src/components/toolbar/ZoneInfoPanel.tsx` | Selected zone details: type, population, satisfaction, demand |
| `src/components/toolbar/IndustryInfoPanel.tsx` | Selected industry details: type, workers, recipe |
| `src/components/toolbar/CityOverviewPanel.tsx` | List all city clusters with reputation and stats |
| `src/components/toolbar/StationCargoPanel.tsx` | Per-station load/unload rules and stockpile levels |
| `src/components/toolbar/TransportDemandPanel.tsx` | Global supply vs demand bars |

### Modified files

| File | Change |
|---|---|
| `src/stores/toolbar-ui-store.ts` | Add 5 panel names, visibility flags, key map entries |
| `src/stores/economy-ui-store.ts` | Add `selectedStationId`, `showZoneInfo` etc. convenience state |
| `src/assets/icons/lucide.ts` | Add Factory, BarChart3, Truck icons |
| `src/components/toolbar/BananaToolbar.tsx` | Add economy button group + conditional panel renders |

---

## Task 1: Update Stores & Icons

**Files:**
- Modify: `src/stores/toolbar-ui-store.ts`
- Modify: `src/stores/economy-ui-store.ts`
- Modify: `src/assets/icons/lucide.ts`

- [ ] **Step 1: Read current toolbar-ui-store.ts**

Read `src/stores/toolbar-ui-store.ts` to find the exact `PanelName` type, `PanelState` type, `PANEL_KEY_MAP`, and `INITIAL_PANEL_STATE`.

- [ ] **Step 2: Add 5 economy panels to toolbar-ui-store.ts**

Add to the `PanelName` type:
```typescript
| 'zoneInfo'
| 'industryInfo'
| 'cityOverview'
| 'stationCargo'
| 'transportDemand'
```

Add to `PanelState`:
```typescript
showZoneInfo: boolean;
showIndustryInfo: boolean;
showCityOverview: boolean;
showStationCargo: boolean;
showTransportDemand: boolean;
```

Add to `PANEL_KEY_MAP`:
```typescript
zoneInfo: 'showZoneInfo',
industryInfo: 'showIndustryInfo',
cityOverview: 'showCityOverview',
stationCargo: 'showStationCargo',
transportDemand: 'showTransportDemand',
```

Add to `INITIAL_PANEL_STATE`:
```typescript
showZoneInfo: false,
showIndustryInfo: false,
showCityOverview: false,
showStationCargo: false,
showTransportDemand: false,
```

- [ ] **Step 3: Read and update economy-ui-store.ts**

Read `src/stores/economy-ui-store.ts`. Add `selectedStationId` to the state:

Add to `EconomyUIState`:
```typescript
selectedStationId: number | null;
```

Add to `EconomyUIActions`:
```typescript
selectStation: (id: number | null) => void;
```

Add to the store implementation:
```typescript
selectedStationId: null,

selectStation: id =>
    set({ selectedStationId: id }),
```

Update `clearSelection` to also clear `selectedStationId`:
```typescript
clearSelection: () =>
    set({ selectedZoneId: null, selectedIndustryId: null, selectedStationId: null }),
```

- [ ] **Step 4: Read and update lucide.ts**

Read `src/assets/icons/lucide.ts`. Add these icons to the export list:
```typescript
Factory,
BarChart3,
Truck,
```

- [ ] **Step 5: Run format and commit**

Run: `bun run format`
Run: `bun test`

```bash
git add src/stores/toolbar-ui-store.ts src/stores/economy-ui-store.ts src/assets/icons/lucide.ts
git commit -m "feat(economy): add economy panel store flags and icons"
```

---

## Task 2: Zone Info Panel

**Files:**
- Create: `src/components/toolbar/ZoneInfoPanel.tsx`

- [ ] **Step 1: Create ZoneInfoPanel component**

```typescript
// src/components/toolbar/ZoneInfoPanel.tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DraggablePanel } from '@/components/ui/draggable-panel';
import { Separator } from '@/components/ui/separator';
import type { ZoneManager } from '@/economy/zone-manager';
import type { ZoneEntity } from '@/economy/simulation-state';
import { ResourceType, ZoneType } from '@/economy/types';
import { useEconomyUIStore } from '@/stores/economy-ui-store';

type ZoneInfoPanelProps = {
    zoneManager: ZoneManager;
    onClose: () => void;
};

const ZONE_TYPE_LABELS: Record<ZoneType, string> = {
    [ZoneType.RESIDENTIAL]: 'Residential',
    [ZoneType.COMMERCIAL]: 'Commercial',
    [ZoneType.INDUSTRIAL]: 'Industrial',
};

const ZONE_TYPE_COLORS: Record<ZoneType, string> = {
    [ZoneType.RESIDENTIAL]: '#4caf50',
    [ZoneType.COMMERCIAL]: '#2196f3',
    [ZoneType.INDUSTRIAL]: '#ff9800',
};

const RESOURCE_LABELS: Record<ResourceType, string> = {
    [ResourceType.FOOD]: 'Food',
    [ResourceType.GOODS]: 'Goods',
    [ResourceType.WORKERS]: 'Workers',
    [ResourceType.BUILDING_MATERIALS]: 'Materials',
};

export function ZoneInfoPanel({ zoneManager, onClose }: ZoneInfoPanelProps) {
    const selectedZoneId = useEconomyUIStore(s => s.selectedZoneId);
    const [, setVersion] = useState(0);

    // Force re-render periodically to show updated data
    // (zone satisfaction changes each tick)

    if (selectedZoneId === null) {
        return (
            <DraggablePanel title="Zone Info" onClose={onClose} className="w-64">
                <Separator className="mb-2" />
                <span className="text-muted-foreground py-4 text-center text-xs block">
                    Select a zone to inspect
                </span>
            </DraggablePanel>
        );
    }

    const zone = zoneManager.getZone(selectedZoneId);
    if (!zone) {
        return (
            <DraggablePanel title="Zone Info" onClose={onClose} className="w-64">
                <Separator className="mb-2" />
                <span className="text-muted-foreground py-4 text-center text-xs block">
                    Zone not found
                </span>
            </DraggablePanel>
        );
    }

    const satisfactionPct = Math.round(zone.satisfaction * 100);
    const color = ZONE_TYPE_COLORS[zone.type];

    return (
        <DraggablePanel title="Zone Info" onClose={onClose} className="w-64">
            <Separator className="mb-2" />
            <div
                className="rounded-lg px-2.5 py-1.5 mb-2"
                style={{ background: `${color}20`, borderLeft: `3px solid ${color}` }}
            >
                <div className="text-sm font-medium">
                    {ZONE_TYPE_LABELS[zone.type]} Zone #{zone.id}
                </div>
                <div className="text-muted-foreground text-xs">
                    Population: {zone.population}
                </div>
            </div>

            <div className="mb-2">
                <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Satisfaction</span>
                    <span className="text-muted-foreground">{satisfactionPct}%</span>
                </div>
                <div className="h-2 rounded-full bg-muted">
                    <div
                        className="h-2 rounded-full transition-all"
                        style={{
                            width: `${satisfactionPct}%`,
                            backgroundColor: satisfactionPct >= 60 ? '#4caf50' : satisfactionPct >= 30 ? '#ff9800' : '#e53935',
                        }}
                    />
                </div>
            </div>

            {zone.demandPerMinute.size > 0 && (
                <div>
                    <div className="text-xs font-medium mb-1">Demand / min</div>
                    {Array.from(zone.demandPerMinute.entries()).map(([resource, rate]) => (
                        <div key={resource} className="flex justify-between text-xs text-muted-foreground">
                            <span>{RESOURCE_LABELS[resource]}</span>
                            <span>{rate.toFixed(1)}</span>
                        </div>
                    ))}
                </div>
            )}
        </DraggablePanel>
    );
}
```

- [ ] **Step 2: Run format and commit**

Run: `bun run format`

```bash
git add src/components/toolbar/ZoneInfoPanel.tsx
git commit -m "feat(economy): add zone info panel component"
```

---

## Task 3: Industry Info Panel

**Files:**
- Create: `src/components/toolbar/IndustryInfoPanel.tsx`

- [ ] **Step 1: Create IndustryInfoPanel component**

```typescript
// src/components/toolbar/IndustryInfoPanel.tsx
import { DraggablePanel } from '@/components/ui/draggable-panel';
import { Separator } from '@/components/ui/separator';
import type { IndustryManager } from '@/economy/industry-manager';
import { getRecipe } from '@/economy/recipes';
import { IndustryType, ResourceType } from '@/economy/types';
import { useEconomyUIStore } from '@/stores/economy-ui-store';

type IndustryInfoPanelProps = {
    industryManager: IndustryManager;
    onClose: () => void;
};

const INDUSTRY_TYPE_LABELS: Record<IndustryType, string> = {
    [IndustryType.FARM]: 'Farm',
    [IndustryType.LUMBER_MILL]: 'Lumber Mill',
    [IndustryType.WORKSHOP]: 'Workshop',
};

const INDUSTRY_TYPE_COLORS: Record<IndustryType, string> = {
    [IndustryType.FARM]: '#8bc34a',
    [IndustryType.LUMBER_MILL]: '#795548',
    [IndustryType.WORKSHOP]: '#607d8b',
};

const RESOURCE_LABELS: Record<ResourceType, string> = {
    [ResourceType.FOOD]: 'Food',
    [ResourceType.GOODS]: 'Goods',
    [ResourceType.WORKERS]: 'Workers',
    [ResourceType.BUILDING_MATERIALS]: 'Materials',
};

export function IndustryInfoPanel({ industryManager, onClose }: IndustryInfoPanelProps) {
    const selectedIndustryId = useEconomyUIStore(s => s.selectedIndustryId);

    if (selectedIndustryId === null) {
        return (
            <DraggablePanel title="Industry Info" onClose={onClose} className="w-64">
                <Separator className="mb-2" />
                <span className="text-muted-foreground py-4 text-center text-xs block">
                    Select an industry to inspect
                </span>
            </DraggablePanel>
        );
    }

    const industry = industryManager.getIndustry(selectedIndustryId);
    if (!industry) {
        return (
            <DraggablePanel title="Industry Info" onClose={onClose} className="w-64">
                <Separator className="mb-2" />
                <span className="text-muted-foreground py-4 text-center text-xs block">
                    Industry not found
                </span>
            </DraggablePanel>
        );
    }

    const recipe = getRecipe(industry.type);
    const color = INDUSTRY_TYPE_COLORS[industry.type];

    return (
        <DraggablePanel title="Industry Info" onClose={onClose} className="w-64">
            <Separator className="mb-2" />
            <div
                className="rounded-lg px-2.5 py-1.5 mb-2"
                style={{ background: `${color}20`, borderLeft: `3px solid ${color}` }}
            >
                <div className="text-sm font-medium">
                    {INDUSTRY_TYPE_LABELS[industry.type]} #{industry.id}
                </div>
                <div className="text-muted-foreground text-xs">
                    Workers: {industry.workerCount} / {recipe.workersRequired} required
                </div>
            </div>

            <div className="mb-2">
                <div className="text-xs font-medium mb-1">Recipe</div>
                <div className="text-xs text-muted-foreground">
                    {recipe.inputs.size === 0 ? (
                        <div>Inputs: <span className="text-muted-foreground/50">none</span></div>
                    ) : (
                        <div>
                            Inputs:{' '}
                            {Array.from(recipe.inputs.entries())
                                .map(([r, rate]) => `${RESOURCE_LABELS[r]} ${rate}/min`)
                                .join(', ')}
                        </div>
                    )}
                    <div>
                        Outputs:{' '}
                        {Array.from(recipe.outputs.entries())
                            .map(([r, rate]) => `${RESOURCE_LABELS[r]} ${rate}/min`)
                            .join(', ')}
                    </div>
                </div>
            </div>

            <div className="text-xs text-muted-foreground">
                {industry.assignedStationId !== null
                    ? `Assigned to station #${industry.assignedStationId}`
                    : 'No station in range'}
            </div>
        </DraggablePanel>
    );
}
```

- [ ] **Step 2: Run format and commit**

Run: `bun run format`

```bash
git add src/components/toolbar/IndustryInfoPanel.tsx
git commit -m "feat(economy): add industry info panel component"
```

---

## Task 4: City Overview Panel

**Files:**
- Create: `src/components/toolbar/CityOverviewPanel.tsx`

- [ ] **Step 1: Create CityOverviewPanel component**

```typescript
// src/components/toolbar/CityOverviewPanel.tsx
import { DraggablePanel } from '@/components/ui/draggable-panel';
import { Separator } from '@/components/ui/separator';
import type { CityGrowthManager } from '@/economy/city-growth-manager';
import type { ZoneManager } from '@/economy/zone-manager';
import type { CityCluster } from '@/economy/simulation-state';

type CityOverviewPanelProps = {
    cityGrowthManager: CityGrowthManager;
    zoneManager: ZoneManager;
    onClose: () => void;
};

function reputationColor(rep: number): string {
    if (rep >= 0.6) return '#4caf50';
    if (rep >= 0.3) return '#ff9800';
    return '#e53935';
}

function cityPopulation(city: CityCluster, zoneManager: ZoneManager): number {
    let total = 0;
    for (const zoneId of city.zoneIds) {
        const zone = zoneManager.getZone(zoneId);
        if (zone) total += zone.population;
    }
    return total;
}

export function CityOverviewPanel({
    cityGrowthManager,
    zoneManager,
    onClose,
}: CityOverviewPanelProps) {
    const cities = cityGrowthManager.getAllCities();

    return (
        <DraggablePanel title="Cities" onClose={onClose} className="w-64">
            <Separator className="mb-2" />
            {cities.length === 0 ? (
                <span className="text-muted-foreground py-4 text-center text-xs block">
                    No cities yet
                </span>
            ) : (
                <div className="flex flex-col gap-1.5 max-h-80 overflow-y-auto">
                    {cities.map(city => {
                        const pop = cityPopulation(city, zoneManager);
                        return (
                            <div
                                key={city.id}
                                className="bg-muted/50 rounded-lg px-2.5 py-1.5"
                            >
                                <div className="flex justify-between items-center">
                                    <span className="text-sm font-medium">
                                        City #{city.id}
                                    </span>
                                    <span
                                        className="text-xs"
                                        style={{ color: reputationColor(city.reputation) }}
                                    >
                                        Rep: {city.reputation.toFixed(2)}
                                    </span>
                                </div>
                                <div className="text-muted-foreground text-xs">
                                    Pop: {pop} | {city.zoneIds.size} zones | {city.stationIds.size} station{city.stationIds.size !== 1 ? 's' : ''}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </DraggablePanel>
    );
}
```

- [ ] **Step 2: Run format and commit**

Run: `bun run format`

```bash
git add src/components/toolbar/CityOverviewPanel.tsx
git commit -m "feat(economy): add city overview panel component"
```

---

## Task 5: Station Cargo Config Panel

**Files:**
- Create: `src/components/toolbar/StationCargoPanel.tsx`

- [ ] **Step 1: Create StationCargoPanel component**

```typescript
// src/components/toolbar/StationCargoPanel.tsx
import { DraggablePanel } from '@/components/ui/draggable-panel';
import { Separator } from '@/components/ui/separator';
import type { EconomyManager } from '@/economy/economy-manager';
import { ResourceType } from '@/economy/types';
import { useEconomyUIStore } from '@/stores/economy-ui-store';
import { useState } from 'react';

type StationCargoPanelProps = {
    economyManager: EconomyManager;
    onClose: () => void;
};

const ALL_RESOURCES = [
    ResourceType.FOOD,
    ResourceType.GOODS,
    ResourceType.WORKERS,
    ResourceType.BUILDING_MATERIALS,
] as const;

const RESOURCE_LABELS: Record<ResourceType, string> = {
    [ResourceType.FOOD]: 'Food',
    [ResourceType.GOODS]: 'Goods',
    [ResourceType.WORKERS]: 'Workers',
    [ResourceType.BUILDING_MATERIALS]: 'Materials',
};

const RESOURCE_COLORS: Record<ResourceType, string> = {
    [ResourceType.FOOD]: '#4caf50',
    [ResourceType.GOODS]: '#2196f3',
    [ResourceType.WORKERS]: '#ff9800',
    [ResourceType.BUILDING_MATERIALS]: '#795548',
};

export function StationCargoPanel({ economyManager, onClose }: StationCargoPanelProps) {
    const selectedStationId = useEconomyUIStore(s => s.selectedStationId);
    const [, setVersion] = useState(0);

    if (selectedStationId === null) {
        return (
            <DraggablePanel title="Station Cargo" onClose={onClose} className="w-72">
                <Separator className="mb-2" />
                <span className="text-muted-foreground py-4 text-center text-xs block">
                    Select a station to configure cargo
                </span>
            </DraggablePanel>
        );
    }

    const stationData = economyManager.getStationEconomy(selectedStationId);
    if (!stationData) {
        return (
            <DraggablePanel title="Station Cargo" onClose={onClose} className="w-72">
                <Separator className="mb-2" />
                <span className="text-muted-foreground py-4 text-center text-xs block">
                    Station not found
                </span>
            </DraggablePanel>
        );
    }

    const handleAutoToggle = () => {
        economyManager.setAutoMode(selectedStationId, !stationData.autoMode);
        setVersion(v => v + 1);
    };

    const handleLoadToggle = (resource: ResourceType) => {
        economyManager.setLoadRule(selectedStationId, resource, !stationData.loadRules.has(resource));
        setVersion(v => v + 1);
    };

    const handleUnloadToggle = (resource: ResourceType) => {
        economyManager.setUnloadRule(selectedStationId, resource, !stationData.unloadRules.has(resource));
        setVersion(v => v + 1);
    };

    return (
        <DraggablePanel title={`Station #${selectedStationId} Cargo`} onClose={onClose} className="w-72">
            <Separator className="mb-2" />

            <label className="flex items-center gap-2 text-xs text-muted-foreground mb-2 cursor-pointer">
                <input
                    type="checkbox"
                    checked={stationData.autoMode}
                    onChange={handleAutoToggle}
                    className="rounded"
                />
                Auto mode
            </label>

            <table className="w-full text-xs">
                <thead>
                    <tr className="border-b border-border text-muted-foreground">
                        <th className="text-left py-1 font-medium">Resource</th>
                        <th className="text-center py-1 font-medium">Load</th>
                        <th className="text-center py-1 font-medium">Unload</th>
                        <th className="text-right py-1 font-medium">Stock</th>
                    </tr>
                </thead>
                <tbody>
                    {ALL_RESOURCES.map(resource => (
                        <tr key={resource} className="border-b border-border/50">
                            <td className="py-1 flex items-center gap-1.5">
                                <span
                                    className="inline-block size-2 rounded-full"
                                    style={{ backgroundColor: RESOURCE_COLORS[resource] }}
                                />
                                {RESOURCE_LABELS[resource]}
                            </td>
                            <td className="text-center py-1">
                                <input
                                    type="checkbox"
                                    checked={stationData.loadRules.has(resource)}
                                    onChange={() => handleLoadToggle(resource)}
                                    disabled={stationData.autoMode}
                                    className="rounded"
                                />
                            </td>
                            <td className="text-center py-1">
                                <input
                                    type="checkbox"
                                    checked={stationData.unloadRules.has(resource)}
                                    onChange={() => handleUnloadToggle(resource)}
                                    disabled={stationData.autoMode}
                                    className="rounded"
                                />
                            </td>
                            <td
                                className="text-right py-1"
                                style={{ color: RESOURCE_COLORS[resource] }}
                            >
                                {Math.round(stationData.stockpile.get(resource))}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </DraggablePanel>
    );
}
```

- [ ] **Step 2: Run format and commit**

Run: `bun run format`

```bash
git add src/components/toolbar/StationCargoPanel.tsx
git commit -m "feat(economy): add station cargo config panel component"
```

---

## Task 6: Transport Demand Panel

**Files:**
- Create: `src/components/toolbar/TransportDemandPanel.tsx`

- [ ] **Step 1: Create TransportDemandPanel component**

```typescript
// src/components/toolbar/TransportDemandPanel.tsx
import { DraggablePanel } from '@/components/ui/draggable-panel';
import { Separator } from '@/components/ui/separator';
import type { ResourceManager } from '@/economy/resource-manager';
import { ResourceType } from '@/economy/types';

type TransportDemandPanelProps = {
    resourceManager: ResourceManager;
    onClose: () => void;
};

const ALL_RESOURCES = [
    ResourceType.FOOD,
    ResourceType.GOODS,
    ResourceType.WORKERS,
    ResourceType.BUILDING_MATERIALS,
] as const;

const RESOURCE_LABELS: Record<ResourceType, string> = {
    [ResourceType.FOOD]: 'Food',
    [ResourceType.GOODS]: 'Goods',
    [ResourceType.WORKERS]: 'Workers',
    [ResourceType.BUILDING_MATERIALS]: 'Materials',
};

const RESOURCE_COLORS: Record<ResourceType, string> = {
    [ResourceType.FOOD]: '#4caf50',
    [ResourceType.GOODS]: '#2196f3',
    [ResourceType.WORKERS]: '#ff9800',
    [ResourceType.BUILDING_MATERIALS]: '#795548',
};

export function TransportDemandPanel({ resourceManager, onClose }: TransportDemandPanelProps) {
    const summary = resourceManager.getGlobalSummary();

    return (
        <DraggablePanel title="Transport Demand" onClose={onClose} className="w-64">
            <Separator className="mb-2" />
            <div className="flex flex-col gap-2">
                {ALL_RESOURCES.map(resource => {
                    const supply = summary.totalSupply.get(resource) ?? 0;
                    const demand = summary.totalDemand.get(resource) ?? 0;
                    const ratio = demand > 0 ? Math.min(supply / demand, 1) : 1;
                    const barColor = ratio >= 0.8 ? '#4caf50' : ratio >= 0.4 ? '#ff9800' : '#e53935';

                    return (
                        <div key={resource}>
                            <div className="flex justify-between text-xs mb-0.5">
                                <span style={{ color: RESOURCE_COLORS[resource] }}>
                                    {RESOURCE_LABELS[resource]}
                                </span>
                                <span className="text-muted-foreground">
                                    {Math.round(supply)} supply | {demand.toFixed(1)}/min demand
                                </span>
                            </div>
                            <div className="h-1.5 rounded-full bg-muted">
                                <div
                                    className="h-1.5 rounded-full transition-all"
                                    style={{
                                        width: `${ratio * 100}%`,
                                        backgroundColor: barColor,
                                    }}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>
        </DraggablePanel>
    );
}
```

- [ ] **Step 2: Run format and commit**

Run: `bun run format`

```bash
git add src/components/toolbar/TransportDemandPanel.tsx
git commit -m "feat(economy): add transport demand panel component"
```

---

## Task 7: Integrate Panels into BananaToolbar

**Files:**
- Modify: `src/components/toolbar/BananaToolbar.tsx`

- [ ] **Step 1: Read BananaToolbar.tsx**

Read `src/components/toolbar/BananaToolbar.tsx` to find:
- Where panel toggle buttons are defined (look for the button group arrays with `kind: 'button'`)
- Where panels are conditionally rendered (look for `{showStationList && (` patterns)
- Where `app` is accessed (likely `useBananaApp()`)
- Where `togglePanel` and `setPanel` are destructured from `useToolbarUIStore`
- Which store selectors are used to read `show*` flags

- [ ] **Step 2: Add imports**

At the top of the file, add:
```typescript
import { Factory, BarChart3, Truck } from '@/assets/icons';
import { ZoneInfoPanel } from './ZoneInfoPanel';
import { IndustryInfoPanel } from './IndustryInfoPanel';
import { CityOverviewPanel } from './CityOverviewPanel';
import { StationCargoPanel } from './StationCargoPanel';
import { TransportDemandPanel } from './TransportDemandPanel';
```

Also import `MapPin` and `Building2` from `@/assets/icons` if not already imported. Check the existing icon imports first.

- [ ] **Step 3: Add store selectors**

Find where the component destructures or selects from `useToolbarUIStore`. Add selectors for the 5 new panel flags:
```typescript
const showZoneInfo = useToolbarUIStore(s => s.showZoneInfo);
const showIndustryInfo = useToolbarUIStore(s => s.showIndustryInfo);
const showCityOverview = useToolbarUIStore(s => s.showCityOverview);
const showStationCargo = useToolbarUIStore(s => s.showStationCargo);
const showTransportDemand = useToolbarUIStore(s => s.showTransportDemand);
```

- [ ] **Step 4: Add economy button group**

Find the toolbar button groups. Add a new "Economy" group with 5 buttons. Follow the exact pattern used by existing groups:

```typescript
{
    kind: 'button',
    id: 'zone-info',
    icon: <MapPin />,
    label: 'Zone Info',
    active: showZoneInfo,
    onClick: () => togglePanel('zoneInfo'),
},
{
    kind: 'button',
    id: 'industry-info',
    icon: <Factory />,
    label: 'Industry',
    active: showIndustryInfo,
    onClick: () => togglePanel('industryInfo'),
},
{
    kind: 'button',
    id: 'city-overview',
    icon: <Building2 />,
    label: 'Cities',
    active: showCityOverview,
    onClick: () => togglePanel('cityOverview'),
},
{
    kind: 'button',
    id: 'station-cargo',
    icon: <Truck />,
    label: 'Cargo',
    active: showStationCargo,
    onClick: () => togglePanel('stationCargo'),
},
{
    kind: 'button',
    id: 'transport-demand',
    icon: <BarChart3 />,
    label: 'Demand',
    active: showTransportDemand,
    onClick: () => togglePanel('transportDemand'),
},
```

- [ ] **Step 5: Add conditional panel renders**

Find where other panels are conditionally rendered (near the bottom of the JSX return). Add the 5 economy panels following the exact same pattern:

```typescript
{showZoneInfo && (
    <ZoneInfoPanel
        zoneManager={app.economyManager.zones}
        onClose={() => setPanel('zoneInfo', false)}
    />
)}
{showIndustryInfo && (
    <IndustryInfoPanel
        industryManager={app.economyManager.industries}
        onClose={() => setPanel('industryInfo', false)}
    />
)}
{showCityOverview && (
    <CityOverviewPanel
        cityGrowthManager={app.economyManager.cityGrowth}
        zoneManager={app.economyManager.zones}
        onClose={() => setPanel('cityOverview', false)}
    />
)}
{showStationCargo && (
    <StationCargoPanel
        economyManager={app.economyManager}
        onClose={() => setPanel('stationCargo', false)}
    />
)}
{showTransportDemand && (
    <TransportDemandPanel
        resourceManager={app.economyManager.resources}
        onClose={() => setPanel('transportDemand', false)}
    />
)}
```

- [ ] **Step 6: Run format, test, and commit**

Run: `bun run format`
Run: `bun test`
Run: `bun run build`

```bash
git add src/components/toolbar/BananaToolbar.tsx
git commit -m "feat(economy): integrate economy panels into toolbar"
```

---

## Task 8: Final Integration Check

**Files:** None new — verification only.

- [ ] **Step 1: Run full test suite**

Run: `bun test`
Expected: All tests pass, no regressions.

- [ ] **Step 2: Run production build**

Run: `bun run build`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 3: Check formatting**

Run: `bun run format:check`
Expected: All files pass Prettier check.

- [ ] **Step 4: Start dev server and verify**

Run: `bun run dev`
Expected: App loads. The toolbar shows economy buttons. Clicking each button opens the corresponding panel. Panels display placeholder state (no selection / no data) until zones/industries are placed.

- [ ] **Step 5: Commit any fixes**

If any issues were found and fixed:
```bash
git add -A
git commit -m "fix(economy): address UI panel integration issues"
```
