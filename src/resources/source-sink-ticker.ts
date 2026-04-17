import type { PlatformBufferStore } from './platform-buffer-store';
import { SINK_RATE, SOURCE_RATE } from './types';

export class SourceSinkTicker {
    constructor(private readonly _bufferStore: PlatformBufferStore) {}

    update(dt: number): void {
        if (!Number.isFinite(dt) || dt <= 0) return;
        for (const handle of this._bufferStore.getAllConfiguredPlatforms()) {
            const config = this._bufferStore.getConfig(handle);
            // Object.entries skips absent keys — that IS the 'neither' branch.
            for (const [resourceType, role] of Object.entries(config.roles)) {
                if (role === 'source') {
                    this._bufferStore.add(handle, resourceType, SOURCE_RATE * dt);
                } else if (role === 'sink') {
                    this._bufferStore.remove(handle, resourceType, SINK_RATE * dt);
                }
            }
        }
    }
}
