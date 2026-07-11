import { prisma } from '../../../lib/prisma';
import logger from '../../../lib/logger';
import type { AttendanceDailyReportJob } from '../../../queues/chat.queue';

export async function runAttendanceDailyReport(data: AttendanceDailyReportJob) {
  const dayStart = new Date(data.date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(data.date);
  dayEnd.setHours(23, 59, 59, 999);

  const records = await prisma.attendance.findMany({
    where: {
      academicYearId: data.academicYearId,
      date: { gte: dayStart, lte: dayEnd },
      student: { academicYear: { branchId: data.branchId } },
    },
    select: { status: true },
  });

  const summary = {
    present: 0,
    absent: 0,
    late: 0,
    leave: 0,
    function: 0,
    total: records.length,
  };

  for (const row of records) {
    const key = row.status as keyof typeof summary;
    if (key in summary && key !== 'total') summary[key]++;
  }

  logger.info('Attendance daily report completed', {
    branchId: data.branchId,
    academicYearId: data.academicYearId,
    date: data.date,
    summary,
  });

  return summary;
}
