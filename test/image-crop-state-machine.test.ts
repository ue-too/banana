import { describe, expect, it, mock } from 'bun:test';

import {
    type ImageCropContext,
    createImageCropStateMachine,
} from '../src/train-editor/image-crop-state-machine';

function makeMockEngine() {
    return {
        beginCrop: mock(() => {}),
        projectOnHandle: mock((_p: any) => null as null | string),
        startResize: mock((_h: any) => {}),
        updateResize: mock((_p: any) => {}),
        endInteraction: mock(() => {}),
        commit: mock(async () => true),
        cancel: mock(() => {}),
        getRect: mock(() => null as any),
        // Identity conversion in tests — payloads are already "world".
        convert2WorldPosition: mock((p: any) => p),
    };
}

function makeContext(engine: ReturnType<typeof makeMockEngine>) {
    return {
        cropEngine: engine,
        setup: () => {},
        cleanup: () => {},
    } as unknown as ImageCropContext;
}

describe('ImageCropStateMachine', () => {
    it('starts in INACTIVE and moves to IDLE on startCrop', () => {
        const engine = makeMockEngine();
        const sm = createImageCropStateMachine(makeContext(engine));
        expect(sm.currentState).toBe('INACTIVE');
        sm.happens('startCrop', {});
        expect(sm.currentState).toBe('IDLE');
        expect(engine.beginCrop).toHaveBeenCalledTimes(1);
    });

    it('transitions IDLE → RESIZING when pointer hits a handle', () => {
        const engine = makeMockEngine();
        engine.projectOnHandle = mock(() => 'bottom-right' as any);
        const sm = createImageCropStateMachine(makeContext(engine));
        sm.happens('startCrop', {});
        sm.happens('leftPointerDown', { x: 1, y: 1 });
        expect(sm.currentState).toBe('RESIZING');
        expect(engine.startResize).toHaveBeenCalledWith('bottom-right');
    });

    it('stays in IDLE when pointer misses a handle', () => {
        const engine = makeMockEngine();
        engine.projectOnHandle = mock(() => null);
        const sm = createImageCropStateMachine(makeContext(engine));
        sm.happens('startCrop', {});
        sm.happens('leftPointerDown', { x: 0, y: 0 });
        expect(sm.currentState).toBe('IDLE');
    });

    it('returns to IDLE on leftPointerUp from RESIZING', () => {
        const engine = makeMockEngine();
        engine.projectOnHandle = mock(() => 'top-left' as any);
        const sm = createImageCropStateMachine(makeContext(engine));
        sm.happens('startCrop', {});
        sm.happens('leftPointerDown', { x: -1, y: -1 });
        sm.happens('leftPointerMove', { x: 0, y: 0 });
        sm.happens('leftPointerUp', { x: 0, y: 0 });
        expect(sm.currentState).toBe('IDLE');
        expect(engine.updateResize).toHaveBeenCalled();
        expect(engine.endInteraction).toHaveBeenCalledTimes(1);
    });

    it('commitCrop transitions to INACTIVE without calling engine.commit', () => {
        // The toolbar owns commit so it can pass source pixel dims; the state
        // machine only tracks UI state.
        const engine = makeMockEngine();
        const sm = createImageCropStateMachine(makeContext(engine));
        sm.happens('startCrop', {});
        sm.happens('commitCrop', {});
        expect(engine.commit).toHaveBeenCalledTimes(0);
        expect(sm.currentState).toBe('INACTIVE');
    });

    it('cancelCrop calls engine.cancel and returns to INACTIVE', () => {
        const engine = makeMockEngine();
        const sm = createImageCropStateMachine(makeContext(engine));
        sm.happens('startCrop', {});
        sm.happens('cancelCrop', {});
        expect(engine.cancel).toHaveBeenCalledTimes(1);
        expect(sm.currentState).toBe('INACTIVE');
    });

    it('endCrop from IDLE auto-cancels and goes INACTIVE', () => {
        const engine = makeMockEngine();
        const sm = createImageCropStateMachine(makeContext(engine));
        sm.happens('startCrop', {});
        sm.happens('endCrop', {});
        expect(engine.cancel).toHaveBeenCalledTimes(1);
        expect(sm.currentState).toBe('INACTIVE');
    });
});
