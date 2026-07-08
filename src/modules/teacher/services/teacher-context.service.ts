import type {
  ResolvedTeacherPermissions,
  TeacherPortalPermissionsStored,
} from '../permissions/teacher-permissions.types';

export interface TeacherAssignmentRow {
  id: string;
  academicYearId: string;
  groupId: string;
  subjectId: string;
  isClassTeacher: boolean;
  role: string;
  group: { id: string; name: string; section: string | null };
  subject: { id: string; name: string; code: string | null };
}

export interface TeacherContext {
  userId: string;
  teacherProfileId: string;
  branchId: string;
  academicYearId: string;
  academicYearStatus: string;
  academicYearLabel: string;
  branch: {
    id: string;
    name: string;
    code: string;
    teacherParentContactEnabled: boolean;
    teachersCanMarkAttendance: boolean;
    teachersCanEnterMarks: boolean;
  };
  portalAccess: 'FULL' | 'READ_ONLY' | 'FROZEN';
  portalPermissions: TeacherPortalPermissionsStored | null;
  permissions: ResolvedTeacherPermissions;
  isReadOnly: boolean;
  freezeReason?: string;
  canViewParentContact: boolean;
  hodParentContactScope: 'ASSIGNED_ONLY' | 'DEPARTMENT_ALL';
  hodSubjectIds: string[];
  isHod: boolean;
  assignments: TeacherAssignmentRow[];
  classTeacherGroupIds: string[];
  assignmentGroupIds: string[];
}
