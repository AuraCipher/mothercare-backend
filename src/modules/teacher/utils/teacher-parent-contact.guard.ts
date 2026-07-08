import { prisma } from '../../../lib/prisma';
import type { TeacherContext } from '../services/teacher-context.service';

export async function canViewParentContactsForGroup(
  ctx: TeacherContext,
  groupId: string,
): Promise<boolean> {
  if (!ctx.branch.teacherParentContactEnabled) return false;
  if (!ctx.canViewParentContact) return false;

  if (ctx.classTeacherGroupIds.includes(groupId)) return true;

  if (ctx.isHod && ctx.hodParentContactScope === 'DEPARTMENT_ALL') {
    const match = await prisma.groupSubject.findFirst({
      where: {
        groupId,
        subjectId: { in: ctx.hodSubjectIds },
        group: { academicYearId: ctx.academicYearId },
      },
      select: { id: true },
    });
    return !!match;
  }

  return ctx.assignmentGroupIds.includes(groupId);
}

export interface ParentContactRow {
  relation: string;
  name: string;
  phone: string | null;
  whatsapp: string | null;
  isPrimary: boolean;
}

export async function loadParentContactsForStudents(
  studentIds: string[],
): Promise<Map<string, ParentContactRow[]>> {
  if (studentIds.length === 0) return new Map();

  const links = await prisma.studentParent.findMany({
    where: { studentId: { in: studentIds } },
    select: {
      studentId: true,
      relation: true,
      isPrimary: true,
      parent: {
        select: {
          phone: true,
          whatsapp: true,
          user: { select: { name: true } },
        },
      },
    },
    orderBy: [{ isPrimary: 'desc' }, { relation: 'asc' }],
  });

  const map = new Map<string, ParentContactRow[]>();
  for (const link of links) {
    const row: ParentContactRow = {
      relation: link.relation,
      name: link.parent.user.name,
      phone: link.parent.phone,
      whatsapp: link.parent.whatsapp,
      isPrimary: link.isPrimary,
    };
    const list = map.get(link.studentId) ?? [];
    list.push(row);
    map.set(link.studentId, list);
  }
  return map;
}
