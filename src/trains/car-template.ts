import type { Point } from '@ue-too/math';

import type { CarType } from './cars';

export type CarTemplate = {
    id: string;
    bogieOffsets: number[];
    edgeToBogie: number;
    bogieToEdge: number;
    /** Car category — determines default gangway flags when a Car is created from this template. */
    type?: CarType;
    /** Body width in meters. */
    width: number;
    image?: {
        src: string;
        position: Point;
        width: number;
        height: number;
    };
};

let _templateIdCounter = 0;

export function generateTemplateId(): string {
    return `tpl-${_templateIdCounter++}`;
}

/**
 * Validates that a parsed JSON object is a valid car definition
 * (exported from the train editor).
 */
export function validateCarDefinition(
    data: unknown
): { valid: true } | { valid: false; error: string } {
    if (typeof data !== 'object' || data === null) {
        return { valid: false, error: 'Not an object' };
    }
    const obj = data as Record<string, unknown>;
    if (!Array.isArray(obj.bogieOffsets) || obj.bogieOffsets.length === 0) {
        return { valid: false, error: 'Missing or empty bogieOffsets array' };
    }
    if (
        !obj.bogieOffsets.every((v: unknown) => typeof v === 'number' && v > 0)
    ) {
        return { valid: false, error: 'bogieOffsets must be positive numbers' };
    }
    if (obj.width !== undefined) {
        if (typeof obj.width !== 'number') {
            return {
                valid: false,
                error: 'width must be a number when provided',
            };
        }
        if (obj.width <= 0) {
            return { valid: false, error: 'width must be positive' };
        }
    }
    return { valid: true };
}
