import { DraggablePanel } from '@/components/ui/draggable-panel';
import { Separator } from '@/components/ui/separator';
import type { CityGrowthManager } from '@/economy/city-growth-manager';
import type { CityCluster } from '@/economy/simulation-state';
import type { ZoneManager } from '@/economy/zone-manager';

type CityOverviewPanelProps = {
    cityGrowthManager: CityGrowthManager;
    zoneManager: ZoneManager;
    onClose: () => void;
};

function reputationColor(rep: number): string {
    if (rep >= 0.6) return '#4caf50';
    if (rep >= 0.3) return '#ff9800';
    return '#e53935';
}

function cityPopulation(city: CityCluster, zoneManager: ZoneManager): number {
    let total = 0;
    for (const zoneId of city.zoneIds) {
        const zone = zoneManager.getZone(zoneId);
        if (zone) total += zone.population;
    }
    return total;
}

export function CityOverviewPanel({
    cityGrowthManager,
    zoneManager,
    onClose,
}: CityOverviewPanelProps) {
    const cities = cityGrowthManager.getAllCities();

    return (
        <DraggablePanel title="Cities" onClose={onClose} className="w-64">
            <Separator className="mb-2" />
            {cities.length === 0 ? (
                <span className="text-muted-foreground block py-4 text-center text-xs">
                    No cities yet
                </span>
            ) : (
                <div className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
                    {cities.map(city => {
                        const pop = cityPopulation(city, zoneManager);
                        return (
                            <div
                                key={city.id}
                                className="bg-muted/50 rounded-lg px-2.5 py-1.5"
                            >
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium">
                                        City #{city.id}
                                    </span>
                                    <span
                                        className="text-xs"
                                        style={{
                                            color: reputationColor(
                                                city.reputation
                                            ),
                                        }}
                                    >
                                        Rep: {city.reputation.toFixed(2)}
                                    </span>
                                </div>
                                <div className="text-muted-foreground text-xs">
                                    Pop: {pop} | {city.zoneIds.size} zones |{' '}
                                    {city.stationIds.size} station
                                    {city.stationIds.size !== 1 ? 's' : ''}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </DraggablePanel>
    );
}
