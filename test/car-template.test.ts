import { describe, expect, it } from 'bun:test';

import { validateCarDefinition } from '../src/trains/car-template';

describe('validateCarDefinition', () => {
    it('accepts a definition with width', () => {
        const result = validateCarDefinition({
            bogieOffsets: [10, 10],
            edgeToBogie: 2.5,
            bogieToEdge: 2.5,
            width: 3.0,
        });
        expect(result.valid).toBe(true);
    });

    it('accepts a definition without width (legacy)', () => {
        const result = validateCarDefinition({
            bogieOffsets: [10],
            edgeToBogie: 2.5,
            bogieToEdge: 2.5,
        });
        expect(result.valid).toBe(true);
    });

    it('rejects a non-numeric width', () => {
        const result = validateCarDefinition({
            bogieOffsets: [10],
            edgeToBogie: 2.5,
            bogieToEdge: 2.5,
            width: 'wide',
        });
        expect(result.valid).toBe(false);
    });

    it('rejects a non-positive width', () => {
        const result = validateCarDefinition({
            bogieOffsets: [10],
            edgeToBogie: 2.5,
            bogieToEdge: 2.5,
            width: 0,
        });
        expect(result.valid).toBe(false);
    });

    it('rejects NaN width', () => {
        const result = validateCarDefinition({
            bogieOffsets: [10],
            edgeToBogie: 2.5,
            bogieToEdge: 2.5,
            width: Number.NaN,
        });
        expect(result.valid).toBe(false);
    });

    it('rejects Infinity width', () => {
        const result = validateCarDefinition({
            bogieOffsets: [10],
            edgeToBogie: 2.5,
            bogieToEdge: 2.5,
            width: Number.POSITIVE_INFINITY,
        });
        expect(result.valid).toBe(false);
    });
});
