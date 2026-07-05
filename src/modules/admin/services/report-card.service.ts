import { prisma } from '../../../lib/prisma';
import { basePrisma } from '../../../lib/prisma';
import { logAudit } from '../../../services/audit.service';
import type { ScopeContext } from '../utils/scope-context';
import {
  assertExamSessionInScope,
  assertGroupInScope,
  assertStudentInScope,
} from '../utils/exam-scope';
import { computeCompetitionRanks, lookupGrade } from './subject-result.service';

/** Simple average of subject-result percentages (no credit hours on Subject model). */
export function computeOverallPercentage(subjectResults: { percentage: number }[]): number {
  if (subjectResults.length === 0) return 0;
  const sum = subjectResults.reduce((s, r) => s + r.percentage, 0);
  return sum / subjectResults.length;
}

const FALLBACK_BANDS = [
  { minPercent: 90, maxPercent: 100, label: 'A+' },
  { minPercent: 80, maxPercent: 89.99, label: 'A' },
  { minPercent: 70, maxPercent: 79.99, label: 'B+' },
  { minPercent: 60, maxPercent: 69.99, label: 'B' },
  { minPercent: 50, maxPercent: 59.99, label: 'C+' },
  { minPercent: 40, maxPercent: 49.99, label: 'C' },
  { minPercent: 30, maxPercent: 39.99, label: 'D' },
  { minPercent: 20, maxPercent: 29.99, label: 'E' },
  { minPercent: 0, maxPercent: 19.99, label: 'F' },
];

class ReportCardService {
  async getReportCard(studentId: string, examSessionId: string, scope: ScopeContext) {
    await assertStudentInScope(studentId, scope);
    await assertExamSessionInScope(examSessionId, scope);

    const card = await prisma.reportCard.findUnique({
      where: { studentId_examSessionId: { studentId, examSessionId } },
      include: {
        student: { select: { id: true, name: true, rollNumber: true, groupId: true } },
        examSession: { select: { id: true, name: true } },
      },
    });
    if (!card) throw { status: 404, message: 'Report card not found. Run report card computation first.' };

    const subjectResults = await prisma.subjectResult.findMany({
      where: { studentId, examSessionId },
      include: { subject: { select: { id: true, name: true, code: true } } },
      orderBy: { subject: { name: 'asc' } },
    });

    return { ...card, subjectResults };
  }

  async computeForStudent(studentId: string, examSessionId: string, scope: ScopeContext) {
    await assertStudentInScope(studentId, scope);
    await assertExamSessionInScope(examSessionId, scope);

    const built = await this._upsertStudentCard(studentId, examSessionId);
    if (!built) {
      throw { status: 400, message: 'No subject results found for this student. Compute subject results first.' };
    }

    await logAudit({
      action: 'CREATE',
      module: 'exams',
      entityType: 'ReportCard',
      entityId: built.card.id,
      metadata: {
        action: 'student_compute',
        studentId,
        examSessionId,
        overallPercentage: built.card.overallPercentage,
        academicYearId: scope.academicYearId,
        branchId: scope.branchId,
      },
    });

    return { ...built.card, subjectResults: built.subjectResults };
  }

  async computeForClass(classId: string, examSessionId: string, scope: ScopeContext) {
    await assertExamSessionInScope(examSessionId, scope);
    await assertGroupInScope(classId, scope);

    const students = await prisma.student.findMany({
      where: {
        groupId: classId,
        isActive: true,
        academicYearId: scope.academicYearId,
        academicYear: { branchId: scope.branchId },
      },
      select: { id: true, name: true, rollNumber: true },
      orderBy: { rollNumber: 'asc' },
    });
    if (students.length === 0) throw { status: 400, message: 'No students found in this class' };

    const built: {
      studentId: string;
      card: { id: string; overallPercentage: number; overallGrade: string; classRank: number | null };
      subjectResults: unknown[];
    }[] = [];

    for (const s of students) {
      const row = await this._upsertStudentCard(s.id, examSessionId);
      if (row) {
        built.push({ studentId: s.id, card: row.card, subjectResults: row.subjectResults });
      }
    }

    if (built.length === 0) return [];

    built.sort((a, b) => b.card.overallPercentage - a.card.overallPercentage);
    const ranks = computeCompetitionRanks(built.map((b) => b.card.overallPercentage));

    await basePrisma.$transaction(async (tx) => {
      for (let i = 0; i < built.length; i++) {
        await tx.reportCard.update({
          where: { id: built[i].card.id },
          data: { classRank: ranks[i] },
        });
        built[i].card.classRank = ranks[i];
      }
    });

    const studentMap = new Map(students.map((s) => [s.id, s]));

    await logAudit({
      action: 'CREATE',
      module: 'exams',
      entityType: 'ReportCard',
      entityId: examSessionId,
      metadata: {
        action: 'class_compute',
        classId,
        examSessionId,
        reportCardCount: built.length,
        academicYearId: scope.academicYearId,
        branchId: scope.branchId,
      },
    });

    return built.map((b, i) => ({
      studentId: b.studentId,
      overallPercentage: b.card.overallPercentage,
      overallGrade: b.card.overallGrade,
      classRank: ranks[i],
      student: studentMap.get(b.studentId),
      subjectResults: b.subjectResults,
    }));
  }

  async computeForSession(examSessionId: string, scope: ScopeContext) {
    await assertExamSessionInScope(examSessionId, scope);

    const students = await prisma.student.findMany({
      where: {
        academicYearId: scope.academicYearId,
        academicYear: { branchId: scope.branchId },
        isActive: true,
        groupId: { not: null },
        subjectResults: { some: { examSessionId } },
      },
      select: { groupId: true },
      distinct: ['groupId'],
    });

    const classIds = students.map((s) => s.groupId!).filter(Boolean);
    let reportCardCount = 0;

    for (const classId of classIds) {
      const cards = await this.computeForClass(classId, examSessionId, scope);
      reportCardCount += cards.length;
    }

    await logAudit({
      action: 'CREATE',
      module: 'exams',
      entityType: 'ReportCard',
      entityId: examSessionId,
      metadata: {
        action: 'bulk_compute',
        classCount: classIds.length,
        reportCardCount,
        examSessionId,
        academicYearId: scope.academicYearId,
        branchId: scope.branchId,
      },
    });

    return { classCount: classIds.length, reportCardCount };
  }

  async publish(reportCardId: string, scope: ScopeContext) {
    const card = await prisma.reportCard.findUnique({
      where: { id: reportCardId },
      include: {
        student: {
          select: {
            id: true,
            groupId: true,
            academicYearId: true,
            academicYear: { select: { branchId: true } },
          },
        },
      },
    });
    if (!card) throw { status: 404, message: 'Report card not found' };

    if (
      card.student.academicYearId !== scope.academicYearId
      || card.student.academicYear.branchId !== scope.branchId
    ) {
      throw { status: 403, message: 'Report card does not belong to this branch / academic year' };
    }

    await assertExamSessionInScope(card.examSessionId, scope);

    if (card.status === 'PUBLISHED') {
      throw { status: 400, message: 'Report card is already published' };
    }

    const subjectResults = await prisma.subjectResult.findMany({
      where: { studentId: card.studentId, examSessionId: card.examSessionId },
      select: { subjectId: true, computedAt: true },
    });

    const expectedSubjectIds = await this._expectedSubjectIds(
      card.studentId,
      card.examSessionId,
      card.student.groupId,
    );

    if (expectedSubjectIds.length > 0) {
      const resultSubjectIds = new Set(subjectResults.map((r) => r.subjectId));
      const missing = expectedSubjectIds.filter((id) => !resultSubjectIds.has(id));
      if (missing.length > 0) {
        throw {
          status: 400,
          message: `Cannot publish: subject results missing for ${missing.length} subject(s). Recompute subject results first.`,
        };
      }
    }

    const latestComputed = subjectResults.reduce(
      (max, r) => (r.computedAt > max ? r.computedAt : max),
      new Date(0),
    );
    if (latestComputed > card.updatedAt) {
      throw {
        status: 400,
        message: 'Report card is stale — subject results were recomputed after this card. Recompute report cards first.',
      };
    }

    const updated = await prisma.reportCard.update({
      where: { id: reportCardId },
      data: { status: 'PUBLISHED' },
    });

    await logAudit({
      action: 'UPDATE',
      module: 'exams',
      entityType: 'ReportCard',
      entityId: reportCardId,
      oldValue: { status: card.status },
      newValue: { status: 'PUBLISHED' },
      metadata: {
        action: 'publish',
        studentId: card.studentId,
        examSessionId: card.examSessionId,
        academicYearId: scope.academicYearId,
        branchId: scope.branchId,
      },
    });

    return updated;
  }

  private async _upsertStudentCard(studentId: string, examSessionId: string) {
    const subjectResults = await prisma.subjectResult.findMany({
      where: { studentId, examSessionId },
      include: { subject: { select: { id: true, name: true, code: true } } },
      orderBy: { subject: { name: 'asc' } },
    });
    if (subjectResults.length === 0) return null;

    const overallPercentage = computeOverallPercentage(subjectResults);
    const gradeBands = await this._fetchGradeBands();
    const overallGrade = lookupGrade(overallPercentage, gradeBands);

    const card = await prisma.reportCard.upsert({
      where: { studentId_examSessionId: { studentId, examSessionId } },
      create: {
        studentId,
        examSessionId,
        overallPercentage,
        overallGrade,
        status: 'DRAFT',
      },
      update: {
        overallPercentage,
        overallGrade,
        status: 'DRAFT',
        generatedAt: new Date(),
        classRank: null,
      },
    });

    return { card, subjectResults };
  }

  private async _expectedSubjectIds(
    studentId: string,
    examSessionId: string,
    groupId: string | null,
  ): Promise<string[]> {
    if (!groupId) return [];

    const rows = await prisma.examClassSubject.findMany({
      where: {
        isActive: true,
        examClass: {
          classId: groupId,
          isActive: true,
          exam: { examSessionId, status: 'ACTIVE' },
        },
      },
      select: { subjectId: true },
      distinct: ['subjectId'],
    });
    return rows.map((r) => r.subjectId);
  }

  private async _fetchGradeBands() {
    const gradeScale = await prisma.gradeScale.findFirst({
      where: { isDefault: true },
      include: { bands: { orderBy: { minPercent: 'desc' } } },
    });
    return gradeScale?.bands ?? FALLBACK_BANDS;
  }
}

export const reportCardService = new ReportCardService();
