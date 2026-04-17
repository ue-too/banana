import { describe, expect, it } from 'bun:test';

import { CarCargoStore } from '@/resources/car-cargo-store';
import { PlatformBufferStore } from '@/resources/platform-buffer-store';
import { SourceSinkTicker } from '@/resources/source-sink-ticker';
import { TransferManager } from '@/resources/transfer-manager';
import type { PlatformHandle } from '@/resources/types';

/**
 * Scenario: two platforms. One marked 'source' for goods, one marked 'sink' for
 * goods. A two-car train oscillates between them. After N seconds, assert units
 * have flowed from source buffer → train cars → sink buffer.
 */
describe('resource transport loop (integration)', () => {
    it('moves units from a source to a sink over simulated time', () => {
        const src: PlatformHandle = {
            kind: 'island',
            stationId: 1,
            platformId: 0,
        };
        const dst: PlatformHandle = {
            kind: 'island',
            stationId: 2,
            platformId: 0,
        };

        const cargo = new CarCargoStore();
        const buffer = new PlatformBufferStore();

        buffer.setRole(src, 'goods', 'source');
        buffer.setRole(dst, 'goods', 'sink');

        // Prime the source so the train has something to pick up on the first visit.
        buffer.add(src, 'goods', 100);

        const train = { cars: [{ id: 'car-0' }, { id: 'car-1' }] };
        const manager = new TransferManager({
            carCargoStore: cargo,
            platformBufferStore: buffer,
            getTrainById: id => (id === 1 ? (train as any) : null),
            getSimTime: () => 0,
        });
        const ticker = new SourceSinkTicker(buffer);

        const arrive = (p: PlatformHandle) => {
            manager.begin(1, p);
        };
        const depart = () => {
            manager.end(1);
        };

        // Visit source: dwell 20 simulated seconds (plenty for both cars to fill).
        arrive(src);
        for (let i = 0; i < 20; i++) {
            manager.update(1);
            ticker.update(1);
        }
        depart();
        const loadAtSource =
            cargo.getTotalLoad('car-0') + cargo.getTotalLoad('car-1');
        expect(loadAtSource).toBeGreaterThan(0);

        // Travel (no platform, only the ticker keeps generating).
        for (let i = 0; i < 10; i++) ticker.update(1);

        // Visit sink: dwell long enough for both cars to fully empty.
        // Each car can only unload once every ~6 ticks because the sink-rate ticker
        // (1 unit/sec) must drain the 5-unit drop before the next unload can begin.
        arrive(dst);
        for (let i = 0; i < 200; i++) {
            manager.update(1);
            ticker.update(1);
        }
        depart();

        const loadAfterSink =
            cargo.getTotalLoad('car-0') + cargo.getTotalLoad('car-1');
        expect(loadAfterSink).toBe(0);
    });
});
