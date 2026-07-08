import type { TeacherContext } from './teacher-context.service';
import type { ResolvedTeacherPermissions } from '../permissions/teacher-permissions.types';

export type { TeacherContext };

export interface TeacherBootstrapData {
  user: {
    id: string;
    name: string;
    email: string | null;
    username: string | null;
    role: string;
    profilePhotoId: string | null;
  };
  teacherProfile: {
    id: string;
    employeeId: string | null;
  };
  branch: { id: string; name: string; code: string };
  academicYear: {
    id: string;
    label: string;
    status: string;
  };
  portal: {
    isReadOnly: boolean;
    canWrite: boolean;
    portalAccess: 'FULL' | 'READ_ONLY' | 'FROZEN';
    isFrozen: boolean;
    freezeReason?: string;
    assignmentCount: number;
    classTeacherGroupIds: string[];
    isHod: boolean;
    hodSubjectCount: number;
    canViewParentContact: boolean;
    teachersCanMarkAttendance: boolean;
    teachersCanEnterMarks: boolean;
    permissions: ResolvedTeacherPermissions['features'];
  };
  assignments: TeacherContext['assignments'];
}

export function buildBootstrapResponse(ctx: TeacherContext, user: TeacherBootstrapData['user']): TeacherBootstrapData {
  const p = ctx.permissions;
  return {
    user,
    teacherProfile: {
      id: ctx.teacherProfileId,
      employeeId: null,
    },
    branch: {
      id: ctx.branch.id,
      name: ctx.branch.name,
      code: ctx.branch.code,
    },
    academicYear: {
      id: ctx.academicYearId,
      label: ctx.academicYearLabel,
      status: ctx.academicYearStatus,
    },
    portal: {
      isReadOnly: ctx.isReadOnly,
      canWrite: !ctx.isReadOnly && ctx.portalAccess === 'FULL',
      portalAccess: ctx.portalAccess,
      isFrozen: ctx.portalAccess === 'FROZEN',
      freezeReason: ctx.freezeReason,
      assignmentCount: ctx.assignments.length,
      classTeacherGroupIds: ctx.classTeacherGroupIds,
      isHod: ctx.isHod,
      hodSubjectCount: ctx.hodSubjectIds.length,
      canViewParentContact: p.features.parentContact.canView,
      teachersCanMarkAttendance: p.features.attendance.canMark,
      teachersCanEnterMarks: p.features.marks.canEnter,
      permissions: p.features,
    },
    assignments: ctx.assignments,
  };
}
