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

export function IndustryInfoPanel({
    industryManager,
    onClose,
}: IndustryInfoPanelProps) {
    const selectedIndustryId = useEconomyUIStore(s => s.selectedIndustryId);

    if (selectedIndustryId === null) {
        return (
            <DraggablePanel
                title="Industry Info"
                onClose={onClose}
                className="w-64"
            >
                <Separator className="mb-2" />
                <span className="text-muted-foreground block py-4 text-center text-xs">
                    Select an industry to inspect
                </span>
            </DraggablePanel>
        );
    }

    const industry = industryManager.getIndustry(selectedIndustryId);
    if (!industry) {
        return (
            <DraggablePanel
                title="Industry Info"
                onClose={onClose}
                className="w-64"
            >
                <Separator className="mb-2" />
                <span className="text-muted-foreground block py-4 text-center text-xs">
                    Industry not found
                </span>
            </DraggablePanel>
        );
    }

    const recipe = getRecipe(industry.type);
    const color = INDUSTRY_TYPE_COLORS[industry.type];

    return (
        <DraggablePanel
            title="Industry Info"
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
                    {INDUSTRY_TYPE_LABELS[industry.type]} #{industry.id}
                </div>
                <div className="text-muted-foreground text-xs">
                    Workers: {industry.workerCount} / {recipe.workersRequired}{' '}
                    required
                </div>
            </div>

            <div className="mb-2">
                <div className="mb-1 text-xs font-medium">Recipe</div>
                <div className="text-muted-foreground text-xs">
                    {recipe.inputs.size === 0 ? (
                        <div>
                            Inputs:{' '}
                            <span className="text-muted-foreground/50">
                                none
                            </span>
                        </div>
                    ) : (
                        <div>
                            Inputs:{' '}
                            {Array.from(recipe.inputs.entries())
                                .map(
                                    ([r, rate]) =>
                                        `${RESOURCE_LABELS[r]} ${rate}/min`
                                )
                                .join(', ')}
                        </div>
                    )}
                    <div>
                        Outputs:{' '}
                        {Array.from(recipe.outputs.entries())
                            .map(
                                ([r, rate]) =>
                                    `${RESOURCE_LABELS[r]} ${rate}/min`
                            )
                            .join(', ')}
                    </div>
                </div>
            </div>

            <div className="text-muted-foreground text-xs">
                {industry.assignedStationId !== null
                    ? `Assigned to station #${industry.assignedStationId}`
                    : 'No station in range'}
            </div>
        </DraggablePanel>
    );
}
