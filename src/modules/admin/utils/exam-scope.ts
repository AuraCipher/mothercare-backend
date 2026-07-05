import { prisma } from '../../../lib/prisma';
import type { ScopeContext } from './scope-context';

/** Ensure an exam session belongs to the resolved branch + academic year. */
export async function assertExamSessionInScope(examSessionId: string, scope: ScopeContext) {
  const session = await prisma.examSession.findFirst({
    where: { id: examSessionId, academicYearId: scope.academicYearId },
    select: {
      id: true,
      name: true,
      academicYear: { select: { branchId: true } },
    },
  });
  if (!session) {
    throw { status: 404, message: 'Exam session not found in the selected academic year' };
  }
  if (session.academicYear.branchId !== scope.branchId) {
    throw { status: 403, message: 'Exam session does not belong to this branch' };
  }
  return session;
}

/** Ensure a class/group belongs to the resolved academic year + branch. */
export async function assertGroupInScope(classId: string, scope: ScopeContext) {
  const group = await prisma.group.findFirst({
    where: {
      id: classId,
      academicYearId: scope.academicYearId,
      academicYear: { branchId: scope.branchId },
    },
    select: { id: true, name: true, section: true },
  });
  if (!group) {
    throw { status: 404, message: 'Class not found in the selected academic year' };
  }
  return group;
}

/** Ensure a subject belongs to the resolved academic year. */
export async function assertSubjectInScope(subjectId: string, scope: ScopeContext) {
  const subject = await prisma.subject.findFirst({
    where: {
      id: subjectId,
      academicYearId: scope.academicYearId,
      academicYear: { branchId: scope.branchId },
    },
    select: { id: true, name: true, code: true },
  });
  if (!subject) {
    throw { status: 404, message: 'Subject not found in the selected academic year' };
  }
  return subject;
}

/** Walk exam → session → AY to validate an exam belongs to scope. */
export async function assertExamInScope(examId: string, scope: ScopeContext) {
  const exam = await prisma.exam.findFirst({
    where: {
      id: examId,
      examSession: { academicYearId: scope.academicYearId, academicYear: { branchId: scope.branchId } },
    },
    select: { id: true, examSessionId: true, name: true },
  });
  if (!exam) {
    throw { status: 404, message: 'Exam not found in the selected academic year' };
  }
  return exam;
}

/** Ensure an exam class belongs to the resolved academic year + branch. */
export async function assertExamClassInScope(examClassId: string, scope: ScopeContext) {
  const ec = await prisma.examClass.findFirst({
    where: {
      id: examClassId,
      exam: {
        examSession: {
          academicYearId: scope.academicYearId,
          academicYear: { branchId: scope.branchId },
        },
      },
    },
    select: { id: true },
  });
  if (!ec) {
    throw { status: 404, message: 'Exam class not found in the selected academic year' };
  }
  return ec;
}

/** Walk ECS → exam class → exam → session for marks/structure operations. */
export async function assertExamClassSubjectInScope(examClassSubjectId: string, scope: ScopeContext) {
  const ecs = await prisma.examClassSubject.findFirst({
    where: {
      id: examClassSubjectId,
      examClass: {
        exam: {
          examSession: {
            academicYearId: scope.academicYearId,
            academicYear: { branchId: scope.branchId },
          },
        },
      },
    },
    select: {
      id: true,
      subjectId: true,
      examClass: {
        select: {
          classId: true,
          exam: { select: { id: true, examSessionId: true } },
        },
      },
    },
  });
  if (!ecs) {
    throw { status: 404, message: 'Exam class subject not found in the selected academic year' };
  }
  return ecs;
}

/** Ensure a student belongs to the resolved academic year + branch. */
export async function assertStudentInScope(studentId: string, scope: ScopeContext) {
  const student = await prisma.student.findFirst({
    where: {
      id: studentId,
      academicYearId: scope.academicYearId,
      academicYear: { branchId: scope.branchId },
    },
    select: { id: true, name: true, rollNumber: true },
  });
  if (!student) {
    throw { status: 404, message: 'Student not found in the selected academic year' };
  }
  return student;
}
