import type { Canvas, ObservableBoardCamera } from '@ue-too/board';
import { describe, expect, it } from 'bun:test';

import { BogieEditorEngine } from '../src/train-editor/bogie-editor-engine';

function makeEngine(): BogieEditorEngine {
    // exportCarDefinition / addBogie do not touch camera or canvas, so empty
    // stubs are sufficient for these tests.
    const camera = {} as ObservableBoardCamera;
    const canvas = {} as Canvas;
    return new BogieEditorEngine(camera, canvas);
}

describe('BogieEditorEngine.exportCarDefinition', () => {
    it('returns the supplied width', () => {
        const engine = makeEngine();
        engine.addBogie({ x: 0, y: 0 });
        engine.addBogie({ x: 10, y: 0 });

        const def = engine.exportCarDefinition(2.5, 2.5, 3.0);

        expect(def).not.toBeNull();
        expect(def!.width).toBe(3.0);
    });

    it('defaults width to 2.5 when omitted', () => {
        const engine = makeEngine();
        engine.addBogie({ x: 0, y: 0 });
        engine.addBogie({ x: 10, y: 0 });

        const def = engine.exportCarDefinition();

        expect(def).not.toBeNull();
        expect(def!.width).toBe(2.5);
    });

    it('preserves bogieOffsets, edgeToBogie, and bogieToEdge alongside width', () => {
        const engine = makeEngine();
        engine.addBogie({ x: 0, y: 0 });
        engine.addBogie({ x: 10, y: 0 });

        const def = engine.exportCarDefinition(1.5, 2.0, 2.8);

        expect(def).not.toBeNull();
        expect(def!.bogieOffsets).toEqual([10]);
        expect(def!.edgeToBogie).toBe(1.5);
        expect(def!.bogieToEdge).toBe(2.0);
        expect(def!.width).toBe(2.8);
    });

    it('returns null when fewer than two bogies are present', () => {
        const engine = makeEngine();
        engine.addBogie({ x: 0, y: 0 });

        expect(engine.exportCarDefinition(2.5, 2.5, 3.0)).toBeNull();
    });
});
