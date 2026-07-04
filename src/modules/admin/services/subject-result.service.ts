import { prisma } from '../../../lib/prisma';
import { basePrisma } from '../../../lib/prisma';
import { logAudit } from '../../../services/audit.service';

// ─── Pure Math Functions (individually testable) ──────────────────────

export type ExamResult = {
  marksObtained: number;
  totalMarks: number;
  weight: number;
};

/**
 * Computes the weighted average percentage from exam results.
 * - Absent students: marksObtained=0 (policy decision, see design)
 * - weight is already resolved (not null)
 * - If all exams have 0 weight, falls back to equal weighting
 */
export function computeWeightedAverage(exams: ExamResult[]): number {
  if (exams.length === 0) return 0;

  // Compute percentage for each exam (marksObtained / totalMarks * 100)
  const results = exams.map((e) => ({
    percentage: e.totalMarks > 0 ? (e.marksObtained / e.totalMarks) * 100 : 0,
    weight: e.weight,
  }));

  const totalWeight = results.reduce((s, r) => s + r.weight, 0);

  if (totalWeight === 0) {
    // All weights are 0 — equal weight split
    return results.reduce((s, r) => s + r.percentage, 0) / results.length;
  }

  const weightedSum = results.reduce((s, r) => s + r.percentage * r.weight, 0);
  return weightedSum / totalWeight;
}

export function computeCompetitionRanks(percentages: number[]): number[] {
  const indexed = percentages.map((p, i) => ({ p, i }));
  indexed.sort((a, b) => b.p - a.p); // descending

  const ranks: number[] = new Array(percentages.length);
  let currentRank = 1;
  let skipCount = 0;

  for (let i = 0; i < indexed.length; i++) {
    if (i > 0 && indexed[i].p < indexed[i - 1].p) {
      currentRank += skipCount + 1;
      skipCount = 0;
    } else if (i > 0 && indexed[i].p === indexed[i - 1].p) {
      skipCount++;
    }
    ranks[indexed[i].i] = currentRank;
  }

  return ranks;
}

export function lookupGrade(
  percentage: number,
  bands: { minPercent: number; maxPercent: number; label: string }[],
): string {
  for (const band of bands) {
    if (percentage >= band.minPercent && percentage <= band.maxPercent) {
      return band.label;
    }
  }
  // Fallback — shouldn't happen if bands cover 0-100
  return percentage >= 50 ? 'C' : 'F';
}

// ─── Service ──────────────────────────────────────────────────────────

class SubjectResultService {
  async getResult(studentId: string, examSessionId: string, subjectId: string) {
    const result = await prisma.subjectResult.findUnique({
      where: {
        studentId_examSessionId_subjectId: { studentId, examSessionId, subjectId },
      },
      include: {
        student: { select: { id: true, name: true, rollNumber: true } },
        subject: { select: { id: true, name: true, code: true } },
      },
    });
    if (!result) throw { status: 404, message: 'Subject result not found. Run computation first.' };
    return result;
  }

  async computeForStudent(studentId: string, examSessionId: string, subjectId: string) {
    const { exams, gradeBands } = await this._fetchData(examSessionId, subjectId, [studentId]);

    if (exams.length === 0) {
      throw { status: 400, message: 'No active exams found for this subject in this session' };
    }

    const studentExams = exams
      .map((e) => {
        const sm = e.studentMarks.get(studentId);
        return {
          marksObtained: sm?.marksObtained ?? null,
          isAbsent: sm?.isAbsent ?? false,
          hasEntry: sm !== undefined,
          totalMarks: e.totalMarks,
          weight: e.weight,
        };
      })
      .filter((e) => e.hasEntry) // skip exams where student has no entry at all
      .map((e) => ({
        marksObtained: e.isAbsent ? 0 : (e.marksObtained ?? 0),
        totalMarks: e.totalMarks,
        weight: e.weight,
      }));

    if (studentExams.length === 0) {
      throw { status: 400, message: 'Student has no marks entries for any exam in this subject. Enter marks first.' };
    }

    const percentage = computeWeightedAverage(
      studentExams.map((e) => ({ marksObtained: e.marksObtained, totalMarks: e.totalMarks, weight: e.weight })),
    );

    const grade = lookupGrade(percentage, gradeBands);

    const result = await prisma.subjectResult.upsert({
      where: {
        studentId_examSessionId_subjectId: { studentId, examSessionId, subjectId },
      },
      create: { studentId, examSessionId, subjectId, percentage, grade, createdById: undefined },
      update: { percentage, grade },
    });

    return result;
  }

  async computeForClass(classId: string, examSessionId: string, subjectId: string) {
    // Get all students in this class
    const students = await prisma.student.findMany({
      where: { groupId: classId, isActive: true },
      select: { id: true, name: true, rollNumber: true },
      orderBy: { rollNumber: 'asc' },
    });
    if (students.length === 0) throw { status: 400, message: 'No students found in this class' };

    const studentIds = students.map((s) => s.id);
    const { exams, gradeBands } = await this._fetchData(examSessionId, subjectId, studentIds);

    if (exams.length === 0) {
      throw { status: 400, message: 'No active exams found for this subject in this session' };
    }

    // Group entries by student
    const entriesByStudent = new Map<string, { marksObtained: number; totalMarks: number; weight: number }[]>();
    for (const sid of studentIds) {
      const studentExams = exams
        .map((e) => ({
          marksObtained: e.studentMarks.get(sid)?.marksObtained ?? null,
          totalMarks: e.totalMarks,
          weight: e.weight,
          isAbsent: e.studentMarks.get(sid)?.isAbsent ?? false,
          hasEntry: e.studentMarks.has(sid),
        }))
        .filter((e) => e.hasEntry) // skip exams where student has no entry
        .map((e) => ({
          marksObtained: e.isAbsent ? 0 : (e.marksObtained ?? 0),
          totalMarks: e.totalMarks,
          weight: e.weight,
        }));
      if (studentExams.length > 0) {
        entriesByStudent.set(sid, studentExams);
      }
    }

    if (entriesByStudent.size === 0) {
      return [];
    }

    // Compute each student's percentage
    const results: { studentId: string; percentage: number; grade: string }[] = [];
    for (const [sid, studentExams] of entriesByStudent) {
      const percentage = computeWeightedAverage(studentExams);
      const grade = lookupGrade(percentage, gradeBands);
      results.push({ studentId: sid, percentage, grade });
    }

    // Sort by percentage descending, assign competition ranks
    results.sort((a, b) => b.percentage - a.percentage);
    const ranks = computeCompetitionRanks(results.map((r) => r.percentage));

    // Bulk upsert
    await basePrisma.$transaction(async (tx) => {
      for (let i = 0; i < results.length; i++) {
        await tx.subjectResult.upsert({
          where: {
            studentId_examSessionId_subjectId: {
              studentId: results[i].studentId,
              examSessionId,
              subjectId,
            },
          },
          create: {
            studentId: results[i].studentId,
            examSessionId,
            subjectId,
            percentage: results[i].percentage,
            grade: results[i].grade,
            subjectRank: ranks[i],
          },
          update: {
            percentage: results[i].percentage,
            grade: results[i].grade,
            subjectRank: ranks[i],
          },
        });
      }
    });

    // Return with student info
    const studentMap = new Map(students.map((s) => [s.id, s]));
    return results.map((r, i) => ({
      ...r,
      student: { id: r.studentId, name: studentMap.get(r.studentId)?.name, rollNumber: studentMap.get(r.studentId)?.rollNumber },
      rank: ranks[i],
    }));
  }

  async computeForSession(examSessionId: string) {
    // Find all unique (classId, subjectId) combos from ACTIVE exams in this session
    const ecsRows = await prisma.examClassSubject.findMany({
      where: {
        examClass: {
          exam: { examSessionId, status: 'ACTIVE' },
        },
        isActive: true,
      },
      select: {
        examClass: { select: { classId: true } },
        subjectId: true,
      },
      distinct: ['examClassId', 'subjectId'],
    });

    // Deduplicate by (classId, subjectId)
    const combos = new Set<string>();
    for (const row of ecsRows) {
      combos.add(`${row.examClass.classId}|${row.subjectId}`);
    }

    // Compute for each combo
    let totalStudents = 0;
    for (const combo of combos) {
      const [classId, subjectId] = combo.split('|');
      const results = await this.computeForClass(classId, examSessionId, subjectId);
      totalStudents += results.length;
    }

    await logAudit({
      action: 'CREATE',
      module: 'exams',
      entityType: 'SubjectResult',
      entityId: examSessionId,
      metadata: { action: 'bulk_compute', classSubjectCount: combos.size, studentCount: totalStudents, examSessionId },
    });

    return { classSubjectCombos: combos.size, totalStudents };
  }

  /**
   * Shared data fetcher: gets all ACTIVE exams + marks + grade bands for a
   * session+subject+set of students in one go.
   */
  private async _fetchData(examSessionId: string, subjectId: string, studentIds: string[]) {
    const ecsList = await prisma.examClassSubject.findMany({
      where: {
        examClass: { exam: { examSessionId, status: 'ACTIVE' } },
        subjectId,
        isActive: true,
      },
      include: {
        examClass: {
          include: {
            exam: {
              select: {
                id: true,
                name: true,
                weightOverride: true,
                examType: { select: { defaultWeight: true } },
              },
            },
          },
        },
      },
    });
    if (ecsList.length === 0) throw { status: 400, message: 'No active exams found for this subject in this session' };

    const ecsIds = ecsList.map((ecs) => ecs.id);

    // Fetch totalMarks from each ECS
    const totalMarksMap = new Map(ecsList.map((ecs) => [ecs.id, ecs.totalMarks]));

    // Fetch all marks entries for these students + ECS IDs
    const entries = await prisma.marksEntry.findMany({
      where: { examClassSubjectId: { in: ecsIds }, studentId: { in: studentIds } },
      select: { studentId: true, examClassSubjectId: true, marksObtained: true, isAbsent: true },
    });

    // Determine effective weight for each ECS
    const weights = ecsList.map((ecs) => {
      const w = ecs.examClass.exam.weightOverride ?? ecs.examClass.exam.examType?.defaultWeight ?? null;
      return { ecsId: ecs.id, weight: w, totalMarks: ecs.totalMarks };
    });

    // If all weights null → equal split (everyone gets 1)
    const allNull = weights.every((w) => w.weight === null);
    if (allNull) {
      weights.forEach((w) => (w.weight = 1));
    } else {
      // If SOME are null, those default to 1 (equal-split fallback per-exam)
      weights.forEach((w) => {
        if (w.weight === null) w.weight = 1;
      });
    }

    // Build exam data per ECS
    const exams = ecsList.map((ecs) => {
      const w = weights.find((w) => w.ecsId === ecs.id)!;
      const studentMarks = new Map<string, { marksObtained: number | null; isAbsent: boolean }>();
      for (const entry of entries) {
        if (entry.examClassSubjectId === ecs.id) {
          studentMarks.set(entry.studentId, { marksObtained: entry.marksObtained, isAbsent: entry.isAbsent });
        }
      }
      // Normalize weight: if equal split, weight = 1; otherwise actual weight
      const weightFactor = allNull ? 1 : w.weight!;
      return {
        examId: ecs.examClass.exam.id,
        examName: ecs.examClass.exam.name,
        totalMarks: ecs.totalMarks ?? 100,
        weight: weightFactor,
        studentMarks,
      };
    });

    // Fetch grade bands
    const gradeScale = await prisma.gradeScale.findFirst({
      where: { isDefault: true },
      include: { bands: { orderBy: { minPercent: 'desc' } } },
    });
    const gradeBands = gradeScale?.bands ?? [
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

    return { exams, gradeBands };
  }
}

export const subjectResultService = new SubjectResultService();
