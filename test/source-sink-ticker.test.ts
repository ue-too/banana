import { describe, expect, it } from 'bun:test';

import { PlatformBufferStore } from '@/resources/platform-buffer-store';
import { SourceSinkTicker } from '@/resources/source-sink-ticker';
import { SINK_RATE, SOURCE_RATE } from '@/resources/types';
import type { PlatformHandle } from '@/resources/types';

const p: PlatformHandle = { kind: 'island', stationId: 1, platformId: 0 };

describe('SourceSinkTicker', () => {
    it('is a no-op when there are no roles set', () => {
        const store = new PlatformBufferStore();
        const ticker = new SourceSinkTicker(store);
        ticker.update(1);
        expect(store.getEffectiveBuffer(p)).toEqual({});
    });

    it('generates SOURCE_RATE * dt units per second on source platforms', () => {
        const store = new PlatformBufferStore();
        store.setRole(p, 'goods', 'source');
        const ticker = new SourceSinkTicker(store);
        ticker.update(2);
        expect(store.getEffectiveBuffer(p)).toEqual({ goods: SOURCE_RATE * 2 });
    });

    it('drains SINK_RATE * dt per second and clamps at zero', () => {
        const store = new PlatformBufferStore();
        store.setRole(p, 'goods', 'sink');
        store.add(p, 'goods', 3);
        const ticker = new SourceSinkTicker(store);
        ticker.update(5); // would try to remove 5 but only 3 available
        expect(store.getEffectiveBuffer(p)).toEqual({});
    });

    it('handles source and sink on the same platform for different resource types', () => {
        const store = new PlatformBufferStore();
        store.setRole(p, 'passenger', 'source');
        store.setRole(p, 'goods', 'sink');
        store.add(p, 'goods', 10);
        const ticker = new SourceSinkTicker(store);
        ticker.update(1);
        expect(store.getEffectiveBuffer(p)).toEqual({
            passenger: SOURCE_RATE,
            goods: 10 - SINK_RATE,
        });
    });

    it('update(NaN) is a no-op', () => {
        const store = new PlatformBufferStore();
        store.setRole(p, 'goods', 'source');
        const ticker = new SourceSinkTicker(store);
        ticker.update(Number.NaN);
        expect(store.getEffectiveBuffer(p)).toEqual({});
    });
});
