import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    Check,
    Crop,
    Download,
    FolderOpen,
    GripHorizontal,
    Image,
    MousePointer2,
    Plus,
    Save,
    Upload,
    X,
} from '@/assets/icons';
import { CarDefinitionLibraryDialog } from '@/components/car-definition-library/CarDefinitionLibraryDialog';
import { SaveCarDefinitionDialog } from '@/components/car-definition-library/SaveCarDefinitionDialog';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
    CAR_DEFINITION_DATA_VERSION,
    type CarDefinitionData,
    type StoredCarDefinition,
    generateCarDefinitionId,
    getCarDefinitionStorage,
} from '@/storage';
import { CarType } from '@/trains/cars';

import { useTrainEditorApp } from './use-train-editor-app';

const CAR_TYPES = Object.values(CarType);

type TrainEditorMode =
    | 'idle'
    | 'edit-bogie'
    | 'add-bogie'
    | 'edit-image'
    | 'crop-image';

function ToolbarButton({
    tooltip,
    active,
    disabled,
    onClick,
    children,
}: {
    tooltip: string;
    active?: boolean;
    disabled?: boolean;
    onClick: () => void;
    children: ReactNode;
}) {
    const variant = active ? 'default' : 'ghost';

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    variant={variant}
                    size="icon-lg"
                    disabled={disabled}
                    onClick={onClick}
                >
                    {children}
                </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{tooltip}</TooltipContent>
        </Tooltip>
    );
}

function uploadJson(
    onJson: (parsed: unknown) => void,
    onError?: (error: string) => void
): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const parsed = JSON.parse(reader.result as string);
                onJson(parsed);
            } catch (e) {
                if (onError) {
                    onError((e as Error).message);
                }
            }
        };
        reader.readAsText(file);
    });
    input.click();
}

function uploadImage(
    onLoad: (src: string, pxWidth: number, pxHeight: number) => void
): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = reader.result as string;
            const img = new window.Image();
            img.onload = () => {
                onLoad(dataUrl, img.width, img.height);
            };
            img.src = dataUrl;
        };
        reader.readAsDataURL(file);
    });
    input.click();
}

export function TrainEditorToolbar() {
    const { t } = useTranslation();
    const app = useTrainEditorApp();
    const [mode, setMode] = useState<TrainEditorMode>('idle');
    const [carType, setCarType] = useState<CarType>(CarType.COACH);
    const [carWidth, setCarWidth] = useState<number>(2.5);
    const [loadedLibraryEntry, setLoadedLibraryEntry] = useState<{
        id: string;
        name: string;
    } | null>(null);
    const [saveDialogOpen, setSaveDialogOpen] = useState(false);
    const [libraryDialogOpen, setLibraryDialogOpen] = useState(false);
    const [pendingInitialName, setPendingInitialName] = useState('');

    const sourcePixelDimsRef = useRef<{ pxWidth: number; pxHeight: number }>({
        pxWidth: 0,
        pxHeight: 0,
    });

    // Subscribe to image changes:
    //   - couple image height → car body width when an image is present
    //   - keep source pixel dims fresh for crop commit (read by handleConfirmCrop)
    useEffect(() => {
        if (!app) return;
        const unsub = app.imageEditorEngine.onImageChanged(image => {
            if (!image) return;
            // Couple height → car width
            if (image.height !== carWidth) {
                setCarWidth(image.height);
                app.bogieEditorEngine.setWidth(image.height);
            }
            // Refresh source pixel dims so the next commit uses the correct
            // bitmap size. Decoding a data URL is cheap and runs off the hot path.
            const probe = new window.Image();
            probe.onload = () => {
                sourcePixelDimsRef.current = {
                    pxWidth: probe.width,
                    pxHeight: probe.height,
                };
            };
            probe.src = image.src;
        });
        return unsub;
    }, [app, carWidth]);

    const exitAllModes = useCallback(() => {
        if (!app) return;
        app.trainEditorKmtStateMachine.happens('switchToIdle');
        app.imageRenderSystem.showHandles = false;
        app.imageRenderSystem.showCropRect = false;
        setMode('idle');
    }, [app]);

    const handleEditBogieToggle = useCallback(() => {
        if (!app) return;
        if (mode === 'edit-bogie') {
            app.trainEditorKmtStateMachine.happens('switchToIdle');
            setMode('idle');
        } else {
            exitAllModes();
            app.trainEditorKmtStateMachine.happens('switchToEditBogie');
            setMode('edit-bogie');
        }
    }, [app, mode, exitAllModes]);

    const handleAddBogieToggle = useCallback(() => {
        if (!app) return;
        if (mode === 'add-bogie') {
            app.trainEditorKmtStateMachine.happens('switchToIdle');
            setMode('idle');
        } else {
            exitAllModes();
            app.trainEditorKmtStateMachine.happens('switchToAddBogie');
            setMode('add-bogie');
        }
    }, [app, mode, exitAllModes]);

    const handleEditImageToggle = useCallback(() => {
        if (!app) return;
        if (mode === 'edit-image') {
            app.trainEditorKmtStateMachine.happens('switchToIdle');
            app.imageRenderSystem.showHandles = false;
            setMode('idle');
        } else {
            exitAllModes();
            app.trainEditorKmtStateMachine.happens('switchToEditImage');
            app.imageRenderSystem.showHandles = true;
            setMode('edit-image');
        }
    }, [app, mode, exitAllModes]);

    const handleCropImageToggle = useCallback(() => {
        if (!app) return;
        if (mode === 'crop-image') {
            app.trainEditorKmtStateMachine.happens('switchToIdle');
            app.imageRenderSystem.showCropRect = false;
            setMode('idle');
        } else {
            exitAllModes();
            app.trainEditorKmtStateMachine.happens('switchToCropImage');
            app.imageRenderSystem.showHandles = false;
            app.imageRenderSystem.showCropRect = true;
            setMode('crop-image');
        }
    }, [app, mode, exitAllModes]);

    const handleConfirmCrop = useCallback(async () => {
        if (!app) return;
        // Toolbar owns commit so it can pass the source bitmap pixel dims
        // captured by the onImageChanged subscription above.
        await app.imageCropEngine.commit(sourcePixelDimsRef.current);
        app.imageCropStateMachine.happens('commitCrop', {});
        app.trainEditorKmtStateMachine.happens('switchToIdle');
        app.imageRenderSystem.showCropRect = false;
        setMode('idle');
    }, [app]);

    const handleCancelCrop = useCallback(() => {
        if (!app) return;
        app.imageCropStateMachine.happens('cancelCrop', {});
        app.trainEditorKmtStateMachine.happens('switchToIdle');
        app.imageRenderSystem.showCropRect = false;
        setMode('idle');
    }, [app]);

    const handleImportImage = useCallback(() => {
        if (!app) return;
        uploadImage((src, pxW, pxH) => {
            // Image's world height is set to the current car body width;
            // image world width derives from aspect ratio.
            const aspect = pxW / pxH;
            const worldH = carWidth;
            const worldW = worldH * aspect;
            app.imageEditorEngine.setImage(src, worldW, worldH);
            // Auto-switch to image edit mode
            exitAllModes();
            app.trainEditorKmtStateMachine.happens('switchToEditImage');
            app.imageRenderSystem.showHandles = true;
            setMode('edit-image');
        });
    }, [app, carWidth, exitAllModes]);

    const buildCarDefinitionData = useCallback((): CarDefinitionData | null => {
        if (!app) return null;
        const def = app.bogieEditorEngine.exportCarDefinition(
            undefined,
            undefined,
            carWidth
        );
        if (!def) return null;
        const image = app.imageEditorEngine.getImage();
        return {
            ...def,
            bogies: [...app.bogieEditorEngine.getBogies()],
            carType,
            image: image ? { ...image } : undefined,
        };
    }, [app, carType, carWidth]);

    const hydrateFromCarDefinition = useCallback(
        (data: Partial<CarDefinitionData>): boolean => {
            if (!app) return false;
            if (!data.bogieOffsets || !Array.isArray(data.bogieOffsets)) {
                alert(t('invalidFileMissingBogieOffsets'));
                return false;
            }
            const currentBogies = app.bogieEditorEngine.getBogies();
            for (let i = currentBogies.length - 1; i >= 0; i--) {
                app.bogieEditorEngine.removeBogie(i);
            }
            if (data.bogies && Array.isArray(data.bogies)) {
                for (const bogie of data.bogies) {
                    app.bogieEditorEngine.addBogie(bogie);
                }
            }
            if (data.image) {
                app.imageEditorEngine.setImage(
                    data.image.src,
                    data.image.width,
                    data.image.height
                );
                const img = app.imageEditorEngine.getImage();
                if (img) {
                    img.position = { ...data.image.position };
                    img.width = data.image.width;
                    img.height = data.image.height;
                }
                app.imageEditorEngine.notifyChange();
            }
            setCarType(data.carType ?? CarType.COACH);
            const w = typeof data.width === 'number' ? data.width : 2.5;
            setCarWidth(w);
            app.bogieEditorEngine.setWidth(w);
            return true;
        },
        [app, t]
    );

    const handleExport = useCallback(() => {
        const exportData = buildCarDefinitionData();
        if (!exportData) {
            alert(t('needAtLeast2Bogies'));
            return;
        }
        const json = JSON.stringify(exportData, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = `car-definition-${Date.now()}.json`;
        link.href = url;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }, [buildCarDefinitionData, t]);

    const handleImport = useCallback(() => {
        if (!app) return;
        uploadJson(
            parsed => {
                const data = parsed as Partial<CarDefinitionData>;
                if (hydrateFromCarDefinition(data)) {
                    // File-imported entries are not tracked as a library slot.
                    setLoadedLibraryEntry(null);
                }
            },
            error => alert(t('failedToParseJson', { error }))
        );
    }, [app, hydrateFromCarDefinition, t]);

    const handleOpenSaveDialog = useCallback(async () => {
        if (!app) return;
        const def = app.bogieEditorEngine.exportCarDefinition();
        if (!def) {
            alert(t('needAtLeast2Bogies'));
            return;
        }
        if (loadedLibraryEntry) {
            setPendingInitialName(loadedLibraryEntry.name);
        } else {
            const existing =
                await getCarDefinitionStorage().listCarDefinitions();
            setPendingInitialName(
                t('untitledCar', { count: existing.length + 1 })
            );
        }
        setSaveDialogOpen(true);
    }, [app, loadedLibraryEntry, t]);

    const handleConfirmSave = useCallback(
        async (name: string) => {
            const data = buildCarDefinitionData();
            if (!data) {
                alert(t('needAtLeast2Bogies'));
                return;
            }
            const now = Date.now();
            const id = loadedLibraryEntry?.id ?? generateCarDefinitionId();
            const existing = loadedLibraryEntry
                ? await getCarDefinitionStorage().loadCarDefinition(
                      loadedLibraryEntry.id
                  )
                : null;
            const createdAt = existing?.metadata.createdAt ?? now;
            const stored: StoredCarDefinition = {
                metadata: {
                    id,
                    name,
                    createdAt,
                    updatedAt: now,
                    version: CAR_DEFINITION_DATA_VERSION,
                },
                data,
            };
            await getCarDefinitionStorage().saveCarDefinition(stored);
            setLoadedLibraryEntry({ id, name });
        },
        [buildCarDefinitionData, loadedLibraryEntry, t]
    );

    const handleLoadFromLibrary = useCallback(
        (stored: StoredCarDefinition) => {
            if (hydrateFromCarDefinition(stored.data)) {
                setLoadedLibraryEntry({
                    id: stored.metadata.id,
                    name: stored.metadata.name,
                });
            }
        },
        [hydrateFromCarDefinition]
    );

    useEffect(() => {
        if (mode !== 'crop-image') return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleConfirmCrop();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                handleCancelCrop();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [mode, handleConfirmCrop, handleCancelCrop]);

    if (!app) return null;

    const hasImage = app.imageEditorEngine.getImage() !== null;
    const hasBogies = app.bogieEditorEngine.getBogies().length >= 2;

    return (
        <TooltipProvider delayDuration={200}>
            <div
                className={cn(
                    'pointer-events-auto absolute top-1/2 left-6 flex -translate-y-1/2 flex-col items-center gap-3'
                )}
            >
                <div className="bg-background/80 flex flex-col items-center gap-1 rounded-xl border p-1.5 shadow-lg backdrop-blur-sm">
                    {/* Edit bogies */}
                    <ToolbarButton
                        tooltip={
                            mode === 'edit-bogie'
                                ? t('endEdit')
                                : t('editBogies')
                        }
                        active={mode === 'edit-bogie'}
                        onClick={handleEditBogieToggle}
                    >
                        <MousePointer2 />
                    </ToolbarButton>

                    {/* Add bogie */}
                    <ToolbarButton
                        tooltip={
                            mode === 'add-bogie' ? t('endAdd') : t('addBogie')
                        }
                        active={mode === 'add-bogie'}
                        onClick={handleAddBogieToggle}
                    >
                        <Plus />
                    </ToolbarButton>

                    <Separator />

                    {/* Car type */}
                    <div className="w-full px-1">
                        <span className="text-muted-foreground text-[9px] font-medium tracking-wider uppercase">
                            {t('carType')}
                        </span>
                        <Select
                            value={carType}
                            onValueChange={(value: string) =>
                                setCarType(value as CarType)
                            }
                        >
                            <SelectTrigger
                                size="sm"
                                className="h-6 w-full text-[10px]"
                            >
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
                    </div>

                    {/* Car width */}
                    <div className="w-full px-1">
                        <span className="text-muted-foreground text-[9px] font-medium tracking-wider uppercase">
                            {t('carWidth')}
                        </span>
                        <input
                            type="number"
                            min={0.5}
                            max={10}
                            step={0.1}
                            value={carWidth}
                            disabled={mode === 'crop-image'}
                            onChange={e => {
                                const v = parseFloat(e.target.value);
                                if (Number.isFinite(v) && v > 0) {
                                    setCarWidth(v);
                                    app?.bogieEditorEngine.setWidth(v);
                                    app?.imageEditorEngine.rescaleToWidth(v);
                                }
                            }}
                            className="border-input bg-background h-6 w-full rounded-md border px-2 text-[10px]"
                        />
                    </div>

                    <Separator />

                    {/* Import image */}
                    <ToolbarButton
                        tooltip={t('importImage')}
                        onClick={handleImportImage}
                    >
                        <Image />
                    </ToolbarButton>

                    {/* Edit image */}
                    <ToolbarButton
                        tooltip={
                            mode === 'edit-image'
                                ? t('endImageEdit')
                                : t('editImage')
                        }
                        active={mode === 'edit-image'}
                        disabled={
                            (!hasImage && mode !== 'edit-image') ||
                            mode === 'crop-image'
                        }
                        onClick={handleEditImageToggle}
                    >
                        <GripHorizontal />
                    </ToolbarButton>

                    {/* Crop image */}
                    <ToolbarButton
                        tooltip={
                            mode === 'crop-image'
                                ? t('endCrop')
                                : t('cropImage')
                        }
                        active={mode === 'crop-image'}
                        disabled={!hasImage && mode !== 'crop-image'}
                        onClick={handleCropImageToggle}
                    >
                        <Crop />
                    </ToolbarButton>

                    {mode === 'crop-image' && (
                        <>
                            <ToolbarButton
                                tooltip={t('confirmCrop')}
                                onClick={handleConfirmCrop}
                            >
                                <Check />
                            </ToolbarButton>
                            <ToolbarButton
                                tooltip={t('cancelCrop')}
                                onClick={handleCancelCrop}
                            >
                                <X />
                            </ToolbarButton>
                        </>
                    )}

                    <Separator />

                    {/* Export */}
                    <ToolbarButton
                        tooltip={t('exportCarDefinition')}
                        disabled={!hasBogies}
                        onClick={handleExport}
                    >
                        <Download />
                    </ToolbarButton>

                    {/* Import */}
                    <ToolbarButton
                        tooltip={t('importCarDefinition')}
                        onClick={handleImport}
                    >
                        <Upload />
                    </ToolbarButton>

                    <Separator />

                    {/* Save to library */}
                    <ToolbarButton
                        tooltip={t('saveToLibrary')}
                        disabled={!hasBogies}
                        onClick={handleOpenSaveDialog}
                    >
                        <Save />
                    </ToolbarButton>

                    {/* Load from library */}
                    <ToolbarButton
                        tooltip={t('loadFromLibrary')}
                        onClick={() => setLibraryDialogOpen(true)}
                    >
                        <FolderOpen />
                    </ToolbarButton>
                </div>
            </div>

            <SaveCarDefinitionDialog
                open={saveDialogOpen}
                onOpenChange={setSaveDialogOpen}
                initialName={pendingInitialName}
                updatingExisting={loadedLibraryEntry !== null}
                onConfirm={handleConfirmSave}
            />
            <CarDefinitionLibraryDialog
                open={libraryDialogOpen}
                onOpenChange={setLibraryDialogOpen}
                onPick={handleLoadFromLibrary}
                highlightedId={loadedLibraryEntry?.id ?? null}
            />
        </TooltipProvider>
    );
}
