import { prisma } from '../../../lib/prisma';

export interface CreateCalendarInput {
  label: string;
  startDate: string;
  endDate: string;
  isCurrent?: boolean;
}

export interface UpdateCalendarInput {
  label?: string;
  startDate?: string;
  endDate?: string;
  isCurrent?: boolean;
}

class AcademicCalendarService {
  async create(data: CreateCalendarInput) {
    const existing = await prisma.academicCalendar.findUnique({
      where: { label: data.label },
    });
    if (existing) {
      throw { status: 409, message: `Calendar with label "${data.label}" already exists` };
    }

    // If setting as current, unset others first
    if (data.isCurrent) {
      await prisma.academicCalendar.updateMany({
        where: { isCurrent: true },
        data: { isCurrent: false },
      });
    }

    return prisma.academicCalendar.create({
      data: {
        label: data.label,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
        isCurrent: data.isCurrent ?? false,
      },
    });
  }

  async findAll() {
    return prisma.academicCalendar.findMany({
      orderBy: { startDate: 'desc' },
      include: {
        _count: { select: { academicYears: true } },
      },
    });
  }

  async findById(id: string) {
    const calendar = await prisma.academicCalendar.findUnique({
      where: { id },
      include: {
        _count: { select: { academicYears: true } },
      },
    });
    if (!calendar) {
      throw { status: 404, message: 'Academic calendar not found' };
    }
    return calendar;
  }

  async update(id: string, data: UpdateCalendarInput) {
    const existing = await prisma.academicCalendar.findUnique({ where: { id } });
    if (!existing) {
      throw { status: 404, message: 'Academic calendar not found' };
    }

    // Check label uniqueness if being updated
    if (data.label && data.label !== existing.label) {
      const labelConflict = await prisma.academicCalendar.findUnique({
        where: { label: data.label },
      });
      if (labelConflict) {
        throw { status: 409, message: `Calendar with label "${data.label}" already exists` };
      }
    }

    // If setting as current, unset others first
    if (data.isCurrent) {
      await prisma.academicCalendar.updateMany({
        where: { isCurrent: true, id: { not: id } },
        data: { isCurrent: false },
      });
    }

    return prisma.academicCalendar.update({
      where: { id },
      data: {
        ...(data.label !== undefined ? { label: data.label } : {}),
        ...(data.startDate !== undefined ? { startDate: new Date(data.startDate) } : {}),
        ...(data.endDate !== undefined ? { endDate: new Date(data.endDate) } : {}),
        ...(data.isCurrent !== undefined ? { isCurrent: data.isCurrent } : {}),
      },
    });
  }

  async setCurrent(id: string) {
    const calendar = await prisma.academicCalendar.findUnique({ where: { id } });
    if (!calendar) {
      throw { status: 404, message: 'Academic calendar not found' };
    }

    // Unset all others
    await prisma.academicCalendar.updateMany({
      where: { isCurrent: true },
      data: { isCurrent: false },
    });

    // Set this one as current
    return prisma.academicCalendar.update({
      where: { id },
      data: { isCurrent: true },
    });
  }

  async delete(id: string) {
    const existing = await prisma.academicCalendar.findUnique({
      where: { id },
      include: { _count: { select: { academicYears: true } } },
    });
    if (!existing) {
      throw { status: 404, message: 'Academic calendar not found' };
    }

    if (existing._count.academicYears > 0) {
      throw {
        status: 409,
        message: `Cannot delete calendar "${existing.label}": it has ${existing._count.academicYears} academic year(s) linked`,
      };
    }

    return prisma.academicCalendar.delete({ where: { id } });
  }
}

export const academicCalendarService = new AcademicCalendarService();
