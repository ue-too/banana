import {
    BaseContext,
    Defer,
    EventReactions,
    NO_OP,
    StateMachine,
    TemplateState,
    TemplateStateMachine,
} from '@ue-too/being';

import type { BogieAddStateMachine } from './bogie-add-state-machine';
import type { BogieEditStateMachine } from './bogie-kmt-state-machine';
import type { BogieRemoveStateMachine } from './bogie-remove-state-machine';
import type { ImageCropStateMachine } from './image-crop-state-machine';
import type { ImageEditStateMachine } from './image-edit-state-machine';

export const TRAIN_EDITOR_TOOL_STATES = [
    'IDLE',
    'EDIT_BOGIE',
    'ADD_BOGIE',
    'REMOVE_BOGIE',
    'EDIT_IMAGE',
    'EDIT_IMAGE_CROP',
] as const;

export type TrainEditorToolStates = (typeof TRAIN_EDITOR_TOOL_STATES)[number];

export type TrainEditorToolEvents = {
    switchToEditBogie: {};
    switchToAddBogie: {};
    switchToRemoveBogie: {};
    switchToEditImage: {};
    switchToCropImage: {};
    switchToIdle: {};
};

export type TrainEditorToolContext = BaseContext;

export type TrainEditorToolStateMachine = StateMachine<
    TrainEditorToolEvents,
    TrainEditorToolContext,
    TrainEditorToolStates
>;

class ToolIdleState extends TemplateState<
    TrainEditorToolEvents,
    TrainEditorToolContext,
    TrainEditorToolStates
> {
    protected _eventReactions: EventReactions<
        TrainEditorToolEvents,
        TrainEditorToolContext,
        TrainEditorToolStates
    > = {
        switchToEditBogie: {
            action: NO_OP,
            defaultTargetState: 'EDIT_BOGIE',
        },
        switchToAddBogie: {
            action: NO_OP,
            defaultTargetState: 'ADD_BOGIE',
        },
        switchToRemoveBogie: {
            action: NO_OP,
            defaultTargetState: 'REMOVE_BOGIE',
        },
        switchToEditImage: {
            action: NO_OP,
            defaultTargetState: 'EDIT_IMAGE',
        },
        switchToCropImage: {
            action: NO_OP,
            defaultTargetState: 'EDIT_IMAGE_CROP',
        },
        switchToIdle: {
            action: NO_OP,
        },
    };
}

class ToolEditBogieState extends TemplateState<
    TrainEditorToolEvents,
    TrainEditorToolContext,
    TrainEditorToolStates
> {
    private _bogieEditStateMachine: BogieEditStateMachine;

    constructor(bogieEditStateMachine: BogieEditStateMachine) {
        super();
        this._bogieEditStateMachine = bogieEditStateMachine;
    }

    uponEnter(): void {
        this._bogieEditStateMachine.happens('startEditing');
    }

    beforeExit(): void {
        this._bogieEditStateMachine.happens('endEditing');
    }

    protected _defer: Defer<
        TrainEditorToolContext,
        TrainEditorToolEvents,
        TrainEditorToolStates
    > = {
        action: (_context, event, eventKey) => {
            const result = this._bogieEditStateMachine.happens(
                eventKey as string,
                event
            );
            if (result.handled) {
                return { handled: true, output: result.output };
            }
            return { handled: false };
        },
    };

    protected _eventReactions: EventReactions<
        TrainEditorToolEvents,
        TrainEditorToolContext,
        TrainEditorToolStates
    > = {
        switchToEditBogie: {
            action: NO_OP,
        },
        switchToAddBogie: {
            action: NO_OP,
            defaultTargetState: 'ADD_BOGIE',
        },
        switchToRemoveBogie: {
            action: NO_OP,
            defaultTargetState: 'REMOVE_BOGIE',
        },
        switchToEditImage: {
            action: NO_OP,
            defaultTargetState: 'EDIT_IMAGE',
        },
        switchToCropImage: {
            action: NO_OP,
            defaultTargetState: 'EDIT_IMAGE_CROP',
        },
        switchToIdle: {
            action: NO_OP,
            defaultTargetState: 'IDLE',
        },
    };
}

class ToolAddBogieState extends TemplateState<
    TrainEditorToolEvents,
    TrainEditorToolContext,
    TrainEditorToolStates
> {
    private _bogieAddStateMachine: BogieAddStateMachine;

    constructor(bogieAddStateMachine: BogieAddStateMachine) {
        super();
        this._bogieAddStateMachine = bogieAddStateMachine;
    }

    uponEnter(): void {
        this._bogieAddStateMachine.happens('startAdding');
    }

    beforeExit(): void {
        this._bogieAddStateMachine.happens('endAdding');
    }

    protected _defer: Defer<
        TrainEditorToolContext,
        TrainEditorToolEvents,
        TrainEditorToolStates
    > = {
        action: (_context, event, eventKey) => {
            const result = this._bogieAddStateMachine.happens(
                eventKey as string,
                event
            );
            if (result.handled) {
                return { handled: true, output: result.output };
            }
            return { handled: false };
        },
    };

    protected _eventReactions: EventReactions<
        TrainEditorToolEvents,
        TrainEditorToolContext,
        TrainEditorToolStates
    > = {
        switchToEditBogie: {
            action: NO_OP,
            defaultTargetState: 'EDIT_BOGIE',
        },
        switchToAddBogie: {
            action: NO_OP,
        },
        switchToRemoveBogie: {
            action: NO_OP,
            defaultTargetState: 'REMOVE_BOGIE',
        },
        switchToEditImage: {
            action: NO_OP,
            defaultTargetState: 'EDIT_IMAGE',
        },
        switchToCropImage: {
            action: NO_OP,
            defaultTargetState: 'EDIT_IMAGE_CROP',
        },
        switchToIdle: {
            action: NO_OP,
            defaultTargetState: 'IDLE',
        },
    };
}

class ToolRemoveBogieState extends TemplateState<
    TrainEditorToolEvents,
    TrainEditorToolContext,
    TrainEditorToolStates
> {
    private _bogieRemoveStateMachine: BogieRemoveStateMachine;

    constructor(bogieRemoveStateMachine: BogieRemoveStateMachine) {
        super();
        this._bogieRemoveStateMachine = bogieRemoveStateMachine;
    }

    uponEnter(): void {
        this._bogieRemoveStateMachine.happens('startRemoving');
    }

    beforeExit(): void {
        this._bogieRemoveStateMachine.happens('endRemoving');
    }

    protected _defer: Defer<
        TrainEditorToolContext,
        TrainEditorToolEvents,
        TrainEditorToolStates
    > = {
        action: (_context, event, eventKey) => {
            const result = this._bogieRemoveStateMachine.happens(
                eventKey as string,
                event
            );
            if (result.handled) {
                return { handled: true, output: result.output };
            }
            return { handled: false };
        },
    };

    protected _eventReactions: EventReactions<
        TrainEditorToolEvents,
        TrainEditorToolContext,
        TrainEditorToolStates
    > = {
        switchToEditBogie: {
            action: NO_OP,
            defaultTargetState: 'EDIT_BOGIE',
        },
        switchToAddBogie: {
            action: NO_OP,
            defaultTargetState: 'ADD_BOGIE',
        },
        switchToRemoveBogie: {
            action: NO_OP,
        },
        switchToEditImage: {
            action: NO_OP,
            defaultTargetState: 'EDIT_IMAGE',
        },
        switchToCropImage: {
            action: NO_OP,
            defaultTargetState: 'EDIT_IMAGE_CROP',
        },
        switchToIdle: {
            action: NO_OP,
            defaultTargetState: 'IDLE',
        },
    };
}

class ToolEditImageState extends TemplateState<
    TrainEditorToolEvents,
    TrainEditorToolContext,
    TrainEditorToolStates
> {
    private _imageEditStateMachine: ImageEditStateMachine;

    constructor(imageEditStateMachine: ImageEditStateMachine) {
        super();
        this._imageEditStateMachine = imageEditStateMachine;
    }

    uponEnter(): void {
        this._imageEditStateMachine.happens('startImageEdit');
    }

    beforeExit(): void {
        this._imageEditStateMachine.happens('endImageEdit');
    }

    protected _defer: Defer<
        TrainEditorToolContext,
        TrainEditorToolEvents,
        TrainEditorToolStates
    > = {
        action: (_context, event, eventKey) => {
            const result = this._imageEditStateMachine.happens(
                eventKey as string,
                event
            );
            if (result.handled) {
                return { handled: true, output: result.output };
            }
            return { handled: false };
        },
    };

    protected _eventReactions: EventReactions<
        TrainEditorToolEvents,
        TrainEditorToolContext,
        TrainEditorToolStates
    > = {
        switchToEditBogie: {
            action: NO_OP,
            defaultTargetState: 'EDIT_BOGIE',
        },
        switchToAddBogie: {
            action: NO_OP,
            defaultTargetState: 'ADD_BOGIE',
        },
        switchToRemoveBogie: {
            action: NO_OP,
            defaultTargetState: 'REMOVE_BOGIE',
        },
        switchToEditImage: {
            action: NO_OP,
        },
        switchToCropImage: {
            action: NO_OP,
            defaultTargetState: 'EDIT_IMAGE_CROP',
        },
        switchToIdle: {
            action: NO_OP,
            defaultTargetState: 'IDLE',
        },
    };
}

class ToolCropImageState extends TemplateState<
    TrainEditorToolEvents,
    TrainEditorToolContext,
    TrainEditorToolStates
> {
    private _imageCropStateMachine: ImageCropStateMachine;

    constructor(imageCropStateMachine: ImageCropStateMachine) {
        super();
        this._imageCropStateMachine = imageCropStateMachine;
    }

    uponEnter(): void {
        this._imageCropStateMachine.happens('startCrop', {});
    }

    beforeExit(): void {
        this._imageCropStateMachine.happens('endCrop', {});
    }

    protected _defer: Defer<
        TrainEditorToolContext,
        TrainEditorToolEvents,
        TrainEditorToolStates
    > = {
        action: (_context, event, eventKey) => {
            const result = this._imageCropStateMachine.happens(
                eventKey as string,
                event
            );
            if (result.handled) {
                return { handled: true, output: result.output };
            }
            return { handled: false };
        },
    };

    protected _eventReactions: EventReactions<
        TrainEditorToolEvents,
        TrainEditorToolContext,
        TrainEditorToolStates
    > = {
        switchToEditBogie: {
            action: NO_OP,
            defaultTargetState: 'EDIT_BOGIE',
        },
        switchToAddBogie: {
            action: NO_OP,
            defaultTargetState: 'ADD_BOGIE',
        },
        switchToRemoveBogie: {
            action: NO_OP,
            defaultTargetState: 'REMOVE_BOGIE',
        },
        switchToEditImage: {
            action: NO_OP,
            defaultTargetState: 'EDIT_IMAGE',
        },
        switchToCropImage: {
            action: NO_OP,
        },
        switchToIdle: {
            action: NO_OP,
            defaultTargetState: 'IDLE',
        },
    };
}

export const createTrainEditorToolSwitcher = (
    bogieEditStateMachine: BogieEditStateMachine,
    bogieAddStateMachine: BogieAddStateMachine,
    bogieRemoveStateMachine: BogieRemoveStateMachine,
    imageEditStateMachine: ImageEditStateMachine,
    imageCropStateMachine: ImageCropStateMachine
): TrainEditorToolStateMachine => {
    return new TemplateStateMachine<
        TrainEditorToolEvents,
        TrainEditorToolContext,
        TrainEditorToolStates
    >(
        {
            IDLE: new ToolIdleState(),
            EDIT_BOGIE: new ToolEditBogieState(bogieEditStateMachine),
            ADD_BOGIE: new ToolAddBogieState(bogieAddStateMachine),
            REMOVE_BOGIE: new ToolRemoveBogieState(bogieRemoveStateMachine),
            EDIT_IMAGE: new ToolEditImageState(imageEditStateMachine),
            EDIT_IMAGE_CROP: new ToolCropImageState(imageCropStateMachine),
        },
        'IDLE',
        { setup: () => {}, cleanup: () => {} }
    );
};
