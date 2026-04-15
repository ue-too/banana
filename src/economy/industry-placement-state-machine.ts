import {
    BaseContext,
    EventReactions,
    NO_OP,
    TemplateState,
    TemplateStateMachine,
} from '@ue-too/being';
import type { Point } from '@ue-too/math';

import type { IndustryType } from './types';

export const INDUSTRY_PLACEMENT_STATES = [
    'IDLE',
    'SELECTING_TYPE',
    'POSITIONING',
] as const;

export type IndustryPlacementStates =
    (typeof INDUSTRY_PLACEMENT_STATES)[number];

export type IndustryPlacementEvents = {
    startIndustryPlacement: {};
    selectType: { industryType: IndustryType };
    pointerMove: { x: number; y: number };
    pointerDown: { x: number; y: number };
    cancel: {};
    endIndustryPlacement: {};
};

export interface IndustryPlacementContext extends BaseContext {
    showTypeSelector: () => void;
    hideTypeSelector: () => void;
    setSelectedType: (type: IndustryType) => void;
    updateGhostPosition: (position: Point) => void;
    showServiceRadiusOverlay: (position: Point) => void;
    placeIndustry: (position: Point) => void;
    clearGhost: () => void;
    convert2WorldPosition: (position: Point) => Point;
}

class IdleState extends TemplateState<
    IndustryPlacementEvents,
    IndustryPlacementContext,
    IndustryPlacementStates
> {
    protected _eventReactions: EventReactions<
        IndustryPlacementEvents,
        IndustryPlacementContext,
        IndustryPlacementStates
    > = {
        startIndustryPlacement: {
            action: context => {
                context.showTypeSelector();
            },
            defaultTargetState: 'SELECTING_TYPE',
        },
    };
}

class SelectingTypeState extends TemplateState<
    IndustryPlacementEvents,
    IndustryPlacementContext,
    IndustryPlacementStates
> {
    protected _eventReactions: EventReactions<
        IndustryPlacementEvents,
        IndustryPlacementContext,
        IndustryPlacementStates
    > = {
        selectType: {
            action: (context, event) => {
                context.setSelectedType(event.industryType);
                context.hideTypeSelector();
            },
            defaultTargetState: 'POSITIONING',
        },
        cancel: {
            action: context => {
                context.hideTypeSelector();
            },
            defaultTargetState: 'IDLE',
        },
        endIndustryPlacement: {
            action: context => {
                context.hideTypeSelector();
            },
            defaultTargetState: 'IDLE',
        },
    };
}

class PositioningState extends TemplateState<
    IndustryPlacementEvents,
    IndustryPlacementContext,
    IndustryPlacementStates
> {
    protected _eventReactions: EventReactions<
        IndustryPlacementEvents,
        IndustryPlacementContext,
        IndustryPlacementStates
    > = {
        pointerMove: {
            action: (context, event) => {
                const worldPos = context.convert2WorldPosition({
                    x: event.x,
                    y: event.y,
                });
                context.updateGhostPosition(worldPos);
                context.showServiceRadiusOverlay(worldPos);
            },
        },
        pointerDown: {
            action: (context, event) => {
                const worldPos = context.convert2WorldPosition({
                    x: event.x,
                    y: event.y,
                });
                context.placeIndustry(worldPos);
                context.clearGhost();
            },
            defaultTargetState: 'IDLE',
        },
        cancel: {
            action: context => {
                context.clearGhost();
            },
            defaultTargetState: 'IDLE',
        },
        endIndustryPlacement: {
            action: context => {
                context.clearGhost();
            },
            defaultTargetState: 'IDLE',
        },
    };
}

export class IndustryPlacementStateMachine extends TemplateStateMachine<
    IndustryPlacementEvents,
    IndustryPlacementContext,
    IndustryPlacementStates
> {
    constructor(context: IndustryPlacementContext) {
        super(
            {
                IDLE: new IdleState(),
                SELECTING_TYPE: new SelectingTypeState(),
                POSITIONING: new PositioningState(),
            },
            'IDLE',
            context
        );
    }
}
