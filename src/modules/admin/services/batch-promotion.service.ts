import { prisma } from '../../../lib/prisma';
import type { BatchPromotionRunPhase, Prisma, StudentCredentialTag, StudentStatus } from '@prisma/client';
import {
  DEFAULT_CARRY_OPTIONS,
  mergeCarryOptions,
  type CarryOptions,
} from '../batch-promotion.constants';

const PROMOTABLE_STATUSES: StudentStatus[] = ['ACTIVE'];

type StartInput = {
  branchId: string;
  sourceAcademicYearId: string;
  targetAcademicYearId?: string;
  calendarId?: string;
  previousAcademicYearId?: string;
  carryOptions?: Partial<CarryOptions>;
  notes?: string;
  promotedById: string;
};

const PRISMA_UNIQUE_ERROR = 'P2002';

class BatchPromotionService {
  async getPreconditions(branchId: string, sourceAcademicYearId: string) {
    const source = await prisma.academicYear.findFirst({
      where: { id: sourceAcademicYearId, branchId },
      include: { calendar: true },
    });
    if (!source) throw { status: 404, message: 'Source academic year not found' };
    if (source.status !== 'ACTIVE') {
      throw { status: 400, message: 'Batch promotion can only start from an ACTIVE academic year' };
    }

    const inProgress = await prisma.batchPromotionRun.findFirst({
      where: {
        branchId,
        phase: { in: ['DRAFT', 'SNAPSHOT_DONE', 'APPLIED'] },
      },
    });
    if (inProgress) {
      throw { status: 409, message: 'Another batch promotion is already in progress for this branch' };
    }

    const buildYears = await prisma.academicYear.findMany({
      where: { branchId, status: 'BUILD_STAGE' },
      include: { calendar: true },
      orderBy: { createdAt: 'desc' },
    });

    return {
      source,
      buildYears,
      defaultCarryOptions: DEFAULT_CARRY_OPTIONS,
      acknowledgements: [
        'The current ACTIVE year stays live until you publish the new year.',
        'Graduated students will lose login after publish.',
        'Outstanding fees remain in the old year unless manually carried forward.',
        'Class promotion rules are automatic (+1 / empty lowest / graduate highest).',
      ],
    };
  }

  async startRun(input: StartInput) {
    await this.getPreconditions(input.branchId, input.sourceAcademicYearId);
    const carryOptions = mergeCarryOptions(input.carryOptions);

    let targetAcademicYearId = input.targetAcademicYearId;
    if (!targetAcademicYearId) {
      if (!input.calendarId) {
        throw { status: 400, message: 'targetAcademicYearId or calendarId is required' };
      }
      try {
        const created = await prisma.academicYear.create({
          data: {
            branchId: input.branchId,
            calendarId: input.calendarId,
            status: 'BUILD_STAGE',
            previousAcademicYearId: input.previousAcademicYearId ?? input.sourceAcademicYearId,
            createdById: input.promotedById,
          },
        });
        targetAcademicYearId = created.id;
      } catch (err: any) {
        if (err?.code === PRISMA_UNIQUE_ERROR) {
          const existingYear = await prisma.academicYear.findFirst({
            where: {
              branchId: input.branchId,
              calendarId: input.calendarId,
            },
          });
          if (!existingYear) throw err;
          if (existingYear.status !== 'BUILD_STAGE') {
            throw {
              status: 409,
              message: 'This calendar already exists in branch as ACTIVE/ARCHIVED year. Pick a different calendar.',
            };
          }
          targetAcademicYearId = existingYear.id;
        } else {
          throw err;
        }
      }
    } else {
      const target = await prisma.academicYear.findFirst({
        where: { id: targetAcademicYearId, branchId: input.branchId },
      });
      if (!target) throw { status: 404, message: 'Target academic year not found' };
      if (target.status !== 'BUILD_STAGE') {
        throw { status: 400, message: 'Target academic year must be in BUILD_STAGE' };
      }
      if (target.id === input.sourceAcademicYearId) {
        throw { status: 400, message: 'Target academic year cannot be the same as source year' };
      }
    }

    const existing = await prisma.batchPromotionRun.findFirst({
      where: {
        sourceAcademicYearId: input.sourceAcademicYearId,
        targetAcademicYearId,
        phase: { notIn: ['PUBLISHED', 'FAILED'] },
      },
    });
    if (existing) return existing;

    return prisma.batchPromotionRun.create({
      data: {
        branchId: input.branchId,
        sourceAcademicYearId: input.sourceAcademicYearId,
        targetAcademicYearId,
        carryOptions: carryOptions as unknown as Prisma.InputJsonValue,
        promotedById: input.promotedById,
        notes: input.notes,
        phase: 'DRAFT',
      },
      include: {
        sourceAy: { include: { calendar: true } },
        targetAy: { include: { calendar: true } },
      },
    });
  }

  async getRun(runId: string, branchId: string) {
    const run = await prisma.batchPromotionRun.findFirst({
      where: { id: runId, branchId },
      include: {
        sourceAy: { include: { calendar: true } },
        targetAy: { include: { calendar: true } },
        snapshot: true,
      },
    });
    if (!run) throw { status: 404, message: 'Promotion run not found' };
    return run;
  }

  async snapshotRun(runId: string, branchId: string, userId: string) {
    const run = await this.getRun(runId, branchId);
    if (run.phase !== 'DRAFT') {
      throw { status: 400, message: 'Snapshot already created for this run' };
    }

    const source = await prisma.academicYear.findUnique({
      where: { id: run.sourceAcademicYearId },
      include: {
        calendar: true,
        groups: { orderBy: { displayOrder: 'asc' }, include: { students: true, teacherAssignments: { include: { teacher: { select: { id: true, name: true } }, subject: true } } } },
      },
    });
    if (!source) throw { status: 404, message: 'Source year not found' };

    return prisma.$transaction(async (tx) => {
      const snapshot = await tx.academicYearSnapshot.create({
        data: {
          academicYearId: source.id,
          newAcademicYearId: run.targetAcademicYearId,
          fromLabel: source.calendar.label,
          toLabel: (await tx.academicYear.findUnique({
            where: { id: run.targetAcademicYearId },
            include: { calendar: true },
          }))!.calendar.label,
          triggeredById: userId,
          status: 'IN_PROGRESS',
          totalStudents: await tx.student.count({ where: { academicYearId: source.id, status: 'ACTIVE' } }),
        },
      });

      for (const group of source.groups) {
        await tx.groupSnapshot.create({
          data: {
            snapshotId: snapshot.id,
            groupId: group.id,
            groupName: group.name,
            section: group.section,
            displayOrder: group.displayOrder,
            studentCount: group.students.length,
            studentsData: group.students.map((s) => ({ id: s.id, name: s.name, rollNumber: s.rollNumber, status: s.status })),
            teachersData: group.teacherAssignments.map((a) => ({
              teacherId: a.teacherId,
              teacherName: a.teacher.name,
              subjectId: a.subjectId,
              subjectName: a.subject.name,
              isClassTeacher: a.isClassTeacher,
              validFrom: a.validFrom,
              validTo: a.validTo,
            })),
          },
        });
      }

      const assignments = await tx.teacherAssignment.findMany({
        where: { academicYearId: source.id },
        orderBy: { validFrom: 'asc' },
      });
      const byTeacher = new Map<string, typeof assignments>();
      for (const a of assignments) {
        const list = byTeacher.get(a.teacherId) ?? [];
        list.push(a);
        byTeacher.set(a.teacherId, list);
      }
      for (const [teacherId, rows] of byTeacher) {
        await tx.teacherAySnapshot.upsert({
          where: { academicYearId_teacherId: { academicYearId: source.id, teacherId } },
          create: {
            academicYearId: source.id,
            teacherId,
            assignments: rows,
            firstAssignedAt: rows[0]?.validFrom ?? rows[0]?.createdAt,
            lastAssignedAt: rows[rows.length - 1]?.validTo ?? rows[rows.length - 1]?.createdAt,
          },
          update: {
            assignments: rows,
            firstAssignedAt: rows[0]?.validFrom ?? rows[0]?.createdAt,
            lastAssignedAt: rows[rows.length - 1]?.validTo ?? rows[rows.length - 1]?.createdAt,
          },
        });
      }

      return tx.batchPromotionRun.update({
        where: { id: run.id },
        data: { phase: 'SNAPSHOT_DONE', snapshotId: snapshot.id },
        include: { snapshot: true, sourceAy: { include: { calendar: true } }, targetAy: { include: { calendar: true } } },
      });
    });
  }

  async applyCarry(runId: string, branchId: string) {
    const run = await this.getRun(runId, branchId);
    if (run.phase !== 'SNAPSHOT_DONE') {
      throw { status: 400, message: 'Create a snapshot before applying carry options' };
    }

    const carry = mergeCarryOptions(run.carryOptions as Partial<CarryOptions>);
    if (carry.students && !carry.classes) {
      throw { status: 400, message: 'Cannot carry students without carrying classes.' };
    }
    if (carry.teacherAssignments && (!carry.classes || !carry.subjects)) {
      throw { status: 400, message: 'Teacher assignments require both classes and subjects carry options.' };
    }
    if (carry.timetableGrid && (!carry.classes || !carry.subjects)) {
      throw { status: 400, message: 'Timetable requires both classes and subjects carry options.' };
    }
    const sourceId = run.sourceAcademicYearId;
    const targetId = run.targetAcademicYearId;

    await prisma.$transaction(async (tx) => {
      await tx.student.deleteMany({ where: { academicYearId: targetId } });
      await tx.group.deleteMany({ where: { academicYearId: targetId } });
      await tx.subject.deleteMany({ where: { academicYearId: targetId } });
      await tx.feeStructure.deleteMany({ where: { academicYearId: targetId } });
      await tx.teacherAssignment.deleteMany({ where: { academicYearId: targetId } });

      const sourceGroups = await tx.group.findMany({
        where: { academicYearId: sourceId, isActive: true },
        orderBy: { displayOrder: 'asc' },
      });
      if (!sourceGroups.length) throw { status: 400, message: 'Source year has no groups' };

      const groupIdMap = new Map<string, string>();
      if (carry.classes) {
        for (const g of sourceGroups) {
          const created = await tx.group.create({
            data: {
              academicYearId: targetId,
              name: g.name,
              section: g.section,
              displayOrder: g.displayOrder,
              capacity: g.capacity,
              onlyAdminCanSend: g.onlyAdminCanSend,
              isActive: g.isActive,
            },
          });
          groupIdMap.set(g.id, created.id);
        }
      }

      const subjectIdMap = new Map<string, string>();
      if (carry.subjects) {
        const subjects = await tx.subject.findMany({ where: { academicYearId: sourceId } });
        for (const s of subjects) {
          const created = await tx.subject.create({
            data: {
              academicYearId: targetId,
              name: s.name,
              code: s.code,
              description: s.description,
              totalMarks: s.totalMarks,
              passingMarks: s.passingMarks,
              isElective: s.isElective,
              hodId: s.hodId,
            },
          });
          subjectIdMap.set(s.id, created.id);
        }
        if (carry.classes) {
          const links = await tx.groupSubject.findMany({
            where: { group: { academicYearId: sourceId } },
            include: { group: true },
          });
          for (const link of links) {
            const newGroupId = groupIdMap.get(link.groupId);
            const newSubjectId = subjectIdMap.get(link.subjectId);
            if (newGroupId && newSubjectId) {
              await tx.groupSubject.create({
                data: { groupId: newGroupId, subjectId: newSubjectId },
              });
            }
          }
        }
      }

      const maxOrder = Math.max(...sourceGroups.map((g) => g.displayOrder));
      const orderToTargetGroup = new Map<number, string>();
      for (const g of sourceGroups) {
        const targetGroupId = groupIdMap.get(g.id);
        if (targetGroupId) orderToTargetGroup.set(g.displayOrder, targetGroupId);
      }

      if (carry.students && carry.classes) {
        const students = await tx.student.findMany({
          where: { academicYearId: sourceId, status: { in: PROMOTABLE_STATUSES }, isActive: true },
          include: { group: true, person: true },
        });

        for (const s of students) {
          if (!s.group) continue;
          if (s.group.displayOrder >= maxOrder) {
            await tx.student.update({
              where: { id: s.id },
              data: { status: 'GRADUATED', isActive: false, credentialTag: 'NO_LOGIN' },
            });
            continue;
          }

          const nextOrder = s.group.displayOrder + 1;
          const targetGroupId = orderToTargetGroup.get(nextOrder);
          if (!targetGroupId) continue;

          let personId = s.personId;
          if (!personId) {
            const person = await tx.studentPerson.create({
              data: {
                branchId,
                userId: s.userId,
                admissionNumber: s.admissionNumber,
                name: s.name,
              },
            });
            personId = person.id;
            await tx.student.update({ where: { id: s.id }, data: { personId } });
          }

          const credTag: StudentCredentialTag = s.credentialSentAt ? 'CRED_CARRIED' : 'CRED_NEW';

          await tx.student.create({
            data: {
              personId,
              academicYearId: targetId,
              groupId: targetGroupId,
              familyId: s.familyId,
              name: s.name,
              rollNumber: s.rollNumber,
              // Identity-level uniques stay on StudentPerson; keep year-row clean to avoid collisions.
              admissionNumber: null,
              dateOfBirth: s.dateOfBirth,
              gender: s.gender,
              religion: s.religion,
              nationality: s.nationality,
              customFeeAmount: s.customFeeAmount,
              concessionReason: s.concessionReason,
              feeOverrides: s.feeOverrides ?? undefined,
              address: s.address,
              phone: s.phone,
              bloodGroup: s.bloodGroup,
              bformCnic: s.bformCnic,
              motherTongue: s.motherTongue,
              studentEmail: s.studentEmail,
              studentWhatsapp: s.studentWhatsapp,
              city: s.city,
              postalCode: s.postalCode,
              country: s.country,
              previousSchool: s.previousSchool,
              previousClass: s.previousClass,
              tcNumber: s.tcNumber,
              referredBy: s.referredBy,
              profilePhotoId: null,
              userId: null,
              username: s.username,
              studentNumber: null,
              status: 'ACTIVE',
              isActive: true,
              credentialTag: credTag,
              credentialStatus: s.credentialStatus,
              credentialSentAt: s.credentialSentAt,
              credentialGeneratedAt: s.credentialGeneratedAt,
              credentialDeliveredAt: s.credentialDeliveredAt,
              credentialSeenAt: s.credentialSeenAt,
              passwordSetAt: s.passwordSetAt,
            },
          });
        }
      }

      if (carry.teacherAssignments && carry.classes && carry.subjects) {
        const assignments = await tx.teacherAssignment.findMany({
          where: { academicYearId: sourceId, validTo: null },
        });
        for (const a of assignments) {
          const newGroupId = groupIdMap.get(a.groupId);
          const newSubjectId = subjectIdMap.get(a.subjectId);
          if (!newGroupId || !newSubjectId) continue;
          await tx.teacherAssignment.create({
            data: {
              academicYearId: targetId,
              teacherId: a.teacherId,
              groupId: newGroupId,
              subjectId: newSubjectId,
              isClassTeacher: a.isClassTeacher,
              role: a.role,
              validFrom: new Date(),
            },
          });
        }
      }

      if (carry.feeStructures && carry.classes) {
        const structures = await tx.feeStructure.findMany({ where: { academicYearId: sourceId } });
        for (const fs of structures) {
          const newGroupId = groupIdMap.get(fs.groupId);
          if (!newGroupId) continue;
          await tx.feeStructure.create({
            data: {
              academicYearId: targetId,
              groupId: newGroupId,
              feeHeadId: fs.feeHeadId,
              amount: fs.amount,
              effectiveFrom: new Date(),
            },
          });
        }
      }

      if (carry.timetableGrid && carry.classes && carry.subjects) {
        const sourceTimetables = await tx.timetable.findMany({
          where: { academicYearId: sourceId, type: 'timetable' },
          include: { slots: { include: { entries: true } } },
        });
        for (const tt of sourceTimetables) {
          const newTt = await tx.timetable.create({
            data: {
              academicYearId: targetId,
              name: tt.name,
              type: tt.type,
              isActive: tt.isActive,
            },
          });
          const slotMap = new Map<string, string>();
          for (const slot of tt.slots) {
            const createdSlot = await tx.timetableSlot.create({
              data: {
                timetableId: newTt.id,
                dayOfWeek: slot.dayOfWeek,
                lectureNumber: slot.lectureNumber,
                startTime: slot.startTime,
                endTime: slot.endTime,
                isActive: slot.isActive,
              },
            });
            slotMap.set(slot.id, createdSlot.id);
          }
          for (const slot of tt.slots) {
            for (const entry of slot.entries) {
              const newGroupId = groupIdMap.get(entry.groupId);
              const newSubjectId = entry.subjectId ? subjectIdMap.get(entry.subjectId) : null;
              const newSlotId = slotMap.get(slot.id);
              if (!newGroupId || !newSlotId) continue;
              await tx.timetableEntry.create({
                data: {
                  slotId: newSlotId,
                  groupId: newGroupId,
                  subjectId: newSubjectId,
                  teacherId: entry.teacherId,
                  note: entry.note,
                },
              });
            }
          }
        }
      }

      await tx.batchPromotionRun.update({
        where: { id: run.id },
        data: { phase: 'APPLIED' },
      });
    });

    return this.getRun(runId, branchId);
  }

  async publish(runId: string, branchId: string) {
    const run = await this.getRun(runId, branchId);
    if (run.phase !== 'APPLIED') {
      throw { status: 400, message: 'Apply carry options before publishing' };
    }

    await prisma.$transaction(async (tx) => {
      await tx.academicYear.update({
        where: { id: run.sourceAcademicYearId },
        data: { status: 'ARCHIVED' },
      });
      await tx.academicYear.update({
        where: { id: run.targetAcademicYearId },
        data: { status: 'ACTIVE' },
      });
      if (run.snapshotId) {
        await tx.academicYearSnapshot.update({
          where: { id: run.snapshotId },
          data: { status: 'COMPLETED' },
        });
      }
      await tx.batchPromotionRun.update({
        where: { id: run.id },
        data: { phase: 'PUBLISHED', publishedAt: new Date() },
      });
    });

    return this.getRun(runId, branchId);
  }

  async listRuns(branchId: string) {
    return prisma.batchPromotionRun.findMany({
      where: { branchId },
      orderBy: { createdAt: 'desc' },
      include: {
        sourceAy: { include: { calendar: true } },
        targetAy: { include: { calendar: true } },
      },
    });
  }
}

export const batchPromotionService = new BatchPromotionService();
