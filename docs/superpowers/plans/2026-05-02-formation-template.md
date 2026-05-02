# Formation Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a customizable, named formation blueprint ("formation template") that the user can save in the depot and materialize into a fresh depot `Formation` with a click. The materialized formation contains brand-new cars manufactured from existing `CarTemplate` recipes (no stock consumption).

**Architecture:** A pure data + resolver module mirrors `car-template.ts`. A small materialization helper composes existing `CarStockManager.createCar` and `FormationManager.createFormation` calls — no new manager APIs. Templates live as `useState` in `BananaToolbar`, threaded into `DepotPanel`, where a new "Formation Templates" section provides create / rename / edit / delete affordances with an inline slot editor and a warning badge for unresolved car-template references.

**Tech Stack:** TypeScript, React + Tailwind, lucide icons via `@/assets/icons` (`Pencil`, `Plus`, `Trash2`, `TriangleAlertIcon`, `ChevronUp`, `ChevronDown`, `X`), shadcn `Select`/`SelectItem`/`Button`/`Separator`, i18next (plural form `_one`/`_other`), Bun test runner (`bun:test`).

**Spec reference:** `docs/superpowers/specs/2026-05-02-formation-template-design.md`.

**Conventions:**

- 4-space indentation, single quotes, trailing comma `es5` (Prettier — `bun run format` before commit if unsure).
- Conventional commits scoped to area: `feat(depot): ...` for code, `docs: ...` for docs-only.
- All icons imported from `@/assets/icons`, never directly from `lucide-react`.
- Tests use `bun:test` (`import { describe, it, expect } from 'bun:test'`).

**Out of scope (do NOT do these in this plan):**

- Persistence across sessions or addition to scene serialization.
- Nested formation templates.
- Per-slot `flipped` / gangway override.
- Use of formation templates in the train placement dropdown.
- Bulk operations (multi-select, duplicate, import/export).
- A `FormationManager.createFormationFromCars(cars)` shortcut. The current implementation does the stock round-trip intentionally.

---

## File Structure

**New files:**

- `src/trains/formation-template.ts` — `FormationTemplate`, `FormationTemplateSlot`, `generateFormationTemplateId`, `resolveFormationTemplate`.
- `src/trains/formation-template-materialize.ts` — `materializeFormationTemplate({ template, carTemplates, carStockManager, formationManager, carImageRegistry })`.
- `test/formation-template-resolve.test.ts`
- `test/formation-template-materialize.test.ts`

**Modified files:**

- `src/trains/index.ts` — re-export the new types and helpers.
- `src/components/toolbar/BananaToolbar.tsx` — `useState<FormationTemplate[]>` sibling to `carTemplates`; pass to `DepotPanel`.
- `src/components/toolbar/DepotPanel.tsx` — new "Formation Templates" section, rename existing `t('templates')` to `t('carTemplates')`, accept new props (`formationTemplates`, `onFormationTemplatesChange`, `formationManager`).
- `src/i18n/locales/en.ts`, `src/i18n/locales/zh-TW.ts`, `src/i18n/locales/ja.ts` — add new keys, replace `templates` with `carTemplates`.

---

## Task 1: Data type + resolver (TDD)

**Files:**

- Create: `src/trains/formation-template.ts`
- Create: `test/formation-template-resolve.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/formation-template-resolve.test.ts` with the following content:

```ts
import { describe, expect, it } from 'bun:test';

import type { CarTemplate } from '../src/trains/car-template';
import {
    type FormationTemplate,
    resolveFormationTemplate,
} from '../src/trains/formation-template';

function tpl(id: string): CarTemplate {
    return {
        id,
        bogieOffsets: [10],
        edgeToBogie: 2.5,
        bogieToEdge: 2.5,
        width: 2.5,
    };
}

function ftpl(slots: { carTemplateId: string }[]): FormationTemplate {
    return { id: 'f1', name: 'F1', slots };
}

describe('resolveFormationTemplate', () => {
    it('returns ok with car templates in slot order when all slots resolve', () => {
        const a = tpl('a');
        const b = tpl('b');
        const result = resolveFormationTemplate(
            ftpl([
                { carTemplateId: 'b' },
                { carTemplateId: 'a' },
                { carTemplateId: 'b' },
            ]),
            [a, b]
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.carTemplates).toEqual([b, a, b]);
        }
    });

    it('returns missing ids in first-occurrence order, deduped', () => {
        const a = tpl('a');
        const result = resolveFormationTemplate(
            ftpl([
                { carTemplateId: 'a' },
                { carTemplateId: 'gone-1' },
                { carTemplateId: 'gone-2' },
                { carTemplateId: 'gone-1' },
            ]),
            [a]
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.missingTemplateIds).toEqual(['gone-1', 'gone-2']);
        }
    });

    it('returns ok for a single resolved slot', () => {
        const a = tpl('a');
        const result = resolveFormationTemplate(
            ftpl([{ carTemplateId: 'a' }]),
            [a]
        );
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.carTemplates).toEqual([a]);
    });

    it('returns the empty-string slot id as missing', () => {
        const result = resolveFormationTemplate(
            ftpl([{ carTemplateId: '' }]),
            []
        );
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.missingTemplateIds).toEqual(['']);
    });
});
```

- [ ] **Step 2: Run tests; confirm they fail**

Run: `bun test test/formation-template-resolve.test.ts`
Expected: FAIL — `Cannot find module '../src/trains/formation-template'`.

- [ ] **Step 3: Implement `formation-template.ts`**

Create `src/trains/formation-template.ts`:

```ts
import type { CarTemplate } from './car-template';

/**
 * Single slot inside a FormationTemplate. The wrapper object (rather than a
 * bare string) leaves room for future per-slot extras (e.g. flipped) without
 * a schema migration.
 */
export type FormationTemplateSlot = {
    carTemplateId: string;
};

/**
 * A reusable, named blueprint for building a depot Formation by manufacturing
 * fresh cars from existing CarTemplate recipes. References car templates by id;
 * unresolved references are surfaced as warnings rather than blocking edits.
 */
export type FormationTemplate = {
    id: string;
    name: string;
    /** Length must be >= 1; ordered head-to-tail. */
    slots: FormationTemplateSlot[];
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
 * On success, returns the resolved car templates in slot order (duplicates
 * preserved). On failure, returns the deduplicated, in-first-occurrence-order
 * list of unresolved ids.
 */
export function resolveFormationTemplate(
    tpl: FormationTemplate,
    available: readonly CarTemplate[]
): FormationTemplateResolution {
    const byId = new Map<string, CarTemplate>();
    for (const ct of available) byId.set(ct.id, ct);

    const resolved: CarTemplate[] = [];
    const missing: string[] = [];
    const seenMissing = new Set<string>();

    for (const slot of tpl.slots) {
        const found = byId.get(slot.carTemplateId);
        if (found === undefined) {
            if (!seenMissing.has(slot.carTemplateId)) {
                seenMissing.add(slot.carTemplateId);
                missing.push(slot.carTemplateId);
            }
        } else {
            resolved.push(found);
        }
    }

    if (missing.length > 0) {
        return { ok: false, missingTemplateIds: missing };
    }
    return { ok: true, carTemplates: resolved };
}
```

- [ ] **Step 4: Run tests; confirm they pass**

Run: `bun test test/formation-template-resolve.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/trains/formation-template.ts test/formation-template-resolve.test.ts
git commit -m "feat(trains): add FormationTemplate type and resolver"
```

---

## Task 2: Materialize helper (TDD)

**Files:**

- Create: `src/trains/formation-template-materialize.ts`
- Create: `test/formation-template-materialize.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/formation-template-materialize.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';

import { CarImageRegistry } from '../src/trains/car-image-registry';
import { CarStockManager } from '../src/trains/car-stock-manager';
import type { CarTemplate } from '../src/trains/car-template';
import { CarType } from '../src/trains/cars';
import { FormationManager } from '../src/trains/formation-manager';
import type { FormationTemplate } from '../src/trains/formation-template';
import { materializeFormationTemplate } from '../src/trains/formation-template-materialize';

function makeCarTemplate(
    id: string,
    overrides: Partial<CarTemplate> = {}
): CarTemplate {
    return {
        id,
        bogieOffsets: [12],
        edgeToBogie: 2.5,
        bogieToEdge: 2.5,
        width: 2.8,
        type: CarType.COACH,
        ...overrides,
    };
}

function makeManagers() {
    const carStockManager = new CarStockManager();
    const formationManager = new FormationManager(carStockManager);
    const carImageRegistry = new CarImageRegistry();
    return { carStockManager, formationManager, carImageRegistry };
}

describe('materializeFormationTemplate', () => {
    it('creates a depot formation with cars matching each slot in order', () => {
        const { carStockManager, formationManager, carImageRegistry } =
            makeManagers();
        const a = makeCarTemplate('a', { width: 2.5 });
        const b = makeCarTemplate('b', { width: 3.0, bogieOffsets: [15] });
        const tpl: FormationTemplate = {
            id: 'ftpl-1',
            name: 'Local Express',
            slots: [
                { carTemplateId: 'a' },
                { carTemplateId: 'b' },
                { carTemplateId: 'a' },
            ],
        };

        const result = materializeFormationTemplate({
            template: tpl,
            carTemplates: [a, b],
            carStockManager,
            formationManager,
            carImageRegistry,
        });

        expect(result.ok).toBe(true);
        expect(formationManager.count).toBe(1);
        expect(carStockManager.getAvailableCars().length).toBe(0);

        if (!result.ok) return;
        const formation = formationManager.getFormation(result.formationId);
        expect(formation).not.toBeNull();
        expect(formation!.name).toBe('Local Express');

        const cars = formation!.flatCars();
        expect(cars.length).toBe(3);
        expect(cars[0].width).toBe(2.5);
        expect(cars[1].width).toBe(3.0);
        expect(cars[1].bogieOffsets()).toEqual([15]);
        expect(cars[2].width).toBe(2.5);
    });

    it('registers images for slots whose source template carries one', () => {
        const { carStockManager, formationManager, carImageRegistry } =
            makeManagers();
        const withImage = makeCarTemplate('img', {
            image: {
                src: 'data:image/png;base64,xxx',
                position: { x: 0, y: 0 },
                width: 10,
                height: 5,
            },
        });
        const plain = makeCarTemplate('plain');

        const result = materializeFormationTemplate({
            template: {
                id: 'ftpl-2',
                name: 'Mixed',
                slots: [{ carTemplateId: 'img' }, { carTemplateId: 'plain' }],
            },
            carTemplates: [withImage, plain],
            carStockManager,
            formationManager,
            carImageRegistry,
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const cars = formationManager
            .getFormation(result.formationId)!
            .flatCars();
        expect(carImageRegistry.get(cars[0].id)).toBe(
            'data:image/png;base64,xxx'
        );
        expect(carImageRegistry.has(cars[1].id)).toBe(false);
    });

    it('returns missing template ids without side effects when unresolved', () => {
        const { carStockManager, formationManager, carImageRegistry } =
            makeManagers();
        const result = materializeFormationTemplate({
            template: {
                id: 'ftpl-3',
                name: 'Broken',
                slots: [{ carTemplateId: 'gone' }],
            },
            carTemplates: [],
            carStockManager,
            formationManager,
            carImageRegistry,
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.missingTemplateIds).toEqual(['gone']);
        }
        expect(formationManager.count).toBe(0);
        expect(carStockManager.getAvailableCars().length).toBe(0);
    });
});
```

- [ ] **Step 2: Run tests; confirm they fail**

Run: `bun test test/formation-template-materialize.test.ts`
Expected: FAIL — `Cannot find module '../src/trains/formation-template-materialize'`.

- [ ] **Step 3: Implement `formation-template-materialize.ts`**

Create `src/trains/formation-template-materialize.ts`:

```ts
import type { CarImageRegistry } from './car-image-registry';
import type { CarStockManager } from './car-stock-manager';
import type { CarTemplate } from './car-template';
import type { FormationManager } from './formation-manager';
import {
    type FormationTemplate,
    resolveFormationTemplate,
} from './formation-template';

export type MaterializeFormationTemplateArgs = {
    template: FormationTemplate;
    carTemplates: readonly CarTemplate[];
    carStockManager: CarStockManager;
    formationManager: FormationManager;
    carImageRegistry: CarImageRegistry;
};

export type MaterializeFormationTemplateResult =
    | { ok: true; formationId: string }
    | { ok: false; missingTemplateIds: string[] };

/**
 * Build a fresh depot Formation from a FormationTemplate.
 *
 * Manufactures one new Car per slot using the resolved CarTemplate's spec,
 * registers any per-template image, then composes the cars into a new
 * Formation in the FormationManager (named after the template). Cars are
 * pulled from stock during the round-trip; on success no cars remain in stock.
 *
 * Returns the missing-template-ids list without touching any manager when the
 * template references one or more deleted car templates. The DepotPanel UI
 * already disables the trigger button in this case; the early return is a
 * defensive fallback.
 */
export function materializeFormationTemplate(
    args: MaterializeFormationTemplateArgs
): MaterializeFormationTemplateResult {
    const {
        template,
        carTemplates,
        carStockManager,
        formationManager,
        carImageRegistry,
    } = args;

    const resolution = resolveFormationTemplate(template, carTemplates);
    if (!resolution.ok) {
        return {
            ok: false,
            missingTemplateIds: resolution.missingTemplateIds,
        };
    }

    const newCarIds: string[] = [];
    for (const ct of resolution.carTemplates) {
        const car = carStockManager.createCar(
            [...ct.bogieOffsets],
            ct.edgeToBogie,
            ct.bogieToEdge,
            ct.type,
            ct.width
        );
        if (ct.image) {
            carImageRegistry.set(car.id, ct.image.src);
        }
        newCarIds.push(car.id);
    }

    const formation = formationManager.createFormation(newCarIds);
    formationManager.renameFormation(formation.id, template.name);

    return { ok: true, formationId: formation.id };
}
```

- [ ] **Step 4: Run tests; confirm they pass**

Run: `bun test test/formation-template-materialize.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Run full test suite as a sanity check**

Run: `bun test`
Expected: all tests pass (resolver + materialize tests added; nothing else changed).

- [ ] **Step 6: Commit**

```bash
git add src/trains/formation-template-materialize.ts test/formation-template-materialize.test.ts
git commit -m "feat(trains): add materializeFormationTemplate helper"
```

---

## Task 3: Re-export from `src/trains/index.ts`

**Files:**

- Modify: `src/trains/index.ts`

- [ ] **Step 1: Read the current barrel**

Run: `cat src/trains/index.ts`
Expected: a list of `export * from './...';` lines and/or named re-exports including `car-template`.

- [ ] **Step 2: Add re-exports**

Append (or place in alphabetical order, matching the existing style of the file) the following lines next to the `car-template` re-export:

```ts
export {
    type FormationTemplate,
    type FormationTemplateResolution,
    type FormationTemplateSlot,
    generateFormationTemplateId,
    resolveFormationTemplate,
} from './formation-template';
export {
    type MaterializeFormationTemplateArgs,
    type MaterializeFormationTemplateResult,
    materializeFormationTemplate,
} from './formation-template-materialize';
```

If the barrel currently uses `export * from './car-template';` style, prefer the matching style (`export * from './formation-template';` and `export * from './formation-template-materialize';`).

- [ ] **Step 3: Type-check**

Run: `bun run build`
Expected: build succeeds with no new TS errors.

- [ ] **Step 4: Commit**

```bash
git add src/trains/index.ts
git commit -m "feat(trains): re-export formation template helpers"
```

---

## Task 4: i18n keys

**Files:**

- Modify: `src/i18n/locales/en.ts`
- Modify: `src/i18n/locales/zh-TW.ts`
- Modify: `src/i18n/locales/ja.ts`

The existing `templates` key (used today as the car-templates header in `DepotPanel.tsx`) is replaced by `carTemplates`. The Step 5 task updates the only consumer; for now we add the new key without removing the old one so the app continues to type-check between commits.

- [ ] **Step 1: Add keys to `en.ts`**

In `src/i18n/locales/en.ts`, locate the "Depot Panel" block (around the `templates: 'Templates',` line). Add `carTemplates` next to `templates`, then append the new formation-template keys to the same block:

```ts
        // Depot Panel
        depot: 'Depot',
        noCarsInStock: 'No cars in stock',
        bogieCount: '{{count}} bogies',
        templates: 'Templates',
        carTemplates: 'Car Templates',
        formationTemplates: 'Formation Templates',
        newFormationTemplate: 'New formation template',
        noFormationTemplates: 'No formation templates yet',
        slot_one: '{{count}} slot',
        slot_other: '{{count}} slots',
        missingCarTemplates_one: '{{count}} missing template',
        missingCarTemplates_other: '{{count}} missing templates',
        unknownCarTemplate: 'unknown (was {{id}})',
        addSlot: 'Add slot',
        materializeFormation: 'Create formation',
        cannotMaterializeMissing: 'Resolve missing car templates first',
        addSlotNoCarTemplates: 'Add a car template first',
        editSlots: 'Edit slots',
```

- [ ] **Step 2: Add keys to `zh-TW.ts`**

Same insertion point. Translations:

```ts
        carTemplates: '車廂樣板',
        formationTemplates: '編組樣板',
        newFormationTemplate: '新編組樣板',
        noFormationTemplates: '尚無編組樣板',
        slot_one: '{{count}} 節',
        slot_other: '{{count}} 節',
        missingCarTemplates_one: '缺少 {{count}} 個樣板',
        missingCarTemplates_other: '缺少 {{count}} 個樣板',
        unknownCarTemplate: '未知（{{id}}）',
        addSlot: '新增節',
        materializeFormation: '建立編組',
        cannotMaterializeMissing: '請先處理缺少的車廂樣板',
        addSlotNoCarTemplates: '請先建立車廂樣板',
        editSlots: '編輯節',
```

- [ ] **Step 3: Add keys to `ja.ts`**

Same insertion point. Translations:

```ts
        carTemplates: '車両テンプレート',
        formationTemplates: '編成テンプレート',
        newFormationTemplate: '新しい編成テンプレート',
        noFormationTemplates: '編成テンプレートはまだありません',
        slot_one: '{{count}} 両分',
        slot_other: '{{count}} 両分',
        missingCarTemplates_one: 'テンプレート {{count}} 件不足',
        missingCarTemplates_other: 'テンプレート {{count}} 件不足',
        unknownCarTemplate: '不明（{{id}}）',
        addSlot: '両を追加',
        materializeFormation: '編成を作成',
        cannotMaterializeMissing: '不足テンプレートを先に解決',
        addSlotNoCarTemplates: '先に車両テンプレートを作成',
        editSlots: 'スロットを編集',
```

- [ ] **Step 4: Verify build**

Run: `bun run build`
Expected: build succeeds — i18n locale objects are typed structurally so the build catches mistyped keys.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/locales/en.ts src/i18n/locales/zh-TW.ts src/i18n/locales/ja.ts
git commit -m "feat(i18n): add formation template strings"
```

---

## Task 5: DepotPanel — list view, create, materialize, delete

This task threads the new state through `BananaToolbar` and renders the read-only formation-template row UI: section header, create button, per-row subtitle (slot count, warning badge), materialize (`+`) button, delete (`Trash2`) button. The pencil/edit button and inline editor land in Task 6.

**Files:**

- Modify: `src/components/toolbar/BananaToolbar.tsx`
- Modify: `src/components/toolbar/DepotPanel.tsx`

- [ ] **Step 1: Add `formationTemplates` state to `BananaToolbar.tsx`**

Locate the existing line (around line 223):

```ts
const [carTemplates, setCarTemplates] = useState<CarTemplate[]>([]);
```

Add the import next to the existing `CarTemplate` import (around line 67):

```ts
import {
    type CarTemplate,
    generateTemplateId,
    validateCarDefinition,
} from '@/trains/car-template';
import type { FormationTemplate } from '@/trains/formation-template';
```

Add the sibling state immediately after `carTemplates`:

```ts
const [carTemplates, setCarTemplates] = useState<CarTemplate[]>([]);
const [formationTemplates, setFormationTemplates] = useState<
    FormationTemplate[]
>([]);
```

- [ ] **Step 2: Pass new props to `<DepotPanel />`**

Locate the `<DepotPanel ... />` usage (around line 1297). Add three props:

```tsx
{
    showDepot && (
        <DepotPanel
            carStockManager={app.carStockManager}
            carImageRegistry={app.carImageRegistry}
            carTemplates={carTemplates}
            onCarTemplatesChange={setCarTemplates}
            formationTemplates={formationTemplates}
            onFormationTemplatesChange={setFormationTemplates}
            formationManager={app.formationManager}
            onClose={() => setPanel('depot', false)}
        />
    );
}
```

This will compile-error against the current `DepotPanelProps` until step 3.

- [ ] **Step 3: Extend `DepotPanelProps` and imports**

In `src/components/toolbar/DepotPanel.tsx`, extend imports at the top of the file:

```ts
import { Pencil, Plus, Trash2, TriangleAlertIcon } from '@/assets/icons';
import type { FormationManager } from '@/trains/formation-manager';
import type { FormationTemplate } from '@/trains/formation-template';
import { resolveFormationTemplate } from '@/trains/formation-template';
import { generateFormationTemplateId } from '@/trains/formation-template';
import {
    type MaterializeFormationTemplateResult,
    materializeFormationTemplate,
} from '@/trains/formation-template-materialize';
```

(Consolidate to a single `from '@/trains/formation-template'` import block in the final file.)

Update the props type:

```ts
type DepotPanelProps = {
    carStockManager: CarStockManager;
    carImageRegistry: CarImageRegistry;
    carTemplates: CarTemplate[];
    onCarTemplatesChange: Dispatch<SetStateAction<CarTemplate[]>>;
    formationTemplates: FormationTemplate[];
    onFormationTemplatesChange: Dispatch<SetStateAction<FormationTemplate[]>>;
    formationManager: FormationManager;
    onClose: () => void;
};
```

Destructure the new props in the component signature:

```tsx
export function DepotPanel({
    carStockManager,
    carImageRegistry,
    carTemplates,
    onCarTemplatesChange,
    formationTemplates,
    onFormationTemplatesChange,
    formationManager,
    onClose,
}: DepotPanelProps) {
```

- [ ] **Step 4: Rename existing `t('templates')` to `t('carTemplates')`**

Locate the existing line in `DepotPanel.tsx` (around line 113):

```tsx
<span className="text-muted-foreground mb-1 text-[10px] font-medium tracking-wider uppercase">
    {t('templates')}
</span>
```

Change to:

```tsx
<span className="text-muted-foreground mb-1 text-[10px] font-medium tracking-wider uppercase">
    {t('carTemplates')}
</span>
```

- [ ] **Step 5: Add the formation-template handlers**

Add the following inside `DepotPanel` body, near the `newCarType` state declaration (the exact placement just needs to be inside the function so the closures see `carTemplates`, `formationTemplates`, `onFormationTemplatesChange`, etc.):

```tsx
const handleCreateFormationTemplate = useCallback(() => {
    const tpl: FormationTemplate = {
        id: generateFormationTemplateId(),
        name: t('newFormationTemplate'),
        slots: [{ carTemplateId: carTemplates[0]?.id ?? '' }],
    };
    onFormationTemplatesChange(prev => [...prev, tpl]);
}, [t, carTemplates, onFormationTemplatesChange]);

const handleMaterializeFormationTemplate = useCallback(
    (tpl: FormationTemplate) => {
        const result: MaterializeFormationTemplateResult =
            materializeFormationTemplate({
                template: tpl,
                carTemplates,
                carStockManager,
                formationManager,
                carImageRegistry,
            });
        // The UI disables the trigger when the resolver reports missing ids,
        // so the failure branch is a defensive fallback (no toast).
        void result;
    },
    [carTemplates, carStockManager, formationManager, carImageRegistry]
);

const handleDeleteFormationTemplate = useCallback(
    (id: string) => {
        onFormationTemplatesChange(prev => prev.filter(t => t.id !== id));
    },
    [onFormationTemplatesChange]
);
```

- [ ] **Step 6: Render the formation-template section**

Add a new block immediately **after** the closing fragment of the existing car-template block (i.e. right before the closing `</DraggablePanel>` of `DepotPanel`):

```tsx
{
    (formationTemplates.length > 0 || carTemplates.length > 0) && (
        <>
            <Separator className="my-2" />
            <div className="mb-1 flex items-center justify-between">
                <span className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
                    {t('formationTemplates')}
                </span>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={handleCreateFormationTemplate}
                    disabled={carTemplates.length === 0}
                    title={
                        carTemplates.length === 0
                            ? t('addSlotNoCarTemplates')
                            : t('newFormationTemplate')
                    }
                >
                    <Plus className="size-3" />
                </Button>
            </div>
            {formationTemplates.length === 0 ? (
                <span className="text-muted-foreground py-2 text-center text-[10px]">
                    {t('noFormationTemplates')}
                </span>
            ) : (
                <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                    {formationTemplates.map(tpl => (
                        <FormationTemplateRow
                            key={tpl.id}
                            template={tpl}
                            carTemplates={carTemplates}
                            onMaterialize={handleMaterializeFormationTemplate}
                            onDelete={handleDeleteFormationTemplate}
                        />
                    ))}
                </div>
            )}
        </>
    );
}
```

- [ ] **Step 7: Add the `FormationTemplateRow` subcomponent**

Append at the end of `DepotPanel.tsx` (after the existing `DepotCarRow` definition):

```tsx
function FormationTemplateRow({
    template,
    carTemplates,
    onMaterialize,
    onDelete,
}: {
    template: FormationTemplate;
    carTemplates: CarTemplate[];
    onMaterialize: (tpl: FormationTemplate) => void;
    onDelete: (id: string) => void;
}) {
    const { t } = useTranslation();
    const resolution = resolveFormationTemplate(template, carTemplates);
    const missingCount = resolution.ok
        ? 0
        : resolution.missingTemplateIds.length;
    const slotCount = template.slots.length;

    return (
        <div className="bg-muted/50 flex items-center justify-between rounded-lg px-2.5 py-1.5">
            <div className="flex min-w-0 flex-col gap-0.5">
                <span
                    className="text-foreground truncate text-xs"
                    title={template.name}
                >
                    {template.name}
                </span>
                <span className="text-muted-foreground flex items-center gap-1 text-[10px]">
                    <span>{t('slot', { count: slotCount })}</span>
                    {missingCount > 0 && (
                        <span className="text-destructive flex items-center gap-0.5">
                            <TriangleAlertIcon className="size-2.5" />
                            {t('missingCarTemplates', {
                                count: missingCount,
                            })}
                        </span>
                    )}
                </span>
            </div>
            <div className="flex gap-0.5">
                <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => onMaterialize(template)}
                    disabled={missingCount > 0}
                    title={
                        missingCount > 0
                            ? t('cannotMaterializeMissing')
                            : t('materializeFormation')
                    }
                >
                    <Plus className="size-3" />
                </Button>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => onDelete(template.id)}
                >
                    <Trash2 className="size-3" />
                </Button>
            </div>
        </div>
    );
}
```

- [ ] **Step 8: Type-check + format**

Run: `bun run build`
Expected: build succeeds.

Run: `bun run format`
Expected: no errors. (Or apply changes; commit either way.)

- [ ] **Step 9: Manual UI test**

Run: `bun run dev`

Open the depot panel:

1. With **no car templates**: confirm the Formation Templates section header appears with a disabled `+` button (tooltip mentions creating a car template first).
2. Add a car template (via the existing in-app flow — easiest path is to import a car definition or click `+` in Car Templates if such an entry exists; otherwise via the train editor's save-to-library path). Confirm the Formation Templates `+` becomes enabled.
3. Click `+` → a row "New formation template" with subtitle "1 slot" appears, no warning badge.
4. Click the row's `+` (materialize) → open the Formation Editor; confirm a new depot formation named "New formation template" with 1 car appears.
5. Delete the underlying car template. Reopen the depot. Confirm the formation template row now shows "⚠ 1 missing template" and the row's `+` is disabled with the explanatory tooltip.
6. Click the row's trash → row disappears.

If any step misbehaves, fix and re-test before committing.

- [ ] **Step 10: Commit**

```bash
git add src/components/toolbar/BananaToolbar.tsx src/components/toolbar/DepotPanel.tsx
git commit -m "feat(depot): list, create, materialize, and delete formation templates"
```

---

## Task 6: Inline slot editor (rename, reorder, add/remove slots, change car template)

This task adds the editor that opens under a row when the user clicks the pencil icon: rename via input, slot list with `Select` per slot, up/down/remove buttons, and an "Add slot" button.

**Files:**

- Modify: `src/components/toolbar/DepotPanel.tsx`

- [ ] **Step 1: Track which template is being edited**

Inside `DepotPanel`, add a local state:

```tsx
const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
```

- [ ] **Step 2: Add slot/name mutators**

Inside `DepotPanel`:

```tsx
const handleRenameFormationTemplate = useCallback(
    (id: string, name: string) => {
        onFormationTemplatesChange(prev =>
            prev.map(t => (t.id === id ? { ...t, name } : t))
        );
    },
    [onFormationTemplatesChange]
);

const handleUpdateFormationTemplateSlots = useCallback(
    (id: string, slots: FormationTemplate['slots']) => {
        onFormationTemplatesChange(prev =>
            prev.map(t => (t.id === id ? { ...t, slots } : t))
        );
    },
    [onFormationTemplatesChange]
);
```

- [ ] **Step 3: Wire row edit toggle and pass mutators down**

Update the row render (from Task 5 Step 6) so each row gets the edit-state props:

```tsx
{
    formationTemplates.map(tpl => (
        <FormationTemplateRow
            key={tpl.id}
            template={tpl}
            carTemplates={carTemplates}
            isEditing={editingTemplateId === tpl.id}
            onToggleEdit={() =>
                setEditingTemplateId(prev => (prev === tpl.id ? null : tpl.id))
            }
            onRename={handleRenameFormationTemplate}
            onSlotsChange={handleUpdateFormationTemplateSlots}
            onMaterialize={handleMaterializeFormationTemplate}
            onDelete={handleDeleteFormationTemplate}
        />
    ));
}
```

- [ ] **Step 4: Update `FormationTemplateRow` props and render the pencil + editor**

Replace the existing `FormationTemplateRow` definition with the editor-aware version:

```tsx
function FormationTemplateRow({
    template,
    carTemplates,
    isEditing,
    onToggleEdit,
    onRename,
    onSlotsChange,
    onMaterialize,
    onDelete,
}: {
    template: FormationTemplate;
    carTemplates: CarTemplate[];
    isEditing: boolean;
    onToggleEdit: () => void;
    onRename: (id: string, name: string) => void;
    onSlotsChange: (id: string, slots: FormationTemplate['slots']) => void;
    onMaterialize: (tpl: FormationTemplate) => void;
    onDelete: (id: string) => void;
}) {
    const { t } = useTranslation();
    const resolution = resolveFormationTemplate(template, carTemplates);
    const missingCount = resolution.ok
        ? 0
        : resolution.missingTemplateIds.length;
    const slotCount = template.slots.length;

    const [isRenaming, setIsRenaming] = useState(false);
    const [draftName, setDraftName] = useState(template.name);
    const inputRef = useRef<HTMLInputElement>(null);

    const startRenaming = useCallback(() => {
        setDraftName(template.name);
        setIsRenaming(true);
        setTimeout(() => inputRef.current?.focus(), 0);
    }, [template.name]);

    const commitRename = useCallback(() => {
        const trimmed = draftName.trim();
        if (trimmed && trimmed !== template.name) {
            onRename(template.id, trimmed);
        }
        setIsRenaming(false);
    }, [draftName, template.id, template.name, onRename]);

    return (
        <div className="bg-muted/50 flex flex-col rounded-lg px-2.5 py-1.5">
            <div className="flex items-center justify-between">
                <div className="flex min-w-0 flex-col gap-0.5">
                    {isRenaming ? (
                        <input
                            ref={inputRef}
                            className="text-foreground bg-background border-primary/40 w-32 rounded border px-1 py-0 text-xs outline-none"
                            value={draftName}
                            onChange={e => setDraftName(e.target.value)}
                            onBlur={commitRename}
                            onKeyDown={e => {
                                if (e.key === 'Enter') commitRename();
                                if (e.key === 'Escape') setIsRenaming(false);
                            }}
                        />
                    ) : (
                        <span
                            className="text-foreground truncate text-xs"
                            title={template.name}
                            onDoubleClick={startRenaming}
                        >
                            {template.name}
                        </span>
                    )}
                    <span className="text-muted-foreground flex items-center gap-1 text-[10px]">
                        <span>{t('slot', { count: slotCount })}</span>
                        {missingCount > 0 && (
                            <span className="text-destructive flex items-center gap-0.5">
                                <TriangleAlertIcon className="size-2.5" />
                                {t('missingCarTemplates', {
                                    count: missingCount,
                                })}
                            </span>
                        )}
                    </span>
                </div>
                <div className="flex gap-0.5">
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={onToggleEdit}
                        title={t('editSlots')}
                    >
                        <Pencil className="size-3" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => onMaterialize(template)}
                        disabled={missingCount > 0}
                        title={
                            missingCount > 0
                                ? t('cannotMaterializeMissing')
                                : t('materializeFormation')
                        }
                    >
                        <Plus className="size-3" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => onDelete(template.id)}
                    >
                        <Trash2 className="size-3" />
                    </Button>
                </div>
            </div>
            {isEditing && (
                <FormationTemplateSlotEditor
                    template={template}
                    carTemplates={carTemplates}
                    onSlotsChange={slots => onSlotsChange(template.id, slots)}
                />
            )}
        </div>
    );
}
```

- [ ] **Step 5: Add the `FormationTemplateSlotEditor` subcomponent**

Append at the end of `DepotPanel.tsx`:

```tsx
function FormationTemplateSlotEditor({
    template,
    carTemplates,
    onSlotsChange,
}: {
    template: FormationTemplate;
    carTemplates: CarTemplate[];
    onSlotsChange: (slots: FormationTemplate['slots']) => void;
}) {
    const { t } = useTranslation();
    const knownIds = new Set(carTemplates.map(c => c.id));
    const fallbackId = carTemplates[0]?.id;

    const swap = (i: number, j: number) => {
        if (
            i < 0 ||
            j < 0 ||
            i >= template.slots.length ||
            j >= template.slots.length
        ) {
            return;
        }
        const next = [...template.slots];
        [next[i], next[j]] = [next[j], next[i]];
        onSlotsChange(next);
    };

    const removeAt = (i: number) => {
        if (template.slots.length <= 1) return;
        onSlotsChange(template.slots.filter((_, idx) => idx !== i));
    };

    const addSlot = () => {
        if (fallbackId === undefined) return;
        onSlotsChange([...template.slots, { carTemplateId: fallbackId }]);
    };

    const setSlotCarTemplate = (i: number, carTemplateId: string) => {
        const next = template.slots.map((slot, idx) =>
            idx === i ? { ...slot, carTemplateId } : slot
        );
        onSlotsChange(next);
    };

    const labelFor = (ct: CarTemplate) => {
        const length =
            ct.edgeToBogie +
            ct.bogieOffsets.reduce((a, b) => a + b, 0) +
            ct.bogieToEdge;
        return `${t('bogieCount', { count: ct.bogieOffsets.length + 1 })} · ${length}m · ${ct.width.toFixed(1)}m (${ct.id})`;
    };

    return (
        <div className="mt-1.5 flex flex-col gap-1 border-t pt-1.5">
            {template.slots.map((slot, i) => {
                const isUnknown = !knownIds.has(slot.carTemplateId);
                return (
                    <div
                        key={i}
                        className="flex items-center gap-1 text-[10px]"
                    >
                        <span className="text-muted-foreground w-4 text-right">
                            {i + 1}.
                        </span>
                        {isUnknown ? (
                            <span className="text-destructive flex flex-1 items-center gap-1">
                                <TriangleAlertIcon className="size-2.5" />
                                {t('unknownCarTemplate', {
                                    id: slot.carTemplateId,
                                })}
                            </span>
                        ) : null}
                        <Select
                            value={isUnknown ? '' : slot.carTemplateId}
                            onValueChange={(value: string) =>
                                setSlotCarTemplate(i, value)
                            }
                        >
                            <SelectTrigger
                                size="sm"
                                className="h-6 flex-1 text-[10px]"
                            >
                                <SelectValue
                                    placeholder={t('addSlotNoCarTemplates')}
                                />
                            </SelectTrigger>
                            <SelectContent>
                                {carTemplates.map(ct => (
                                    <SelectItem key={ct.id} value={ct.id}>
                                        {labelFor(ct)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => swap(i, i - 1)}
                            disabled={i === 0}
                            title="↑"
                        >
                            <ChevronUp className="size-3" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => swap(i, i + 1)}
                            disabled={i === template.slots.length - 1}
                            title="↓"
                        >
                            <ChevronDown className="size-3" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => removeAt(i)}
                            disabled={template.slots.length <= 1}
                        >
                            <X className="size-3" />
                        </Button>
                    </div>
                );
            })}
            <Button
                variant="ghost"
                size="sm"
                className="h-6 self-start text-[10px]"
                onClick={addSlot}
                disabled={fallbackId === undefined}
                title={
                    fallbackId === undefined
                        ? t('addSlotNoCarTemplates')
                        : t('addSlot')
                }
            >
                <Plus className="size-3" />
                {t('addSlot')}
            </Button>
        </div>
    );
}
```

Add the new icon imports at the top of `DepotPanel.tsx` (extending the existing `@/assets/icons` import):

```ts
import {
    ChevronDown,
    ChevronUp,
    Pencil,
    Plus,
    Trash2,
    TriangleAlertIcon,
    X,
} from '@/assets/icons';
```

- [ ] **Step 6: Type-check + format**

Run: `bun run build`
Expected: build succeeds.

Run: `bun run format`
Expected: no errors (or applies changes).

- [ ] **Step 7: Manual UI test**

Run: `bun run dev`

Walk through the full UX:

1. Create a couple of car templates (via the existing in-app flow).
2. Click `+` next to "Formation Templates" → row appears.
3. Double-click the name → input appears; rename to "Local Express"; press Enter; confirm name updates.
4. Click the pencil → editor opens; the single slot shows the current car template.
5. Click `Add slot` → second slot appears with the first car-template id selected.
6. Use the up/down buttons to reorder slots; observe order updates (no flicker).
7. Use a slot's select to change its car template; observe the slot updates.
8. Remove a slot via `×`; the last remaining slot's `×` should be disabled.
9. Click the row's `+` (materialize); confirm the resulting formation has cars matching the slot order.
10. Delete one of the car templates referenced by a slot. Observe: the row badge says "⚠ 1 missing template", the row's `+` is disabled, and the editor shows the unresolved slot with an `unknown (was tpl-…)` marker plus a select to repick.
11. Repick a replacement; the warning clears and `+` re-enables.
12. Click trash → row disappears.

If any step misbehaves, fix and re-test before committing.

- [ ] **Step 8: Run the full test suite**

Run: `bun test`
Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/components/toolbar/DepotPanel.tsx
git commit -m "feat(depot): inline editor for formation template slots"
```

---

## Done

After Task 6 the feature is complete: the user can create, rename, edit, materialize, and delete formation templates from the depot, with warnings for unresolved car-template references. The work compiles, passes the unit tests, and is verified manually in the browser.
