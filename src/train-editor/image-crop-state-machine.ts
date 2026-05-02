import {
    BaseContext,
    EventGuards,
    EventReactions,
    Guard,
    NO_OP,
    StateMachine,
    TemplateState,
    TemplateStateMachine,
} from '@ue-too/being';
import { Point } from '@ue-too/math';

import type { ImageCropEngine } from './image-crop-engine';

export type ImageCropStates = 'INACTIVE' | 'IDLE' | 'RESIZING';

export type ImageCropEvents = {
    startCrop: {};
    endCrop: {};
    commitCrop: {};
    cancelCrop: {};
    leftPointerDown: Point;
    leftPointerUp: Point;
    leftPointerMove: Point;
    pointerMove: Point;
};

export type ImageCropContext = BaseContext & {
    cropEngine: ImageCropEngine;
};

export type ImageCropStateMachine = StateMachine<
    ImageCropEvents,
    ImageCropContext,
    ImageCropStates
>;

class CropInactiveState extends TemplateState<
    ImageCropEvents,
    ImageCropContext,
    ImageCropStates
> {
    protected _eventReactions = {
        startCrop: {
            action: (context: ImageCropContext) => {
                context.cropEngine.beginCrop();
            },
            defaultTargetState: 'IDLE' as const,
        },
    } as EventReactions<ImageCropEvents, ImageCropContext, ImageCropStates>;
}

class CropIdleState extends TemplateState<
    ImageCropEvents,
    ImageCropContext,
    ImageCropStates
> {
    private _lastPointerPos: Point = { x: 0, y: 0 };

    protected _eventReactions = {
        leftPointerDown: {
            action: this.leftPointerDown.bind(this),
        },
        commitCrop: {
            // Pure state transition; the toolbar awaits engine.commit before
            // firing this event so it can supply source pixel dims.
            action: NO_OP,
            defaultTargetState: 'INACTIVE' as const,
        },
        cancelCrop: {
            action: (context: ImageCropContext) => {
                context.cropEngine.cancel();
            },
            defaultTargetState: 'INACTIVE' as const,
        },
        endCrop: {
            action: (context: ImageCropContext) => {
                context.cropEngine.cancel();
            },
            defaultTargetState: 'INACTIVE' as const,
        },
    } as EventReactions<ImageCropEvents, ImageCropContext, ImageCropStates>;

    protected _guards: Guard<ImageCropContext, 'hitHandle'> = {
        hitHandle: ((context: ImageCropContext) => {
            const worldPos = context.cropEngine.convert2WorldPosition(
                this._lastPointerPos
            );
            return context.cropEngine.projectOnHandle(worldPos) !== null;
        }).bind(this),
    };

    protected _eventGuards: Partial<
        EventGuards<
            ImageCropEvents,
            ImageCropStates,
            ImageCropContext,
            typeof this._guards
        >
    > = {
        leftPointerDown: [
            {
                guard: 'hitHandle',
                target: 'RESIZING',
            },
        ],
    };

    leftPointerDown(context: ImageCropContext, payload: Point): void {
        this._lastPointerPos = payload;
        const worldPos = context.cropEngine.convert2WorldPosition(payload);
        const handle = context.cropEngine.projectOnHandle(worldPos);
        if (handle) {
            context.cropEngine.startResize(handle);
        }
    }
}

class CropResizingState extends TemplateState<
    ImageCropEvents,
    ImageCropContext,
    ImageCropStates
> {
    protected _eventReactions = {
        leftPointerMove: {
            action: this.onPointerMove.bind(this),
        },
        pointerMove: {
            action: this.onPointerMove.bind(this),
        },
        leftPointerUp: {
            action: this.leftPointerUp.bind(this),
            defaultTargetState: 'IDLE' as const,
        },
    } as EventReactions<ImageCropEvents, ImageCropContext, ImageCropStates>;

    onPointerMove(context: ImageCropContext, payload: Point): void {
        const worldPos = context.cropEngine.convert2WorldPosition(payload);
        context.cropEngine.updateResize(worldPos);
    }

    leftPointerUp(context: ImageCropContext): void {
        context.cropEngine.endInteraction();
    }
}

export const createImageCropStateMachine = (
    context: ImageCropContext
): ImageCropStateMachine => {
    return new TemplateStateMachine<
        ImageCropEvents,
        ImageCropContext,
        ImageCropStates
    >(
        {
            INACTIVE: new CropInactiveState(),
            IDLE: new CropIdleState(),
            RESIZING: new CropResizingState(),
        },
        'INACTIVE',
        context
    );
};
