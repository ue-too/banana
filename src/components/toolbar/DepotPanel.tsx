import {
    type Dispatch,
    type SetStateAction,
    useCallback,
    useRef,
    useState,
    useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';

import {
    ChevronDown,
    ChevronUp,
    Pencil,
    Plus,
    Trash2,
    TriangleAlertIcon,
    X,
} from '@/assets/icons';
import { Button } from '@/components/ui/button';
import { DraggablePanel } from '@/components/ui/draggable-panel';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import type { CarImageRegistry } from '@/trains/car-image-registry';
import type { CarStockManager } from '@/trains/car-stock-manager';
import type { CarStockEntry } from '@/trains/car-stock-manager';
import type { CarTemplate } from '@/trains/car-template';
import { CarType } from '@/trains/cars';
import type { FormationManager } from '@/trains/formation-manager';
import {
    type FormationTemplate,
    generateFormationTemplateId,
    resolveFormationTemplate,
} from '@/trains/formation-template';
import {
    type MaterializeFormationTemplateResult,
    materializeFormationTemplate,
} from '@/trains/formation-template-materialize';

const CAR_TYPES = Object.values(CarType);

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
    const subscribe = useCallback(
        (cb: () => void) => carStockManager.subscribe(cb),
        [carStockManager]
    );
    const getSnapshot = useCallback(
        (): readonly CarStockEntry[] => carStockManager.getAvailableCars(),
        [carStockManager]
    );
    const availableCars = useSyncExternalStore(subscribe, getSnapshot);
    const { t } = useTranslation();
    const [newCarType, setNewCarType] = useState<CarType>(CarType.COACH);

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

    const [editingTemplateId, setEditingTemplateId] = useState<string | null>(
        null
    );

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

    return (
        <DraggablePanel title={t('depot')} onClose={onClose} className="w-56">
            <Separator className="mb-2" />
            <div className="mb-2 flex items-center gap-1">
                <Select
                    value={newCarType}
                    onValueChange={(value: string) =>
                        setNewCarType(value as CarType)
                    }
                >
                    <SelectTrigger size="sm" className="h-6 flex-1 text-[10px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {CAR_TYPES.map(ct => (
                            <SelectItem key={ct} value={ct}>
                                {t(`carType_${ct}`)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() =>
                        carStockManager.createCar(
                            undefined,
                            undefined,
                            undefined,
                            newCarType
                        )
                    }
                >
                    <Plus className="size-3.5" />
                </Button>
            </div>
            <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
                {availableCars.length === 0 ? (
                    <span className="text-muted-foreground py-4 text-center text-xs">
                        {t('noCarsInStock')}
                    </span>
                ) : (
                    availableCars.map(entry => (
                        <DepotCarRow
                            key={entry.id}
                            entry={entry}
                            carStockManager={carStockManager}
                        />
                    ))
                )}
            </div>

            {carTemplates.length > 0 && (
                <>
                    <Separator className="my-2" />
                    <span className="text-muted-foreground mb-1 text-[10px] font-medium tracking-wider uppercase">
                        {t('carTemplates')}
                    </span>
                    <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                        {carTemplates.map(tpl => (
                            <div
                                key={tpl.id}
                                className="bg-muted/50 flex items-center justify-between rounded-lg px-2.5 py-1.5"
                            >
                                <div className="flex flex-col gap-0.5">
                                    {tpl.image && (
                                        <img
                                            src={tpl.image.src}
                                            alt="car"
                                            className="h-6 w-auto rounded object-contain"
                                        />
                                    )}
                                    <span className="text-muted-foreground text-[10px]">
                                        {t('bogieCount', {
                                            count: tpl.bogieOffsets.length + 1,
                                        })}
                                        {' · '}
                                        {tpl.edgeToBogie +
                                            tpl.bogieOffsets.reduce(
                                                (a, b) => a + b,
                                                0
                                            ) +
                                            tpl.bogieToEdge}
                                        m{' · '}
                                        {tpl.width.toFixed(1)}m
                                    </span>
                                </div>
                                <div className="flex gap-0.5">
                                    <Button
                                        variant="ghost"
                                        size="icon-xs"
                                        onClick={() => {
                                            const newCar =
                                                carStockManager.createCar(
                                                    [...tpl.bogieOffsets],
                                                    tpl.edgeToBogie,
                                                    tpl.bogieToEdge,
                                                    tpl.type,
                                                    tpl.width
                                                );
                                            if (tpl.image) {
                                                carImageRegistry.set(
                                                    newCar.id,
                                                    tpl.image.src
                                                );
                                            }
                                        }}
                                    >
                                        <Plus className="size-3" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon-xs"
                                        onClick={() =>
                                            onCarTemplatesChange(prev =>
                                                prev.filter(
                                                    t => t.id !== tpl.id
                                                )
                                            )
                                        }
                                    >
                                        <Trash2 className="size-3" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}

            {(formationTemplates.length > 0 || carTemplates.length > 0) && (
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
                                    isEditing={editingTemplateId === tpl.id}
                                    onToggleEdit={() =>
                                        setEditingTemplateId(prev =>
                                            prev === tpl.id ? null : tpl.id
                                        )
                                    }
                                    onRename={handleRenameFormationTemplate}
                                    onSlotsChange={
                                        handleUpdateFormationTemplateSlots
                                    }
                                    onMaterialize={
                                        handleMaterializeFormationTemplate
                                    }
                                    onDelete={handleDeleteFormationTemplate}
                                />
                            ))}
                        </div>
                    )}
                </>
            )}
        </DraggablePanel>
    );
}

function DepotCarRow({
    entry,
    carStockManager,
}: {
    entry: CarStockEntry;
    carStockManager: CarStockManager;
}) {
    const { t } = useTranslation();
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    const startEditing = useCallback(() => {
        setEditValue(entry.car.name);
        setIsEditing(true);
        setTimeout(() => inputRef.current?.focus(), 0);
    }, [entry.car.name]);

    const commitRename = useCallback(() => {
        const trimmed = editValue.trim();
        if (trimmed && trimmed !== entry.car.name) {
            carStockManager.renameCar(entry.id, trimmed);
        }
        setIsEditing(false);
    }, [editValue, entry.car.name, entry.id, carStockManager]);

    return (
        <div className="bg-muted/50 flex items-center justify-between rounded-lg px-2.5 py-1.5">
            <div className="flex min-w-0 flex-col">
                <div className="flex min-w-0 items-center gap-1">
                    {isEditing ? (
                        <input
                            ref={inputRef}
                            className="text-foreground bg-background border-primary/40 w-24 rounded border px-1 py-0 font-mono text-xs outline-none"
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onBlur={commitRename}
                            onKeyDown={e => {
                                if (e.key === 'Enter') commitRename();
                                if (e.key === 'Escape') setIsEditing(false);
                            }}
                        />
                    ) : (
                        <span
                            className="text-foreground truncate font-mono text-xs"
                            title={t('renameCar')}
                            onDoubleClick={startEditing}
                        >
                            {entry.car.name}
                        </span>
                    )}
                    {!isEditing && (
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={startEditing}
                        >
                            <Pencil className="size-2.5" />
                        </Button>
                    )}
                </div>
                <span className="text-muted-foreground text-[10px]">
                    {t(`carType_${entry.car.type}`)}
                    {' · '}
                    {t('bogieCount', {
                        count: entry.car.bogieOffsets().length + 1,
                    })}
                    {' · '}
                    {entry.car.edgeToBogie +
                        entry.car.bogieOffsets().reduce((a, b) => a + b, 0) +
                        entry.car.bogieToEdge}
                    m{' · '}
                    {entry.car.width.toFixed(1)}m
                </span>
            </div>
            <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => carStockManager.removeCar(entry.id)}
            >
                <Trash2 className="size-3" />
            </Button>
        </div>
    );
}

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
