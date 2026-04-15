# Economy UI Panels — Design Spec

## Overview

Add 5 React UI panels for the economy system, giving the player visibility into zones, industries, cities, transport demand, and station cargo configuration. All panels follow the existing `DraggablePanel` pattern and are toggled via toolbar buttons.

## Panels

### 1. Zone Info Panel (`ZoneInfoPanel.tsx`)

Displays details for the selected zone:
- Zone type (Residential/Commercial/Industrial) with color indicator
- Population count
- Satisfaction bar (0–100%, color-coded)
- Demand per minute breakdown (per resource)
- Serving station name

**Data source:** `ZoneManager.getZone(selectedZoneId)`, zone's `demandPerMinute` map, `satisfaction` field.

### 2. Industry Info Panel (`IndustryInfoPanel.tsx`)

Displays details for the selected industry:
- Industry type with color indicator
- Worker count vs required (from recipe)
- Recipe: inputs consumed and outputs produced per minute
- Assigned station name

**Data source:** `IndustryManager.getIndustry(selectedIndustryId)`, `getRecipe(industry.type)` from `recipes.ts`.

### 3. City Overview Panel (`CityOverviewPanel.tsx`)

Lists all city clusters:
- City name (auto-generated from station name or "City #N")
- Reputation score (color-coded: green > 0.6, yellow 0.3–0.6, red < 0.3)
- Total population across zones
- Zone count and station count

**Data source:** `CityGrowthManager.getAllCities()`, with lookups into `ZoneManager` for population totals.

### 4. Station Cargo Config Panel (`StationCargoPanel.tsx`)

Per-station cargo rule configuration:
- Auto mode toggle checkbox
- Table with one row per resource type:
  - Resource name with color dot
  - Load checkbox (toggle via `EconomyManager.setLoadRule()`)
  - Unload checkbox (toggle via `EconomyManager.setUnloadRule()`)
  - Current stockpile quantity
- When auto mode is on, manual checkboxes are disabled

**Data source:** `EconomyManager.getStationEconomy(selectedStationId)`.

### 5. Transport Demand Panel (`TransportDemandPanel.tsx`)

Global supply vs demand overview:
- One row per resource type:
  - Resource name with color
  - Supply total (sum of all station stockpiles)
  - Demand total (sum of all zone demand rates)
  - Bar showing supply/demand ratio (green = surplus, red = deficit)

**Data source:** `ResourceManager.getGlobalSummary()`.

## Store Changes

Extend `useEconomyUIStore` with additional visibility flags:

```typescript
showZoneInfo: boolean;
showIndustryInfo: boolean;
showCityOverview: boolean;
showTransportDemand: boolean;
showStationCargo: boolean;
selectedStationId: number | null;
```

Plus toggle/set actions for each.

## Toolbar Integration

Add an "Economy" button group to `BananaToolbar.tsx` with 5 icon buttons:
- Zone Info (map pin icon)
- Industry Info (factory icon)
- City Overview (building icon)
- Station Cargo (package icon)
- Transport Demand (bar chart icon)

Each button toggles the corresponding panel visibility via `useEconomyUIStore`.

Icons are imported from `@/assets/icons` (add any missing Lucide icons to `lucide.ts`).

## Refresh Strategy

All panels use the existing `useRenderSync` hook to re-render on each frame tick, pulling fresh data from managers passed as props. This matches how existing panels like `StationListPanel` and `TrainPanel` stay updated. No additional subscription mechanism needed.

## Styling

Follow existing panel conventions:
- `DraggablePanel` wrapper with `title` and `onClose`
- Width: `w-64` for info panels, `w-72` for table-based panels (cargo config)
- Item backgrounds: `bg-muted/50 rounded-lg px-2.5 py-1.5`
- Satisfaction/demand bars: inline `div` with percentage width and color
- Resource colors: Food (#4caf50), Goods (#2196f3), Workers (#ff9800), Building Materials (#795548)
- Text: `text-xs text-muted-foreground` for secondary info
