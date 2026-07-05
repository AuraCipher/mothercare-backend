import { prisma } from '../../../lib/prisma';
import type { ScopeContext } from '../utils/scope-context';

export const PASSING_MIN_PERCENT = 40;
const FAIL_GRADES = new Set(['F', 'E', 'D']);

export function isPassingResult(percentage: number, grade: string): boolean {
  if (FAIL_GRADES.has(grade)) return false;
  return percentage >= PASSING_MIN_PERCENT;
}

export type ResultAnalyticsFilters = {
  sessionId?: string;
  examId?: string;
  classId?: string;
  subjectId?: string;
};

type TrendRow = {
  id: string;
  label: string;
  marksPercent: number;
  passRate: number;
  avgPercent: number;
  passed: number;
  failed: number;
  total: number;
};

function pct(n: number, d: number) {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : 0;
}

function classLabel(name: string, section: string | null) {
  return section ? `${name} — ${section}` : name;
}

function tallyPassFail(items: { percentage: number; grade: string }[]) {
  let passed = 0;
  let failed = 0;
  for (const item of items) {
    if (isPassingResult(item.percentage, item.grade)) passed += 1;
    else failed += 1;
  }
  return { passed, failed, total: items.length };
}

class ResultAnalyticsService {
  async getAnalytics(scope: ScopeContext, filters: ResultAnalyticsFilters) {
    const { sessionId, examId, classId, subjectId } = filters;

    const sessions = await prisma.examSession.findMany({
      where: {
        academicYearId: scope.academicYearId,
        ...(sessionId ? { id: sessionId } : {}),
      },
      orderBy: { startDate: 'asc' },
      select: { id: true, name: true, startDate: true },
    });

    const sessionIds = sessions.map((s) => s.id);

    let examIds: string[] = [];
    if (examId) {
      examIds = [examId];
    } else if (sessionIds.length > 0) {
      const exams = await prisma.exam.findMany({
        where: { examSessionId: { in: sessionIds } },
        select: { id: true, name: true, examSessionId: true, startDate: true },
        orderBy: { startDate: 'asc' },
      });
      examIds = exams.map((e) => e.id);
    }

    const marksProgress = await this.getMarksProgress(examIds, classId, subjectId);

    const studentWhere = {
      isActive: true,
      academicYearId: scope.academicYearId,
      academicYear: { branchId: scope.branchId },
      ...(classId ? { groupId: classId } : {}),
    };

    const subjectResults = sessionIds.length > 0
      ? await prisma.subjectResult.findMany({
          where: {
            examSessionId: { in: sessionIds },
            ...(subjectId ? { subjectId } : {}),
            student: studentWhere,
          },
          select: {
            percentage: true,
            grade: true,
            subjectId: true,
            examSessionId: true,
            studentId: true,
            subject: { select: { id: true, name: true } },
            student: { select: { groupId: true, group: { select: { id: true, name: true, section: true } } } },
          },
        })
      : [];

    const reportCards = sessionIds.length > 0 && !subjectId
      ? await prisma.reportCard.findMany({
          where: {
            examSessionId: { in: sessionIds },
            student: studentWhere,
          },
          select: {
            overallPercentage: true,
            overallGrade: true,
            examSessionId: true,
            studentId: true,
            student: { select: { groupId: true, group: { select: { id: true, name: true, section: true } } } },
          },
        })
      : [];

    const gradeMap = new Map<string, number>();
    const bumpGrade = (grade: string) => gradeMap.set(grade, (gradeMap.get(grade) ?? 0) + 1);

    let passFailSource: { percentage: number; grade: string }[];

    if (subjectId || subjectResults.length > 0 && reportCards.length === 0) {
      passFailSource = subjectResults.map((r) => ({ percentage: r.percentage, grade: r.grade }));
      for (const r of subjectResults) bumpGrade(r.grade);
    } else if (reportCards.length > 0) {
      passFailSource = reportCards.map((r) => ({
        percentage: r.overallPercentage,
        grade: r.overallGrade,
      }));
      for (const r of reportCards) bumpGrade(r.overallGrade);
    } else {
      passFailSource = [];
    }

    const { passed, failed, total: passFailTotal } = tallyPassFail(passFailSource);
    const passRate = pct(passed, passFailTotal);
    const avgPercentage = passFailTotal > 0
      ? Math.round((passFailSource.reduce((s, r) => s + r.percentage, 0) / passFailTotal) * 10) / 10
      : null;

    const subjectAvgMap = new Map<string, { name: string; sum: number; count: number; passed: number }>();
    for (const r of subjectResults) {
      const cur = subjectAvgMap.get(r.subjectId) ?? { name: r.subject.name, sum: 0, count: 0, passed: 0 };
      cur.sum += r.percentage;
      cur.count += 1;
      if (isPassingResult(r.percentage, r.grade)) cur.passed += 1;
      subjectAvgMap.set(r.subjectId, cur);
    }
    const subjectAvgs = Array.from(subjectAvgMap.entries())
      .map(([id, v]) => ({
        id,
        label: v.name,
        avg: Math.round((v.sum / v.count) * 10) / 10,
        passRate: pct(v.passed, v.count),
        count: v.count,
      }))
      .sort((a, b) => b.avg - a.avg);

    const sessionTrend: TrendRow[] = [];
    for (const session of sessions) {
      const sessMarks = await this.getMarksProgress(
        examId ? [examId] : (await prisma.exam.findMany({
          where: { examSessionId: session.id },
          select: { id: true },
        })).map((e) => e.id),
        classId,
        subjectId,
      );

      let items: { percentage: number; grade: string }[];
      if (subjectId) {
        items = subjectResults
          .filter((r) => r.examSessionId === session.id)
          .map((r) => ({ percentage: r.percentage, grade: r.grade }));
      } else {
        const cards = reportCards.filter((r) => r.examSessionId === session.id);
        items = cards.length > 0
          ? cards.map((r) => ({ percentage: r.overallPercentage, grade: r.overallGrade }))
          : subjectResults
              .filter((r) => r.examSessionId === session.id)
              .map((r) => ({ percentage: r.percentage, grade: r.grade }));
      }

      const t = tallyPassFail(items);
      const avg = items.length > 0
        ? Math.round((items.reduce((s, i) => s + i.percentage, 0) / items.length) * 10) / 10
        : 0;

      sessionTrend.push({
        id: session.id,
        label: session.name,
        marksPercent: sessMarks.percent,
        passRate: pct(t.passed, t.total),
        avgPercent: avg,
        passed: t.passed,
        failed: t.failed,
        total: t.total,
      });
    }

    const examTrend: TrendRow[] = [];
    if (sessionId && !examId) {
      const exams = await prisma.exam.findMany({
        where: { examSessionId: sessionId },
        orderBy: { startDate: 'asc' },
        select: { id: true, name: true },
      });
      for (const exam of exams) {
        const exMarks = await this.getMarksProgress([exam.id], classId, subjectId);
        const exPass = await this.getExamMarksPassFail(exam.id, classId, subjectId, scope);
        examTrend.push({
          id: exam.id,
          label: exam.name,
          marksPercent: exMarks.percent,
          passRate: exPass.passRate,
          avgPercent: exPass.avgPercent,
          passed: exPass.passed,
          failed: exPass.failed,
          total: exPass.total,
        });
      }
    } else if (examId) {
      const exam = await prisma.exam.findUnique({
        where: { id: examId },
        select: { id: true, name: true },
      });
      if (exam) {
        const exMarks = await this.getMarksProgress([exam.id], classId, subjectId);
        const exPass = await this.getExamMarksPassFail(exam.id, classId, subjectId, scope);
        examTrend.push({
          id: exam.id,
          label: exam.name,
          marksPercent: exMarks.percent,
          passRate: exPass.passRate,
          avgPercent: exPass.avgPercent,
          passed: exPass.passed,
          failed: exPass.failed,
          total: exPass.total,
        });
      }
    }

    const classTrend: TrendRow[] = [];
    if (sessionIds.length > 0) {
      const groups = await prisma.group.findMany({
        where: {
          academicYearId: scope.academicYearId,
          isActive: true,
          ...(classId ? { id: classId } : {}),
        },
        orderBy: { displayOrder: 'asc' },
        select: { id: true, name: true, section: true },
      });

      for (const group of groups) {
        const gExamIds = examIds;
        const gMarks = await this.getMarksProgress(gExamIds, group.id, subjectId);

        let items: { percentage: number; grade: string }[];
        if (subjectId) {
          items = subjectResults
            .filter((r) => r.student.groupId === group.id)
            .map((r) => ({ percentage: r.percentage, grade: r.grade }));
        } else {
          const cards = reportCards.filter((r) => r.student.groupId === group.id);
          items = cards.length > 0
            ? cards.map((r) => ({ percentage: r.overallPercentage, grade: r.overallGrade }))
            : subjectResults
                .filter((r) => r.student.groupId === group.id)
                .map((r) => ({ percentage: r.percentage, grade: r.grade }));
        }

        const t = tallyPassFail(items);
        const avg = items.length > 0
          ? Math.round((items.reduce((s, i) => s + i.percentage, 0) / items.length) * 10) / 10
          : 0;

        if (gMarks.total > 0 || t.total > 0) {
          classTrend.push({
            id: group.id,
            label: classLabel(group.name, group.section),
            marksPercent: gMarks.percent,
            passRate: pct(t.passed, t.total),
            avgPercent: avg,
            passed: t.passed,
            failed: t.failed,
            total: t.total,
          });
        }
      }
      classTrend.sort((a, b) => b.passRate - a.passRate);
    }

    const gradeBreakdown = Array.from(gradeMap.entries())
      .map(([grade, count]) => ({ grade, count }))
      .sort((a, b) => b.count - a.count);

    return {
      filters: { sessionId: sessionId ?? null, examId: examId ?? null, classId: classId ?? null, subjectId: subjectId ?? null },
      summary: {
        marksTotal: marksProgress.total,
        marksFilled: marksProgress.filled,
        marksPercent: marksProgress.percent,
        resultCount: subjectResults.length,
        reportCardCount: reportCards.length,
        passed,
        failed,
        passFailTotal,
        passRate,
        avgPercentage,
        passingMinPercent: PASSING_MIN_PERCENT,
      },
      passFail: { passed, failed, pending: Math.max(0, marksProgress.filled - passFailTotal) },
      gradeBreakdown,
      subjectAvgs,
      sessionTrend,
      examTrend,
      classTrend,
    };
  }

  private async getMarksProgress(examIds: string[], classId?: string, subjectId?: string) {
    if (examIds.length === 0) return { total: 0, filled: 0, percent: 0 };

    const examClasses = await prisma.examClass.findMany({
      where: {
        examId: { in: examIds },
        isActive: true,
        ...(classId ? { classId } : {}),
      },
      include: {
        subjects: {
          where: {
            isActive: true,
            ...(subjectId ? { subjectId } : {}),
          },
          include: { _count: { select: { marksEntries: true } } },
        },
      },
    });

    let total = 0;
    let filled = 0;
    for (const ec of examClasses) {
      for (const sub of ec.subjects) {
        total += 1;
        if (sub._count.marksEntries > 0) filled += 1;
      }
    }
    return { total, filled, percent: total > 0 ? Math.round((filled / total) * 100) : 0 };
  }

  private async getExamMarksPassFail(
    examId: string,
    classId: string | undefined,
    subjectId: string | undefined,
    scope: ScopeContext,
  ) {
    const entries = await prisma.marksEntry.findMany({
      where: {
        examClassSubject: {
          isActive: true,
          ...(subjectId ? { subjectId } : {}),
          examClass: {
            examId,
            isActive: true,
            ...(classId ? { classId } : {}),
            class: { academicYearId: scope.academicYearId },
          },
        },
        student: {
          isActive: true,
          academicYearId: scope.academicYearId,
          academicYear: { branchId: scope.branchId },
          ...(classId ? { groupId: classId } : {}),
        },
      },
      select: {
        marksObtained: true,
        isAbsent: true,
        examClassSubject: { select: { passingMarks: true, totalMarks: true } },
      },
    });

    let passed = 0;
    let failed = 0;
    let sumPct = 0;
    let counted = 0;

    for (const e of entries) {
      const total = e.examClassSubject.totalMarks ?? 100;
      const passing = e.examClassSubject.passingMarks ?? Math.round(total * 0.4);
      const obtained = e.isAbsent ? 0 : (e.marksObtained ?? 0);
      const entryPct = total > 0 ? (obtained / total) * 100 : 0;
      sumPct += entryPct;
      counted += 1;
      if (obtained >= passing) passed += 1;
      else failed += 1;
    }

    return {
      passed,
      failed,
      total: entries.length,
      passRate: pct(passed, entries.length),
      avgPercent: counted > 0 ? Math.round((sumPct / counted) * 10) / 10 : 0,
    };
  }
}

export const resultAnalyticsService = new ResultAnalyticsService();
