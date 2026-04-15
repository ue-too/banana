import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DraggablePanel } from '@/components/ui/draggable-panel';
import { Separator } from '@/components/ui/separator';
import type { EconomyManager } from '@/economy/economy-manager';
import { ResourceType } from '@/economy/types';
import { useEconomyUIStore } from '@/stores/economy-ui-store';

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

const RESOURCE_KEYS: Record<ResourceType, string> = {
    [ResourceType.FOOD]: 'economyResourceFood',
    [ResourceType.GOODS]: 'economyResourceGoods',
    [ResourceType.WORKERS]: 'economyResourceWorkers',
    [ResourceType.BUILDING_MATERIALS]: 'economyResourceMaterials',
};

const RESOURCE_COLORS: Record<ResourceType, string> = {
    [ResourceType.FOOD]: '#4caf50',
    [ResourceType.GOODS]: '#2196f3',
    [ResourceType.WORKERS]: '#ff9800',
    [ResourceType.BUILDING_MATERIALS]: '#795548',
};

export function StationCargoPanel({
    economyManager,
    onClose,
}: StationCargoPanelProps) {
    const { t } = useTranslation();
    const selectedStationId = useEconomyUIStore(s => s.selectedStationId);
    const [, setVersion] = useState(0);

    if (selectedStationId === null) {
        return (
            <DraggablePanel
                title={t('economyStationCargo')}
                onClose={onClose}
                className="w-72"
            >
                <Separator className="mb-2" />
                <span className="text-muted-foreground block py-4 text-center text-xs">
                    {t('economySelectStation')}
                </span>
            </DraggablePanel>
        );
    }

    const stationData = economyManager.getStationEconomy(selectedStationId);
    if (!stationData) {
        return (
            <DraggablePanel
                title={t('economyStationCargo')}
                onClose={onClose}
                className="w-72"
            >
                <Separator className="mb-2" />
                <span className="text-muted-foreground block py-4 text-center text-xs">
                    {t('economyStationNotFound')}
                </span>
            </DraggablePanel>
        );
    }

    const handleAutoToggle = () => {
        economyManager.setAutoMode(selectedStationId, !stationData.autoMode);
        setVersion(v => v + 1);
    };

    const handleLoadToggle = (resource: ResourceType) => {
        economyManager.setLoadRule(
            selectedStationId,
            resource,
            !stationData.loadRules.has(resource)
        );
        setVersion(v => v + 1);
    };

    const handleUnloadToggle = (resource: ResourceType) => {
        economyManager.setUnloadRule(
            selectedStationId,
            resource,
            !stationData.unloadRules.has(resource)
        );
        setVersion(v => v + 1);
    };

    return (
        <DraggablePanel
            title={`Station #${selectedStationId} Cargo`}
            onClose={onClose}
            className="w-72"
        >
            <Separator className="mb-2" />

            <label className="text-muted-foreground mb-2 flex cursor-pointer items-center gap-2 text-xs">
                <input
                    type="checkbox"
                    checked={stationData.autoMode}
                    onChange={handleAutoToggle}
                    className="rounded"
                />
                {t('economyAutoMode')}
            </label>

            <table className="w-full text-xs">
                <thead>
                    <tr className="border-border text-muted-foreground border-b">
                        <th className="py-1 text-left font-medium">
                            {t('economyResource')}
                        </th>
                        <th className="py-1 text-center font-medium">
                            {t('economyLoad')}
                        </th>
                        <th className="py-1 text-center font-medium">
                            {t('economyUnload')}
                        </th>
                        <th className="py-1 text-right font-medium">
                            {t('economyStock')}
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {ALL_RESOURCES.map(resource => (
                        <tr
                            key={resource}
                            className="border-border/50 border-b"
                        >
                            <td className="flex items-center gap-1.5 py-1">
                                <span
                                    className="inline-block size-2 rounded-full"
                                    style={{
                                        backgroundColor:
                                            RESOURCE_COLORS[resource],
                                    }}
                                />
                                {t(RESOURCE_KEYS[resource])}
                            </td>
                            <td className="py-1 text-center">
                                <input
                                    type="checkbox"
                                    checked={stationData.loadRules.has(
                                        resource
                                    )}
                                    onChange={() => handleLoadToggle(resource)}
                                    disabled={stationData.autoMode}
                                    className="rounded"
                                />
                            </td>
                            <td className="py-1 text-center">
                                <input
                                    type="checkbox"
                                    checked={stationData.unloadRules.has(
                                        resource
                                    )}
                                    onChange={() =>
                                        handleUnloadToggle(resource)
                                    }
                                    disabled={stationData.autoMode}
                                    className="rounded"
                                />
                            </td>
                            <td
                                className="py-1 text-right"
                                style={{ color: RESOURCE_COLORS[resource] }}
                            >
                                {Math.round(
                                    stationData.stockpile.get(resource)
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </DraggablePanel>
    );
}
