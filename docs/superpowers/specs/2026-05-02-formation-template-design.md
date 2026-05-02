# Formation Template — Design

## Goal

Let users save customizable formation blueprints — analogous to the existing per-car `CarTemplate` blueprints — and materialize a fresh depot `Formation` from one with a single click. Today the only way to get a multi-car formation is `Formation.createDefault()` (hardcoded 4 cars, picked from the placement dropdown as "Default") or hand-assembling cars in the Formation Editor. A formation template fills the gap: a named, reusable recipe that produces fresh cars (no stock consumption) from existing car templates.

## Scope

In scope:

- A new `FormationTemplate` data type and a pure resolver that detects unresolved car-template references.
- Toolbar-level state for formation templates (sibling to the existing `carTemplates` state).
- A materialize flow that takes a template plus the current car-template list and produces a new depot `Formation` populated with fresh cars.
- A new "Formation Templates" section in `DepotPanel` with create / rename / edit / delete affordances, an inline slot editor, and a warning badge for unresolved car-template references.
- New i18n keys in `en.ts`, `zh-TW.ts`, `ja.ts`.
- Bun unit tests for the resolver and the materialize flow.

Out of scope (MVP non-goals):

- Persistence across sessions and inclusion in scene serialization. `carTemplates` is also session-only `useState`; formation templates match for symmetry. Promotable later.
- Nested formation templates (a template referencing another formation template). Single flat ordered slot list only.
- Per-slot `flipped` / gangway override / direction. The slot wrapper type leaves room for these but they are not implemented.
- Use of formation templates in the train placement dropdown. Materialization happens only via the depot "+" button; placement uses the existing depot-Formation flow unchanged.
- Bulk operations: multi-select, duplicate, import/export.
- Constraining car-template deletion when referenced. Deletion remains free; the formation template enters a warning state and cannot be materialized until the user repicks or removes the broken slot.
- UI tests. `DepotPanel` has none today; staying consistent.

## Architecture

The feature mirrors the **Car Template** pattern:

1. A pure data type and helper module (`formation-template.ts`) parallel to `car-template.ts`.
2. A `useState` array of templates lifted into `BananaToolbar.tsx` next to `carTemplates`, threaded into `DepotPanel` via props.
3. A new `DepotPanel` UI section that mirrors the existing "Templates" section's layout but adds an inline slot editor and a warning badge.
4. A materialization helper that uses **only existing** `CarStockManager` and `FormationManager` primitives — no new manager APIs in MVP.

Templates are immutable values. Edits replace the template object inside the `formationTemplates` array via `setFormationTemplates(prev => ...)`, matching how `setCarTemplates` is used today.

## Components

### 1. `src/trains/formation-template.ts` (new)

```ts
import type { CarTemplate } from './car-template';

export type FormationTemplateSlot = {
    carTemplateId: string;
};

export type FormationTemplate = {
    id: string;
    name: string;
    slots: FormationTemplateSlot[]; // length >= 1
};

let _formationTemplateIdCounter = 0;
export function generateFormationTemplateId(): string {
    return `ftpl-${_formationTemplateIdCounter++}`;
}

export type FormationTemplateResolution =
    | { ok: true; carTemplates: CarTemplate[] }
    | { ok: false; missingTemplateIds: string[] };

/**
 * Resolve every slot's `carTemplateId` against the available car templates.
 * Returns the ordered list of resolved car templates on success, or the
 * deduplicated, in-order list of unresolved ids on failure.
 */
export function resolveFormationTemplate(
    tpl: FormationTemplate,
    available: readonly CarTemplate[]
): FormationTemplateResolution;
```

The slot is a wrapper object rather than `string[]` so future per-slot extras (flipped, gangway override) can be added without a schema migration.

### 2. `src/trains/formation-template-materialize.ts` (new)

A pure-ish helper that orchestrates the existing managers. Kept in its own module to keep `DepotPanel` thin and to make the unit test target obvious.

```ts
export type MaterializeResult =
    | { ok: true; formationId: string }
    | { ok: false; missingTemplateIds: string[] };

export function materializeFormationTemplate(args: {
    template: FormationTemplate;
    carTemplates: readonly CarTemplate[];
    carStockManager: CarStockManager;
    formationManager: FormationManager;
    carImageRegistry: CarImageRegistry;
}): MaterializeResult;
```

Steps:

1. `resolveFormationTemplate(template, carTemplates)`. On `ok: false`, return `{ ok: false, missingTemplateIds }` without touching any manager.
2. For each resolved car template, call `carStockManager.createCar(bogieOffsets, edgeToBogie, bogieToEdge, type, width)` and collect the new car ids.
3. If a car template has an `image`, call `carImageRegistry.set(newCar.id, image.src)` immediately after creating that car. Mirrors the existing `DepotPanel` per-car-template `+` behavior.
4. `formationManager.createFormation([...newCarIds])` — pulls the new cars out of stock into a new depot Formation (this is the only existing path that produces an id and fires the right notifications, so the stock round-trip is intentional).
5. `formationManager.renameFormation(newFormation.id, template.name)` so the depot Formation defaults to the template's name.
6. Return `{ ok: true, formationId: newFormation.id }`.

If step 2 throws (e.g. `createCar` invariant), the helper does not catch — the toolbar/DepotPanel callsite already has try-error patterns for stock failures and we reuse those. No partial rollback is needed because car-template specs are validated and `createCar` does not currently throw on valid input.

The DepotPanel UI guards against the failure path (the "+" button is disabled when the resolver reports unresolved ids), so a `{ ok: false }` return is a defensive fallback rather than a user-visible state in normal flow.

### 3. `src/trains/index.ts` (modified)

Re-export `FormationTemplate`, `FormationTemplateSlot`, `generateFormationTemplateId`, `resolveFormationTemplate`, and `materializeFormationTemplate` alongside the existing `CarTemplate` exports.

### 4. `src/components/toolbar/BananaToolbar.tsx` (modified)

- Add a sibling `useState` next to `carTemplates`:

    ```ts
    const [formationTemplates, setFormationTemplates] = useState<
        FormationTemplate[]
    >([]);
    ```

- Pass `formationTemplates` and `setFormationTemplates` into `DepotPanel` next to the existing car-template props.
- No scene-serialization changes.

### 5. `src/components/toolbar/DepotPanel.tsx` (modified)

Props gain:

```ts
formationTemplates: FormationTemplate[];
onFormationTemplatesChange: Dispatch<SetStateAction<FormationTemplate[]>>;
formationManager: FormationManager;
```

`carImageRegistry`, `carStockManager`, and `carTemplates` are already in scope.

Local state:

```ts
const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
```

A new section is rendered below the existing car-templates block. The existing block's header (currently `t('templates')`) is renamed to `t('carTemplates')`. The new section is hidden when both `formationTemplates.length === 0` **and** `carTemplates.length === 0` (nothing to compose); when only `carTemplates` is empty, the new section still renders the header + create button (button disabled, tooltip explains).

#### 5a. Section layout

```
─── Car Templates ──────────────────────────
[ ...existing car-template rows ... ]

─── Formation Templates ───────────────  [+]
[ Local Express          ⚠ 1 missing  [pencil][+][trash] ]
[   ↑ inline editor when expanded ↑                       ]
[ Limited Express        4 cars       [pencil][+][trash] ]
```

The header-level `[+]` button creates a new template:

```ts
const tpl: FormationTemplate = {
    id: generateFormationTemplateId(),
    name: t('newFormationTemplate'),
    slots: [{ carTemplateId: carTemplates[0]?.id ?? '' }],
};
setFormationTemplates(prev => [...prev, tpl]);
setEditingTemplateId(tpl.id);
```

The header `[+]` is disabled when `carTemplates.length === 0`; tooltip uses `t('addSlotNoCarTemplates')`.

#### 5b. Per-template row

A row component analogous to `DepotCarRow`. Layout:

- **Top line**: name. Double-click switches to a rename input (mirrors `DepotCarRow`); commit on blur or Enter; cancel on Escape. Rename calls `setFormationTemplates(prev => prev.map(t => t.id === id ? { ...t, name: newName } : t))`.
- **Subtitle**: `t('slot', { count })` (pluralized). When the resolver reports unresolved ids, append a warning fragment using the `AlertTriangle` icon (must be added to `src/assets/icons/lucide.ts`) plus `t('missingCarTemplates', { count })` rendered with `text-destructive` (or amber accent — matches the toast/alert palette already used in `formation-editor.tsx`).
- **Right buttons**:
    - `Pencil` (`icon-xs`, `ghost`) — toggles `editingTemplateId` between `tpl.id` and `null`.
    - `Plus` (`icon-xs`, `ghost`) — calls `materializeFormationTemplate`. Disabled when the resolver reports missing templates (tooltip `t('cannotMaterializeMissing')`); otherwise tooltip `t('materializeFormation')`.
    - `Trash2` (`icon-xs`, `ghost`) — `setFormationTemplates(prev => prev.filter(t => t.id !== id))`. No confirmation, matching existing patterns.

#### 5c. Inline slot editor

Rendered immediately under the row when `editingTemplateId === tpl.id`. Layout:

```
Slots
1.  [carTemplate select ▾]              [↑] [↓] [×]
2.  [carTemplate select ▾]              [↑] [↓] [×]
3.  ⚠ unknown (was tpl-7)               [pick replacement ▾] [×]
[ + Add slot ]
```

Behavior:

- The slot select uses the existing `Select`/`SelectItem` components already imported in `DepotPanel`. Options are `carTemplates`, labeled with the same compact subtitle the depot uses for car templates today (bogie count · length · width), plus the car template's `id` as a stable trailing tag for disambiguation. `CarTemplate` has no `name` field so we reuse the existing subtitle rather than introducing one.
- Unresolved slots render with `AlertTriangle` + `t('unknownCarTemplate', { id })`, paired with a select to pick a replacement. The id is preserved (not auto-cleared) so the user can see exactly which template went missing.
- `↑` swaps with the previous slot; disabled on the first slot. `↓` swaps with the next; disabled on the last.
- `×` removes the slot. Disabled when `slots.length <= 1` (Formation requires ≥1 child).
- `+ Add slot` appends `{ carTemplateId: carTemplates[0].id }`. Disabled with `t('addSlotNoCarTemplates')` when `carTemplates.length === 0`.

All slot mutations call `setFormationTemplates(prev => prev.map(t => t.id === id ? { ...t, slots: nextSlots } : t))`.

### 6. `src/assets/icons/lucide.ts` (modified)

Re-export `AlertTriangle` if it isn't already present, alongside the icons currently re-exported. (Verify before editing — the icon may already be available.)

### 7. i18n (`src/i18n/locales/en.ts`, `zh-TW.ts`, `ja.ts`)

| key                       | en                                          | zh-TW                  | ja                              |
| ------------------------- | ------------------------------------------- | ---------------------- | ------------------------------- |
| `formationTemplates`      | Formation Templates                         | 編組樣板               | 編成テンプレート                |
| `carTemplates`            | Car Templates                               | 車廂樣板               | 車両テンプレート                |
| `newFormationTemplate`    | New formation template                      | 新編組樣板             | 新しい編成テンプレート          |
| `noFormationTemplates`    | No formation templates yet                  | 尚無編組樣板           | 編成テンプレートはまだありません |
| `slot_one`                | {{count}} slot                              | {{count}} 節           | {{count}} 両分                  |
| `slot_other`              | {{count}} slots                             | {{count}} 節           | {{count}} 両分                  |
| `missingCarTemplates`     | {{count}} missing template                  | 缺少 {{count}} 個樣板  | テンプレート {{count}} 件不足   |
| `unknownCarTemplate`      | unknown (was {{id}})                        | 未知（{{id}}）         | 不明（{{id}}）                  |
| `addSlot`                 | Add slot                                    | 新增節                 | 両を追加                        |
| `materializeFormation`    | Create formation                            | 建立編組               | 編成を作成                      |
| `cannotMaterializeMissing`| Resolve missing car templates first         | 請先處理缺少的車廂樣板 | 不足テンプレートを先に解決      |
| `addSlotNoCarTemplates`   | Add a car template first                    | 請先建立車廂樣板       | 先に車両テンプレートを作成      |

The existing `templates` key (used today as the car-templates section header) is replaced with `carTemplates`. A grep confirms `templates` is not referenced elsewhere; no alias is needed.

The `slot_*` and `missingCarTemplates` plural forms follow the existing i18next convention used by `bogieCount` and `car` (see `bogieCount_one`/`bogieCount_other` and `car_one`/`car_other` in the locale files).

## Tests

Bun test, mirroring the existing `test/trains/` layout. Use `mock.module()` from `bun:test` only if needed; the resolver test is fully pure.

### `test/trains/formation-template-resolve.test.ts`

- Empty `available` + non-empty slots → `{ ok: false, missingTemplateIds: [<each unique id in slot order>] }`.
- All slots resolved → `{ ok: true, carTemplates: [<in slot order, including duplicates>] }`.
- Mixed resolved + unresolved → `{ ok: false, missingTemplateIds: <deduped, in first-occurrence order> }`.
- Single-slot resolved → `{ ok: true, carTemplates: [t] }`.

### `test/trains/formation-template-materialize.test.ts`

Construct a `CarStockManager`, `FormationManager` (wired to the stock manager), and `CarImageRegistry`. Use real instances rather than mocks — they have no external dependencies.

- **Happy path**: 3-slot template with 2 distinct car templates (one with image, one without). After materialize: `formationManager.count === 1`; the new formation has 3 cars in slot order; each car's spec (`bogieOffsets`, `edgeToBogie`, `bogieToEdge`, `width`, `type`) matches the source car template; the formation's `name` matches the template's `name`; `carImageRegistry.get` returns the image src for the cars whose source template had an image and `null`/undefined for the one that didn't; `carStockManager.getAvailableCars().length === 0` (cars were pulled into the formation).
- **Missing template path**: template has 1 slot referencing a non-existent car-template id. Materialize returns `{ ok: false, missingTemplateIds: [<id>] }`. `formationManager.count === 0` and `carStockManager.getAvailableCars().length === 0` (no side effects).

## Data flow

```
DepotPanel "+" click on row
  └─> materializeFormationTemplate({ template, carTemplates, ... })
        ├─ resolveFormationTemplate
        │     ├─ ok=false → return early (UI already disables button; defensive)
        │     └─ ok=true  → continue
        ├─ for each resolved car template:
        │     ├─ carStockManager.createCar(spec)        → new Car in stock
        │     └─ if template.image: carImageRegistry.set(newCar.id, src)
        ├─ formationManager.createFormation(newCarIds)  → pulls cars into Formation
        ├─ formationManager.renameFormation(id, template.name)
        └─ return { ok: true, formationId }
              └─ FormationManager observers fire → FormationEditor and FormationSelector re-render
```

## Risks / interactions

- **Stock round-trip**: `createCar` then `createFormation([carIds])` briefly puts cars in the stock list before pulling them out. This emits transient stock-change notifications. Acceptable: `DepotPanel` re-renders a frame with the new cars present, then a frame with them gone. No user-visible flicker because the materialize handler runs synchronously inside one React event. A `FormationManager.createFormationFromCars(cars)` shortcut that skips the round-trip is explicitly deferred per the brainstorming discussion.
- **Car-template deletion mid-edit**: a user can delete a car template while the formation-template editor is open, leaving slots pointing at a now-missing id. The editor handles this naturally — the resolver detects it on next render and the slot row switches to its unresolved-state UI without any teardown.
- **`createCar` width parameter**: `CarTemplate.width` is required; `CarStockManager.createCar(..., width)` already accepts an optional `width` parameter (used by the existing per-car-template `+` flow in `DepotPanel`). No new manager-API surface needed.
- **Empty depot**: when `carTemplates` is empty, the user can still create a formation template (the row appears) but the editor's `Add slot` and the row's `+` button are disabled with explanatory tooltips. The single auto-created slot will reference an empty string `carTemplateId` and immediately render as unresolved — acceptable as a discoverability hint that car templates are needed first. (Alternative: block creation entirely when `carTemplates` is empty. Going with the current behavior because it surfaces the workflow earlier.)
- **No persistence**: closing the tab loses formation templates. Matches `carTemplates` and is called out as a non-goal. Promotable later via the same path that would persist car templates.
