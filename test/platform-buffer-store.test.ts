import { describe, expect, it } from 'bun:test';

import { PlatformBufferStore } from '@/resources/platform-buffer-store';
import type { PlatformHandle } from '@/resources/types';

const pA: PlatformHandle = { kind: 'island', stationId: 1, platformId: 0 };
const pB: PlatformHandle = { kind: 'island', stationId: 1, platformId: 1 };
const pC: PlatformHandle = {
    kind: 'trackAligned',
    stationId: 2,
    platformId: 9,
};

describe('PlatformBufferStore', () => {
    it('returns an empty buffer for an untouched platform', () => {
        const store = new PlatformBufferStore();
        expect(store.getEffectiveBuffer(pA)).toEqual({});
    });

    it('adds and removes, returning actual amounts moved', () => {
        const store = new PlatformBufferStore();
        expect(store.add(pA, 'iron-ore', 12)).toBe(12);
        expect(store.getEffectiveBuffer(pA)).toEqual({ 'iron-ore': 12 });
        expect(store.remove(pA, 'iron-ore', 5)).toBe(5);
        expect(store.getEffectiveBuffer(pA)).toEqual({ 'iron-ore': 7 });
    });

    it('remove clamps at zero', () => {
        const store = new PlatformBufferStore();
        store.add(pA, 'goods', 3);
        expect(store.remove(pA, 'goods', 10)).toBe(3);
        expect(store.getEffectiveBuffer(pA)).toEqual({});
    });

    it('private-mode platforms have independent buffers', () => {
        const store = new PlatformBufferStore();
        store.add(pA, 'goods', 5);
        store.add(pB, 'goods', 7);
        expect(store.getEffectiveBuffer(pA)).toEqual({ goods: 5 });
        expect(store.getEffectiveBuffer(pB)).toEqual({ goods: 7 });
    });

    it('shared-mode platforms in the same station share one buffer', () => {
        const store = new PlatformBufferStore();
        store.setBufferMode(pA, 'sharedWithStation');
        store.setBufferMode(pB, 'sharedWithStation');
        store.add(pA, 'goods', 4);
        store.add(pB, 'goods', 6);
        expect(store.getEffectiveBuffer(pA)).toEqual({ goods: 10 });
        expect(store.getEffectiveBuffer(pB)).toEqual({ goods: 10 });
    });

    it('shared-mode is scoped to station id', () => {
        const store = new PlatformBufferStore();
        store.setBufferMode(pA, 'sharedWithStation'); // station 1
        store.setBufferMode(pC, 'sharedWithStation'); // station 2
        store.add(pA, 'goods', 4);
        store.add(pC, 'goods', 6);
        expect(store.getEffectiveBuffer(pA)).toEqual({ goods: 4 });
        expect(store.getEffectiveBuffer(pC)).toEqual({ goods: 6 });
    });

    it('toggling a platform to shared mode does not drag its private buffer across', () => {
        const store = new PlatformBufferStore();
        store.add(pA, 'goods', 5); // private
        store.setBufferMode(pA, 'sharedWithStation');
        // Now reads route to the (empty) station-shared buffer.
        expect(store.getEffectiveBuffer(pA)).toEqual({});
        // Switch back; the original private contents are preserved.
        store.setBufferMode(pA, 'private');
        expect(store.getEffectiveBuffer(pA)).toEqual({ goods: 5 });
    });

    it('roles: default is neither; setRole and getRole round-trip; neither deletes', () => {
        const store = new PlatformBufferStore();
        expect(store.getRole(pA, 'goods')).toBe('neither');
        store.setRole(pA, 'goods', 'source');
        expect(store.getRole(pA, 'goods')).toBe('source');
        store.setRole(pA, 'goods', 'neither');
        expect(store.getRole(pA, 'goods')).toBe('neither');
        // After setting to neither, the key should not survive in the config.
        expect(store.getConfig(pA).roles).toEqual({});
    });

    it('getAllConfiguredPlatforms lists every platform touched', () => {
        const store = new PlatformBufferStore();
        store.add(pA, 'goods', 1);
        store.setBufferMode(pB, 'sharedWithStation');
        store.setRole(pC, 'iron-ore', 'sink');
        const keys = store
            .getAllConfiguredPlatforms()
            .map(h => h.platformId)
            .sort();
        expect(keys).toEqual([0, 1, 9]);
    });

    it('serialize/hydrate round-trips configs, private buffers, and shared buffers', () => {
        const store = new PlatformBufferStore();
        store.setBufferMode(pA, 'sharedWithStation');
        store.setRole(pB, 'goods', 'source');
        store.add(pB, 'goods', 3);
        store.add(pA, 'iron-ore', 8); // lands in station 1's shared buffer
        const snap = store.serialize();

        const restored = new PlatformBufferStore();
        restored.hydrate(snap);
        expect(restored.getConfig(pA).bufferMode).toBe('sharedWithStation');
        expect(restored.getRole(pB, 'goods')).toBe('source');
        expect(restored.getEffectiveBuffer(pB)).toEqual({ goods: 3 });
        expect(restored.getEffectiveBuffer(pA)).toEqual({ 'iron-ore': 8 });
    });

    it('add() rejects NaN and returns 0 without mutating state', () => {
        const store = new PlatformBufferStore();
        expect(store.add(pA, 'goods', Number.NaN)).toBe(0);
        expect(store.getEffectiveBuffer(pA)).toEqual({});
    });

    it('remove() rejects NaN and returns 0', () => {
        const store = new PlatformBufferStore();
        store.add(pA, 'goods', 5);
        expect(store.remove(pA, 'goods', Number.NaN)).toBe(0);
        expect(store.getEffectiveBuffer(pA)).toEqual({ goods: 5 });
    });

    it('getEffectiveBuffer does not pollute internal state on read', () => {
        const store = new PlatformBufferStore();
        store.getEffectiveBuffer(pA); // pure read
        // Nothing was configured, nothing was added — serialize should be empty.
        const snap = store.serialize();
        expect(snap.configs).toEqual([]);
        expect(snap.privateBuffers).toEqual([]);
        expect(snap.sharedBuffers).toEqual([]);
        expect(store.getAllConfiguredPlatforms()).toEqual([]);
    });

    it('getEffectiveBuffer returns a frozen snapshot', () => {
        const store = new PlatformBufferStore();
        store.add(pA, 'goods', 5);
        const buf = store.getEffectiveBuffer(pA) as any;
        expect(Object.isFrozen(buf)).toBe(true);
        // Mutation attempts on the snapshot must not affect store state.
        try {
            buf['goods'] = 999;
        } catch {
            /* strict mode throws, non-strict silently ignores */
        }
        expect(store.getEffectiveBuffer(pA)).toEqual({ goods: 5 });
    });

    it('destroyPlatform purges config, private buffer, and known-handle for the key', () => {
        const store = new PlatformBufferStore();
        store.setBufferMode(pA, 'private');
        store.setRole(pA, 'goods', 'source');
        store.add(pA, 'goods', 10);
        store.destroyPlatform(pA);

        // No spurious entries after destruction.
        expect(store.serialize().configs).toEqual([]);
        expect(store.serialize().privateBuffers).toEqual([]);
        expect(store.getAllConfiguredPlatforms()).toEqual([]);
        // Role query for a destroyed platform returns the default.
        expect(store.getRole(pA, 'goods')).toBe('neither');
    });

    it('destroyPlatform does NOT purge the station-shared buffer', () => {
        const store = new PlatformBufferStore();
        store.setBufferMode(pA, 'sharedWithStation');
        store.setBufferMode(pB, 'sharedWithStation'); // same station
        store.add(pA, 'goods', 5);
        store.destroyPlatform(pA);
        // pB (still alive, same station) should still see the shared pool.
        expect(store.getEffectiveBuffer(pB)).toEqual({ goods: 5 });
    });
});
