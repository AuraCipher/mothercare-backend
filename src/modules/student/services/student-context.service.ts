export interface StudentContext {
  userId: string;
  studentId: string;
  studentName: string;
  rollNumber: string | null;
  branchId: string;
  academicYearId: string;
  academicYearStatus: string;
  academicYearLabel: string;
  groupId: string | null;
  groupLabel: string | null;
  branch: { id: string; name: string; code: string };
}
