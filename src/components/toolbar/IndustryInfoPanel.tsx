import { useTranslation } from 'react-i18next';

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

const INDUSTRY_TYPE_KEYS: Record<IndustryType, string> = {
    [IndustryType.FARM]: 'economyIndustryFarm',
    [IndustryType.LUMBER_MILL]: 'economyIndustryLumberMill',
    [IndustryType.WORKSHOP]: 'economyIndustryWorkshop',
};

const INDUSTRY_TYPE_COLORS: Record<IndustryType, string> = {
    [IndustryType.FARM]: '#8bc34a',
    [IndustryType.LUMBER_MILL]: '#795548',
    [IndustryType.WORKSHOP]: '#607d8b',
};

const RESOURCE_KEYS: Record<ResourceType, string> = {
    [ResourceType.FOOD]: 'economyResourceFood',
    [ResourceType.GOODS]: 'economyResourceGoods',
    [ResourceType.WORKERS]: 'economyResourceWorkers',
    [ResourceType.BUILDING_MATERIALS]: 'economyResourceMaterials',
};

export function IndustryInfoPanel({
    industryManager,
    onClose,
}: IndustryInfoPanelProps) {
    const { t } = useTranslation();
    const selectedIndustryId = useEconomyUIStore(s => s.selectedIndustryId);

    if (selectedIndustryId === null) {
        return (
            <DraggablePanel
                title={t('economyIndustryInfo')}
                onClose={onClose}
                className="w-64"
            >
                <Separator className="mb-2" />
                <span className="text-muted-foreground block py-4 text-center text-xs">
                    {t('economySelectIndustry')}
                </span>
            </DraggablePanel>
        );
    }

    const industry = industryManager.getIndustry(selectedIndustryId);
    if (!industry) {
        return (
            <DraggablePanel
                title={t('economyIndustryInfo')}
                onClose={onClose}
                className="w-64"
            >
                <Separator className="mb-2" />
                <span className="text-muted-foreground block py-4 text-center text-xs">
                    {t('economyIndustryNotFound')}
                </span>
            </DraggablePanel>
        );
    }

    const recipe = getRecipe(industry.type);
    const color = INDUSTRY_TYPE_COLORS[industry.type];

    return (
        <DraggablePanel
            title={t('economyIndustryInfo')}
            onClose={onClose}
            className="w-64"
        >
            <Separator className="mb-2" />
            <div
                className="mb-2 rounded-lg px-2.5 py-1.5"
                style={{
                    background: `${color}20`,
                    borderLeft: `3px solid ${color}`,
                }}
            >
                <div className="text-sm font-medium">
                    {t(INDUSTRY_TYPE_KEYS[industry.type])} #{industry.id}
                </div>
                <div className="text-muted-foreground text-xs">
                    {t('economyWorkers')}: {industry.workerCount} /{' '}
                    {recipe.workersRequired} {t('economyRequired')}
                </div>
            </div>

            <div className="mb-2">
                <div className="mb-1 text-xs font-medium">
                    {t('economyRecipe')}
                </div>
                <div className="text-muted-foreground text-xs">
                    {recipe.inputs.size === 0 ? (
                        <div>
                            {t('economyInputs')}:{' '}
                            <span className="text-muted-foreground/50">
                                {t('economyInputsNone')}
                            </span>
                        </div>
                    ) : (
                        <div>
                            {t('economyInputs')}:{' '}
                            {Array.from(recipe.inputs.entries())
                                .map(
                                    ([r, rate]) =>
                                        `${t(RESOURCE_KEYS[r])} ${rate}/min`
                                )
                                .join(', ')}
                        </div>
                    )}
                    <div>
                        {t('economyOutputs')}:{' '}
                        {Array.from(recipe.outputs.entries())
                            .map(
                                ([r, rate]) =>
                                    `${t(RESOURCE_KEYS[r])} ${rate}/min`
                            )
                            .join(', ')}
                    </div>
                </div>
            </div>

            <div className="text-muted-foreground text-xs">
                {industry.assignedStationId !== null
                    ? t('economyAssignedToStation', {
                          id: industry.assignedStationId,
                      })
                    : t('economyNoStationInRange')}
            </div>
        </DraggablePanel>
    );
}
