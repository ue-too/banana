import { describe, expect, it } from 'bun:test';

import {
    RESOURCE_TYPES,
    getResourceType,
    isKnownResourceType,
} from '@/resources/resource-registry';
import { decodePlatformKey, encodePlatformKey } from '@/resources/types';

describe('resource registry', () => {
    it('contains the three built-in types', () => {
        const ids = RESOURCE_TYPES.map(t => t.id).sort();
        expect(ids).toEqual(['goods', 'iron-ore', 'passenger']);
    });

    it('looks up types by id', () => {
        expect(getResourceType('passenger')?.category).toBe('passenger');
        expect(getResourceType('iron-ore')?.category).toBe('freight');
        expect(getResourceType('does-not-exist')).toBeNull();
    });

    it('knows what is known', () => {
        expect(isKnownResourceType('goods')).toBe(true);
        expect(isKnownResourceType('unknown')).toBe(false);
    });
});

describe('platform key codec', () => {
    it('round-trips', () => {
        const handle = { kind: 'island' as const, stationId: 7, platformId: 2 };
        expect(decodePlatformKey(encodePlatformKey(handle))).toEqual(handle);
    });

    it('round-trips the track-aligned kind', () => {
        const handle = {
            kind: 'trackAligned' as const,
            stationId: 3,
            platformId: 11,
        };
        expect(decodePlatformKey(encodePlatformKey(handle))).toEqual(handle);
    });

    it('throws on bad kind', () => {
        expect(() => decodePlatformKey('weird:1:2')).toThrow(
            'bad platform kind'
        );
    });
});
