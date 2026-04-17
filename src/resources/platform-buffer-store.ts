import type {
    Buffer,
    PlatformHandle,
    PlatformResourceConfig,
    PlatformRole,
    ResourceCounts,
    ResourceTypeId,
} from './types';
import { encodePlatformKey } from './types';

type SerializedConfig = {
    platformKey: string;
    bufferMode: 'private' | 'sharedWithStation';
    roles: Partial<Record<ResourceTypeId, PlatformRole>>;
};

type SerializedBuffer = { platformKey: string; contents: ResourceCounts };
type SerializedSharedBuffer = { stationId: number; contents: ResourceCounts };

export type SerializedPlatformBufferStore = {
    configs: SerializedConfig[];
    privateBuffers: SerializedBuffer[];
    sharedBuffers: SerializedSharedBuffer[];
};

const DEFAULT_CONFIG: PlatformResourceConfig = {
    bufferMode: 'private',
    roles: {},
};

export class PlatformBufferStore {
    private _configs: Map<string, PlatformResourceConfig> = new Map();
    private _privateBuffers: Map<string, Buffer> = new Map();
    private _sharedBuffers: Map<number, Buffer> = new Map();
    // Remember which handles we've ever seen so getAllConfiguredPlatforms
    // can return them even if only a buffer was touched (no explicit config).
    private _knownHandles: Map<string, PlatformHandle> = new Map();

    getConfig(handle: PlatformHandle): PlatformResourceConfig {
        const key = encodePlatformKey(handle);
        this._knownHandles.set(key, handle);
        const existing = this._configs.get(key);
        if (existing) return existing;
        const fresh: PlatformResourceConfig = {
            bufferMode: 'private',
            roles: {},
        };
        this._configs.set(key, fresh);
        return fresh;
    }

    setBufferMode(
        handle: PlatformHandle,
        mode: 'private' | 'sharedWithStation',
    ): void {
        const config = this.getConfig(handle);
        config.bufferMode = mode;
    }

    getRole(handle: PlatformHandle, type: ResourceTypeId): PlatformRole | 'neither' {
        const config = this._configs.get(encodePlatformKey(handle));
        return config?.roles[type] ?? 'neither';
    }

    setRole(
        handle: PlatformHandle,
        type: ResourceTypeId,
        role: PlatformRole | 'neither',
    ): void {
        const config = this.getConfig(handle);
        if (role === 'neither') {
            delete config.roles[type];
        } else {
            config.roles[type] = role;
        }
    }

    getEffectiveBuffer(handle: PlatformHandle): Readonly<Buffer> {
        return Object.freeze({ ...this._resolveBuffer(handle, false) });
    }

    add(handle: PlatformHandle, type: ResourceTypeId, amount: number): number {
        if (!Number.isFinite(amount) || amount <= 0) return 0;
        const buf = this._resolveBuffer(handle, true);
        buf[type] = (buf[type] ?? 0) + amount;
        return amount;
    }

    remove(handle: PlatformHandle, type: ResourceTypeId, amount: number): number {
        if (!Number.isFinite(amount) || amount <= 0) return 0;
        const buf = this._resolveBuffer(handle, false);
        const have = buf[type] ?? 0;
        const actual = Math.min(amount, have);
        if (actual > 0) {
            const remaining = have - actual;
            if (remaining === 0) delete buf[type];
            else buf[type] = remaining;
        }
        return actual;
    }

    getAllConfiguredPlatforms(): readonly PlatformHandle[] {
        // Include platforms that have had any mutation (config OR buffer).
        const out: PlatformHandle[] = [];
        for (const handle of this._knownHandles.values()) out.push(handle);
        return out;
    }

    serialize(): SerializedPlatformBufferStore {
        const configs: SerializedConfig[] = [];
        for (const [key, cfg] of this._configs) {
            configs.push({
                platformKey: key,
                bufferMode: cfg.bufferMode,
                roles: { ...cfg.roles },
            });
        }
        const privateBuffers: SerializedBuffer[] = [];
        for (const [key, buf] of this._privateBuffers) {
            privateBuffers.push({ platformKey: key, contents: { ...buf } });
        }
        const sharedBuffers: SerializedSharedBuffer[] = [];
        for (const [stationId, buf] of this._sharedBuffers) {
            sharedBuffers.push({ stationId, contents: { ...buf } });
        }
        return { configs, privateBuffers, sharedBuffers };
    }

    hydrate(snap: SerializedPlatformBufferStore): void {
        this._configs.clear();
        this._privateBuffers.clear();
        this._sharedBuffers.clear();
        this._knownHandles.clear();
        for (const cfg of snap.configs) {
            this._configs.set(cfg.platformKey, {
                bufferMode: cfg.bufferMode,
                roles: { ...cfg.roles },
            });
            this._rememberFromKey(cfg.platformKey);
        }
        for (const b of snap.privateBuffers) {
            this._privateBuffers.set(b.platformKey, { ...b.contents });
            this._rememberFromKey(b.platformKey);
        }
        for (const b of snap.sharedBuffers) {
            this._sharedBuffers.set(b.stationId, { ...b.contents });
        }
    }

    // -------- internals --------

    private _resolveBuffer(handle: PlatformHandle, createIfMissing = true): Buffer {
        const key = encodePlatformKey(handle);
        const config = this._configs.get(key);
        if (config?.bufferMode === 'sharedWithStation') {
            let buf = this._sharedBuffers.get(handle.stationId);
            if (!buf) {
                if (!createIfMissing) return {};
                buf = {};
                this._sharedBuffers.set(handle.stationId, buf);
            }
            this._knownHandles.set(key, handle);
            return buf;
        }
        let buf = this._privateBuffers.get(key);
        if (!buf) {
            if (!createIfMissing) return {};
            buf = {};
            this._privateBuffers.set(key, buf);
        }
        this._knownHandles.set(key, handle);
        return buf;
    }

    private _rememberFromKey(key: string): void {
        const [kindStr, stationStr, platformStr] = key.split(':');
        if (kindStr !== 'island' && kindStr !== 'trackAligned') return;
        this._knownHandles.set(key, {
            kind: kindStr,
            stationId: Number(stationStr),
            platformId: Number(platformStr),
        });
    }
}
