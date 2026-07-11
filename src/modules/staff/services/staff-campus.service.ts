import { prisma } from '../../../lib/prisma';

export async function getCampusOverview(branchId: string, academicYearId: string) {
  const [studentCount, groupCount, teacherCount, staffCount] = await Promise.all([
    prisma.student.count({
      where: { academicYearId, isActive: true, status: 'ACTIVE' },
    }),
    prisma.group.count({
      where: { academicYearId, isActive: true },
    }),
    prisma.user.count({
      where: {
        role: 'teacher',
        status: 'active',
        branchMembers: { some: { branchId, isActive: true } },
      },
    }),
    prisma.branchMember.count({
      where: {
        branchId,
        isActive: true,
        role: { in: ['branch_admin', 'sub_admin', 'management'] },
        user: { role: { not: 'super_admin' } },
      },
    }),
  ]);

  return {
    studentCount,
    classCount: groupCount,
    teacherCount,
    staffCount,
  };
}

export async function getCampusFeesSummary(branchId: string, academicYearId: string) {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const fees = await prisma.studentFee.findMany({
    where: { academicYearId, month, year },
    select: { netAmount: true, paidAmount: true, status: true, extraItems: { select: { amount: true } } },
  });

  const totalDue = fees.reduce(
    (sum, fee) => sum + fee.netAmount + fee.extraItems.reduce((extra, item) => extra + item.amount, 0),
    0,
  );
  const totalCollected = fees.reduce((sum, fee) => sum + fee.paidAmount, 0);
  const pendingCount = fees.filter((fee) => fee.status === 'UNPAID' || fee.status === 'PARTIAL').length;

  return {
    month,
    year,
    totalDue,
    totalCollected,
    pendingCount,
    totalStudents: fees.length,
    collectionRate: totalDue ? Math.round((totalCollected / totalDue) * 100) : 0,
  };
}

export async function listCampusStaff(branchId: string) {
  const members = await prisma.branchMember.findMany({
    where: {
      branchId,
      isActive: true,
      user: { role: { not: 'super_admin' } },
    },
    select: {
      role: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          status: true,
        },
      },
    },
    orderBy: { user: { name: 'asc' } },
    take: 200,
  });

  return members.map((member) => ({
    id: member.user.id,
    name: member.user.name,
    email: member.user.email,
    phone: member.user.phone,
    userRole: member.user.role,
    branchRole: member.role,
    status: member.user.status,
  }));
}

export async function getCampusAttendanceToday(
  branchId: string,
  academicYearId: string,
  dateInput?: string,
) {
  const date = dateInput ? new Date(dateInput) : new Date();
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);

  const records = await prisma.attendance.findMany({
    where: {
      academicYearId,
      date: { gte: dayStart, lte: dayEnd },
      student: { academicYear: { branchId } },
    },
    select: {
      status: true,
      student: {
        select: {
          groupId: true,
          group: { select: { name: true, section: true } },
        },
      },
    },
  });

  const summary = { present: 0, absent: 0, late: 0, leave: 0, function: 0, total: records.length };
  const byClass = new Map<string, { groupId: string; groupName: string; present: number; absent: number; late: number; total: number }>();

  for (const row of records) {
    const status = row.status as keyof typeof summary;
    if (status in summary && status !== 'total') summary[status]++;

    const groupId = row.student.groupId || 'unassigned';
    const group = row.student.group;
    const label = group
      ? group.section
        ? `${group.name} — ${group.section}`
        : group.name
      : 'Unassigned';
    if (!byClass.has(groupId)) {
      byClass.set(groupId, { groupId, groupName: label, present: 0, absent: 0, late: 0, total: 0 });
    }
    const bucket = byClass.get(groupId)!;
    bucket.total++;
    if (row.status === 'present') bucket.present++;
    if (row.status === 'absent') bucket.absent++;
    if (row.status === 'late') bucket.late++;
  }

  return {
    date: dayStart.toISOString().slice(0, 10),
    summary,
    classes: Array.from(byClass.values()).sort((a, b) => a.groupName.localeCompare(b.groupName)),
  };
}

export async function getCampusResultsSummary(branchId: string, academicYearId: string) {
  const sessions = await prisma.examSession.findMany({
    where: { academicYearId, academicYear: { branchId } },
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      _count: { select: { exams: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  return sessions.map((session) => ({
    id: session.id,
    name: session.name,
    startDate: session.startDate,
    endDate: session.endDate,
    examCount: session._count.exams,
  }));
}
