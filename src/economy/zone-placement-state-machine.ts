import {
    BaseContext,
    EventReactions,
    NO_OP,
    TemplateState,
    TemplateStateMachine,
} from '@ue-too/being';
import type { Point } from '@ue-too/math';

import type { ZoneType } from './types';

export const ZONE_PLACEMENT_STATES = [
    'IDLE',
    'DRAWING_BOUNDARY',
    'CONFIRMING_TYPE',
] as const;

export type ZonePlacementStates = (typeof ZONE_PLACEMENT_STATES)[number];

export type ZonePlacementEvents = {
    startZonePlacement: {};
    leftPointerDown: { x: number; y: number };
    pointerMove: { x: number; y: number };
    escapeKey: {};
    confirmType: { zoneType: ZoneType };
    endZonePlacement: {};
};

export interface ZonePlacementContext extends BaseContext {
    addBoundaryPoint: (position: Point) => void;
    updatePreview: (position: Point) => void;
    closeBoundary: () => void;
    confirmZone: (type: ZoneType) => void;
    cancelPlacement: () => void;
    clearPreview: () => void;
    convert2WorldPosition: (position: Point) => Point;
}

class IdleState extends TemplateState<
    ZonePlacementEvents,
    ZonePlacementContext,
    ZonePlacementStates
> {
    protected _eventReactions: EventReactions<
        ZonePlacementEvents,
        ZonePlacementContext,
        ZonePlacementStates
    > = {
        startZonePlacement: {
            action: NO_OP,
            defaultTargetState: 'DRAWING_BOUNDARY',
        },
    };
}

class DrawingBoundaryState extends TemplateState<
    ZonePlacementEvents,
    ZonePlacementContext,
    ZonePlacementStates
> {
    protected _eventReactions: EventReactions<
        ZonePlacementEvents,
        ZonePlacementContext,
        ZonePlacementStates
    > = {
        leftPointerDown: {
            action: (context, event) => {
                const worldPos = context.convert2WorldPosition({
                    x: event.x,
                    y: event.y,
                });
                context.addBoundaryPoint(worldPos);
            },
        },
        pointerMove: {
            action: (context, event) => {
                const worldPos = context.convert2WorldPosition({
                    x: event.x,
                    y: event.y,
                });
                context.updatePreview(worldPos);
            },
        },
        escapeKey: {
            action: context => {
                context.closeBoundary();
            },
            defaultTargetState: 'CONFIRMING_TYPE',
        },
        endZonePlacement: {
            action: context => {
                context.cancelPlacement();
            },
            defaultTargetState: 'IDLE',
        },
    };
}

class ConfirmingTypeState extends TemplateState<
    ZonePlacementEvents,
    ZonePlacementContext,
    ZonePlacementStates
> {
    protected _eventReactions: EventReactions<
        ZonePlacementEvents,
        ZonePlacementContext,
        ZonePlacementStates
    > = {
        confirmType: {
            action: (context, event) => {
                context.confirmZone(event.zoneType);
                context.clearPreview();
            },
            defaultTargetState: 'IDLE',
        },
        escapeKey: {
            action: context => {
                context.cancelPlacement();
            },
            defaultTargetState: 'IDLE',
        },
        endZonePlacement: {
            action: context => {
                context.cancelPlacement();
            },
            defaultTargetState: 'IDLE',
        },
    };
}

export class ZonePlacementStateMachine extends TemplateStateMachine<
    ZonePlacementEvents,
    ZonePlacementContext,
    ZonePlacementStates
> {
    constructor(context: ZonePlacementContext) {
        super(
            {
                IDLE: new IdleState(),
                DRAWING_BOUNDARY: new DrawingBoundaryState(),
                CONFIRMING_TYPE: new ConfirmingTypeState(),
            },
            'IDLE',
            context
        );
    }
}
