import { prisma } from '../../../lib/prisma';

class TimetableDayConfigService {
  async getDays(academicYearId: string, timetableGroup = 'default') {
    return prisma.timetableDayConfig.findMany({
      where: { academicYearId, timetableGroup },
      orderBy: { dayOfWeek: 'asc' },
    });
  }

  async setDays(academicYearId: string, timetableGroup: string, days: { dayOfWeek: number; isActive: boolean }[]) {
    for (const d of days) {
      await prisma.timetableDayConfig.upsert({
        where: { academicYearId_timetableGroup_dayOfWeek: { academicYearId, timetableGroup, dayOfWeek: d.dayOfWeek } },
        create: { academicYearId, timetableGroup, dayOfWeek: d.dayOfWeek, isActive: d.isActive },
        update: { isActive: d.isActive },
      });
    }
    return this.getDays(academicYearId, timetableGroup);
  }

  async getActiveDays(academicYearId: string, timetableGroup = 'default'): Promise<number[]> {
    const configs = await prisma.timetableDayConfig.findMany({
      where: { academicYearId, timetableGroup, isActive: true },
    });
    return configs.map(c => c.dayOfWeek);
  }
}

class TimetableSlotService {
  async findAll(academicYearId: string, timetableGroup?: string) {
    return prisma.timetableSlot.findMany({
      where: { academicYearId, isActive: true, ...(timetableGroup ? { timetableGroup } : {}) },
      orderBy: [{ dayOfWeek: 'asc' }, { lectureNumber: 'asc' }],
    });
  }

  async create(academicYearId: string, data: { dayOfWeek: number; startTime: string; endTime: string; timetableGroup?: string }) {
    const group = data.timetableGroup || 'default';
    const lastSlot = await prisma.timetableSlot.findFirst({
      where: { academicYearId, timetableGroup: group, dayOfWeek: data.dayOfWeek },
      orderBy: { lectureNumber: 'desc' },
    });
    const lectureNumber = (lastSlot?.lectureNumber ?? 0) + 1;

    return prisma.timetableSlot.create({
      data: {
        academicYearId,
        timetableGroup: group,
        dayOfWeek: data.dayOfWeek,
        lectureNumber,
        startTime: data.startTime,
        endTime: data.endTime,
      },
    });
  }

  async update(id: string, data: { startTime?: string; endTime?: string; dayOfWeek?: number }) {
    const existing = await prisma.timetableSlot.findUnique({ where: { id } });
    if (!existing) throw { status: 404, message: 'Slot not found' };
    return prisma.timetableSlot.update({ where: { id }, data });
  }

  async delete(id: string) {
    const existing = await prisma.timetableSlot.findUnique({ where: { id } });
    if (!existing) throw { status: 404, message: 'Slot not found' };
    await prisma.timetableSlot.delete({ where: { id } });
    return { message: 'Slot deleted' };
  }
}

class TimetableEntryService {
  async findByGroup(groupId: string) {
    return prisma.timetableEntry.findMany({
      where: { groupId },
      include: {
        slot: { select: { dayOfWeek: true, startTime: true, endTime: true, lectureNumber: true } },
        subject: { select: { id: true, name: true, code: true } },
        teacher: { select: { id: true, name: true } },
      },
      orderBy: { slot: { lectureNumber: 'asc' } },
    });
  }

  async upsert(slotId: string, groupId: string, data: { subjectId?: string | null; teacherId?: string | null }) {
    return prisma.timetableEntry.upsert({
      where: { slotId_groupId: { slotId, groupId } },
      create: { slotId, groupId, subjectId: data.subjectId, teacherId: data.teacherId },
      update: { subjectId: data.subjectId, teacherId: data.teacherId },
      include: {
        subject: { select: { id: true, name: true } },
        teacher: { select: { id: true, name: true } },
      },
    });
  }

  async remove(slotId: string, groupId: string) {
    await prisma.timetableEntry.delete({ where: { slotId_groupId: { slotId, groupId } } });
    return { message: 'Entry removed' };
  }
}

export const timetableDayConfigService = new TimetableDayConfigService();
export const timetableSlotService = new TimetableSlotService();
export const timetableEntryService = new TimetableEntryService();
