import {
    BaseContext,
    EventReactions,
    TemplateState,
    TemplateStateMachine,
} from '@ue-too/being';
import type { Point } from '@ue-too/math';

import type { ZoneType } from './types';

export const ZONE_PLACEMENT_STATES = [
    'IDLE',
    'SELECTING_TYPE',
    'DRAWING_BOUNDARY',
] as const;

export type ZonePlacementStates = (typeof ZONE_PLACEMENT_STATES)[number];

export type ZonePlacementEvents = {
    startZonePlacement: {};
    confirmType: { zoneType: ZoneType };
    leftPointerDown: { x: number; y: number };
    pointerMove: { x: number; y: number };
    escapeKey: {};
    endZonePlacement: {};
};

export interface ZonePlacementContext extends BaseContext {
    showTypeSelector: () => void;
    hideTypeSelector: () => void;
    setSelectedType: (type: ZoneType) => void;
    addBoundaryPoint: (position: Point) => void;
    updatePreview: (position: Point) => void;
    finishZone: () => void;
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
            action: context => {
                context.showTypeSelector();
            },
            defaultTargetState: 'SELECTING_TYPE',
        },
    };
}

class SelectingTypeState extends TemplateState<
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
                context.setSelectedType(event.zoneType);
                context.hideTypeSelector();
            },
            defaultTargetState: 'DRAWING_BOUNDARY',
        },
        escapeKey: {
            action: context => {
                context.hideTypeSelector();
                context.cancelPlacement();
            },
            defaultTargetState: 'IDLE',
        },
        endZonePlacement: {
            action: context => {
                context.hideTypeSelector();
                context.cancelPlacement();
            },
            defaultTargetState: 'IDLE',
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
                context.finishZone();
                context.clearPreview();
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
                SELECTING_TYPE: new SelectingTypeState(),
                DRAWING_BOUNDARY: new DrawingBoundaryState(),
            },
            'IDLE',
            context
        );
    }
}
