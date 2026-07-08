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
  branch: { id: string; name: string; code: string };
  portalAccess: 'FULL' | 'READ_ONLY' | 'FROZEN';
  isReadOnly: boolean;
  freezeReason?: string;
  assignments: TeacherAssignmentRow[];
  classTeacherGroupIds: string[];
  assignmentGroupIds: string[];
}
