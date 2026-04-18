import { Point } from '@ue-too/math';

import {
    ELEVATION,
    FlatElevation,
    ProjectionCurveResult,
    ProjectionEdgeResult,
    ProjectionJointResult,
    SlopedElevation,
} from '../tracks/types';

export type NewJointType =
    | BrandNewJoint
    | BranchJoint
    | ExtendingTrackJoint
    | BranchCurveJoint
    | ConstrainedNewJoint;

export type BrandNewJoint = {
    type: 'new';
} & BaseJoint;

export type BaseJoint = {
    position: Point;
    elevation: ELEVATION;
};

export type ConstrainedNewJoint = {
    type: 'contrained';
    constraint: ProjectionEdgeResult;
} & BaseJoint;

export type BranchJoint = {
    type: 'branchJoint';
    constraint: ProjectionJointResult;
} & BaseJoint;

export type ExtendingTrackJoint = {
    type: 'extendingTrack';
    constraint: ProjectionJointResult;
} & BaseJoint;

export type BranchCurveJoint = {
    type: 'branchCurve';
    constraint: ProjectionCurveResult;
    curveElevation: SlopedElevation | FlatElevation;
} & BaseJoint;
