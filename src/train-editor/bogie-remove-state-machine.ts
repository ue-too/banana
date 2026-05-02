import {
    BaseContext,
    EventReactions,
    NO_OP,
    StateMachine,
    TemplateState,
    TemplateStateMachine,
} from '@ue-too/being';
import { Point } from '@ue-too/math';

export type BogieRemoveStates = 'INACTIVE' | 'READY';

export type BogieRemoveEvents = {
    startRemoving: {};
    endRemoving: {};
    leftPointerDown: Point;
    leftPointerUp: Point;
    pointerMove: Point;
};

export type BogieRemoveContext = BaseContext & {
    removeBogieAt: (position: Point) => boolean;
    convert2WorldPosition: (pointInWindow: Point) => Point;
};

export type BogieRemoveStateMachine = StateMachine<
    BogieRemoveEvents,
    BogieRemoveContext,
    BogieRemoveStates
>;

class BogieRemoveInactiveState extends TemplateState<
    BogieRemoveEvents,
    BogieRemoveContext,
    BogieRemoveStates
> {
    protected _eventReactions = {
        startRemoving: {
            action: NO_OP,
            defaultTargetState: 'READY' as const,
        },
    } as EventReactions<
        BogieRemoveEvents,
        BogieRemoveContext,
        BogieRemoveStates
    >;
}

class BogieRemoveReadyState extends TemplateState<
    BogieRemoveEvents,
    BogieRemoveContext,
    BogieRemoveStates
> {
    protected _eventReactions = {
        leftPointerDown: {
            action: this.leftPointerDown.bind(this),
        },
        endRemoving: {
            action: NO_OP,
            defaultTargetState: 'INACTIVE' as const,
        },
    } as EventReactions<
        BogieRemoveEvents,
        BogieRemoveContext,
        BogieRemoveStates
    >;

    leftPointerDown(context: BogieRemoveContext, payload: Point): void {
        const worldPos = context.convert2WorldPosition(payload);
        context.removeBogieAt(worldPos);
    }
}

export const createBogieRemoveStateMachine = (
    context: BogieRemoveContext
): BogieRemoveStateMachine => {
    return new TemplateStateMachine<
        BogieRemoveEvents,
        BogieRemoveContext,
        BogieRemoveStates
    >(
        {
            INACTIVE: new BogieRemoveInactiveState(),
            READY: new BogieRemoveReadyState(),
        },
        'INACTIVE',
        context
    );
};
