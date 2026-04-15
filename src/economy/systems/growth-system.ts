// src/economy/systems/growth-system.ts
import type { EconomyState, ZoneEntity } from '../simulation-state';
import {
    DECAY_THRESHOLD,
    GROWTH_THRESHOLD,
    SATISFACTION_WINDOW_SIZE,
} from '../simulation-state';

export interface GrowthEvent {
    readonly type: 'spawn' | 'abandon';
    readonly zoneId: number;
}

function averageSatisfaction(zone: ZoneEntity): number {
    const history = zone.satisfactionHistory;
    if (history.length === 0) return zone.satisfaction;
    let sum = 0;
    for (const s of history) sum += s;
    return sum / history.length;
}

function isHistoryFull(zone: ZoneEntity): boolean {
    return zone.satisfactionHistory.length >= SATISFACTION_WINDOW_SIZE;
}

export function runGrowth(state: EconomyState): GrowthEvent[] {
    const events: GrowthEvent[] = [];

    for (const zone of state.zones.values()) {
        if (!isHistoryFull(zone)) continue;

        const avg = averageSatisfaction(zone);

        if (avg >= GROWTH_THRESHOLD) {
            zone.population += 1;
            events.push({ type: 'spawn', zoneId: zone.id });
        } else if (avg < DECAY_THRESHOLD && zone.population > 0) {
            zone.population -= 1;
            events.push({ type: 'abandon', zoneId: zone.id });
        }
    }

    return events;
}
