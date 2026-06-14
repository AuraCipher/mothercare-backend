import { prisma } from '../../../lib/prisma';

class TimetableService {
  // Create a new timetable
  async create(academicYearId: string, name: string, type: string = 'timetable') {
    const existing = await prisma.timetable.findUnique({
      where: { academicYearId_name: { academicYearId, name } },
    });
    if (existing) throw { status: 409, message: `Timetable "${name}" already exists` };

    const tt = await prisma.timetable.create({
      data: { academicYearId, name, type },
    });

    // Create day configs (all days active by default)
    for (let d = 1; d <= 6; d++) {
      await prisma.timetableDayConfig.create({
        data: { timetableId: tt.id, dayOfWeek: d, isActive: true },
      });
    }
    return tt;
  }

  // List all timetables for an AY
  async findAll(academicYearId: string) {
    const timetables = await prisma.timetable.findMany({
      where: { academicYearId },
      orderBy: { createdAt: 'asc' },
      include: {
        _count: { select: { slots: true } },
        dayConfigs: { select: { dayOfWeek: true, isActive: true } },
      },
    });
    return timetables.map(t => ({
      id: t.id,
      name: t.name,
      type: t.type,
      isActive: t.isActive,
      slotCount: t._count.slots,
      activeDays: t.dayConfigs.filter(d => d.isActive).length,
    }));
  }

  // Rename
  async rename(id: string, newName: string) {
    const tt = await prisma.timetable.findUnique({ where: { id } });
    if (!tt) throw { status: 404, message: 'Timetable not found' };
    return prisma.timetable.update({ where: { id }, data: { name: newName } });
  }

  // Delete (blocks if entries exist)
  async delete(id: string) {
    const slots = await prisma.timetableSlot.findMany({ where: { timetableId: id }, select: { id: true } });
    const slotIds = slots.map(s => s.id);

    if (slotIds.length > 0) {
      const entryCount = await prisma.timetableEntry.count({
        where: { slotId: { in: slotIds } },
      });
      if (entryCount > 0) {
        throw { status: 409, message: `${entryCount} timetable entr${entryCount !== 1 ? 'ies' : 'y'} depend on this timetable. Remove them first.` };
      }
    }

    await prisma.timetableDayConfig.deleteMany({ where: { timetableId: id } });
    await prisma.timetableSlot.deleteMany({ where: { timetableId: id } });
    await prisma.timetable.delete({ where: { id } });
    return { message: 'Timetable deleted' };
  }
}

class TimetableSlotService {
  async findAll(timetableId: string) {
    return prisma.timetableSlot.findMany({
      where: { timetableId, isActive: true },
      orderBy: [{ dayOfWeek: 'asc' }, { lectureNumber: 'asc' }],
    });
  }

  async create(timetableId: string, data: { dayOfWeek?: number | null; startTime: string; endTime: string }) {
    const lastSlot = await prisma.timetableSlot.findFirst({
      where: { timetableId },
      orderBy: { lectureNumber: 'desc' },
    });
    const lectureNumber = (lastSlot?.lectureNumber ?? 0) + 1;

    return prisma.timetableSlot.create({
      data: {
        timetableId,
        lectureNumber,
        dayOfWeek: data.dayOfWeek ?? null,
        startTime: data.startTime,
        endTime: data.endTime,
      },
    });
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
        slot: { select: { dayOfWeek: true, startTime: true, endTime: true, lectureNumber: true, timetableId: true } },
        subject: { select: { id: true, name: true, code: true } },
        teacher: { select: { id: true, name: true } },
      },
    });
  }

  async upsert(slotId: string, groupId: string, data: { subjectId?: string | null; teacherId?: string | null; note?: string | null }) {
    return prisma.timetableEntry.upsert({
      where: { slotId_groupId: { slotId, groupId } },
      create: { slotId, groupId, subjectId: data.subjectId, teacherId: data.teacherId, note: data.note },
      update: { subjectId: data.subjectId, teacherId: data.teacherId, note: data.note },
      include: { subject: { select: { id: true, name: true } }, teacher: { select: { id: true, name: true } } },
    });
  }
}

export const timetableService = new TimetableService();
export const timetableSlotService = new TimetableSlotService();
export const timetableEntryService = new TimetableEntryService();
