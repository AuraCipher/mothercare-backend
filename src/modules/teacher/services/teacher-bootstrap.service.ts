import type { TeacherContext } from './teacher-context.service';

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
    assignmentCount: number;
    classTeacherGroupIds: string[];
  };
  assignments: TeacherContext['assignments'];
}

export function buildBootstrapResponse(ctx: TeacherContext, user: TeacherBootstrapData['user']): TeacherBootstrapData {
  return {
    user,
    teacherProfile: {
      id: ctx.teacherProfileId,
      employeeId: null,
    },
    branch: ctx.branch,
    academicYear: {
      id: ctx.academicYearId,
      label: ctx.academicYearLabel,
      status: ctx.academicYearStatus,
    },
    portal: {
      isReadOnly: ctx.isReadOnly,
      canWrite: !ctx.isReadOnly,
      assignmentCount: ctx.assignments.length,
      classTeacherGroupIds: ctx.classTeacherGroupIds,
    },
    assignments: ctx.assignments,
  };
}
