import { ResourceType, type SerializedStockpile } from './types';

export class Stockpile {
    private _resources: Map<ResourceType, number> = new Map();

    get(type: ResourceType): number {
        return this._resources.get(type) ?? 0;
    }

    add(type: ResourceType, amount: number): void {
        this._resources.set(type, this.get(type) + amount);
    }

    remove(type: ResourceType, amount: number): number {
        const available = this.get(type);
        const removed = Math.min(available, amount);
        const remaining = available - removed;
        if (remaining <= 0) {
            this._resources.delete(type);
        } else {
            this._resources.set(type, remaining);
        }
        return removed;
    }

    hasEnough(type: ResourceType, amount: number): boolean {
        return this.get(type) >= amount;
    }

    isEmpty(): boolean {
        return this._resources.size === 0;
    }

    entries(): [ResourceType, number][] {
        return Array.from(this._resources.entries());
    }

    clear(): void {
        this._resources.clear();
    }

    serialize(): SerializedStockpile {
        const data: SerializedStockpile = {};
        for (const [type, amount] of this._resources) {
            data[type] = amount;
        }
        return data;
    }

    static deserialize(data: SerializedStockpile): Stockpile {
        const stockpile = new Stockpile();
        for (const [key, amount] of Object.entries(data)) {
            stockpile.add(key as ResourceType, amount);
        }
        return stockpile;
    }
}
