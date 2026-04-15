import { DraggablePanel } from '@/components/ui/draggable-panel';
import { Separator } from '@/components/ui/separator';
import { ResourceType, ZoneType } from '@/economy/types';
import type { ZoneManager } from '@/economy/zone-manager';
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

    if (selectedZoneId === null) {
        return (
            <DraggablePanel
                title="Zone Info"
                onClose={onClose}
                className="w-64"
            >
                <Separator className="mb-2" />
                <span className="text-muted-foreground block py-4 text-center text-xs">
                    Select a zone to inspect
                </span>
            </DraggablePanel>
        );
    }

    const zone = zoneManager.getZone(selectedZoneId);
    if (!zone) {
        return (
            <DraggablePanel
                title="Zone Info"
                onClose={onClose}
                className="w-64"
            >
                <Separator className="mb-2" />
                <span className="text-muted-foreground block py-4 text-center text-xs">
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
                className="mb-2 rounded-lg px-2.5 py-1.5"
                style={{
                    background: `${color}20`,
                    borderLeft: `3px solid ${color}`,
                }}
            >
                <div className="text-sm font-medium">
                    {ZONE_TYPE_LABELS[zone.type]} Zone #{zone.id}
                </div>
                <div className="text-muted-foreground text-xs">
                    Population: {zone.population}
                </div>
            </div>

            <div className="mb-2">
                <div className="mb-1 flex justify-between text-xs">
                    <span className="text-muted-foreground">Satisfaction</span>
                    <span className="text-muted-foreground">
                        {satisfactionPct}%
                    </span>
                </div>
                <div className="bg-muted h-2 rounded-full">
                    <div
                        className="h-2 rounded-full transition-all"
                        style={{
                            width: `${satisfactionPct}%`,
                            backgroundColor:
                                satisfactionPct >= 60
                                    ? '#4caf50'
                                    : satisfactionPct >= 30
                                      ? '#ff9800'
                                      : '#e53935',
                        }}
                    />
                </div>
            </div>

            {zone.demandPerMinute.size > 0 && (
                <div>
                    <div className="mb-1 text-xs font-medium">Demand / min</div>
                    {Array.from(zone.demandPerMinute.entries()).map(
                        ([resource, rate]) => (
                            <div
                                key={resource}
                                className="text-muted-foreground flex justify-between text-xs"
                            >
                                <span>{RESOURCE_LABELS[resource]}</span>
                                <span>{rate.toFixed(1)}</span>
                            </div>
                        )
                    )}
                </div>
            )}
        </DraggablePanel>
    );
}
