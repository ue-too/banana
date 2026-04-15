import { useTranslation } from 'react-i18next';

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

export function TransportDemandPanel({
    resourceManager,
    onClose,
}: TransportDemandPanelProps) {
    const { t } = useTranslation();
    const summary = resourceManager.getGlobalSummary();

    return (
        <DraggablePanel
            title={t('economyTransportDemand')}
            onClose={onClose}
            className="w-64"
        >
            <Separator className="mb-2" />
            <div className="flex flex-col gap-2">
                {ALL_RESOURCES.map(resource => {
                    const supply = summary.totalSupply.get(resource) ?? 0;
                    const demand = summary.totalDemand.get(resource) ?? 0;
                    const ratio = demand > 0 ? Math.min(supply / demand, 1) : 1;
                    const barColor =
                        ratio >= 0.8
                            ? '#4caf50'
                            : ratio >= 0.4
                              ? '#ff9800'
                              : '#e53935';

                    return (
                        <div key={resource}>
                            <div className="mb-0.5 flex justify-between text-xs">
                                <span
                                    style={{ color: RESOURCE_COLORS[resource] }}
                                >
                                    {t(RESOURCE_KEYS[resource])}
                                </span>
                                <span className="text-muted-foreground">
                                    {Math.round(supply)} {t('economySupply')} |{' '}
                                    {demand.toFixed(1)}
                                    {t('economyDemandRate')}
                                </span>
                            </div>
                            <div className="bg-muted h-1.5 rounded-full">
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
