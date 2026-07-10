import type { StudentContext } from './student-context.service';
import {
  ensureStudentChatBootstrap,
  groupRoomsForStudentLanding,
} from '../../chat/services/chat-community.bootstrap';
import { listRoomsForUser } from '../../chat/services/chat-access.service';
import { ensureDirectMessageRoom } from '../../chat/services/chat-dm.service';
import { listStudentDmContacts } from '../../chat/services/chat-dm-policy.service';

export async function getStudentChatLanding(ctx: StudentContext) {
  if (!ctx.groupId) {
    throw { status: 400, message: 'Student is not assigned to a class group' };
  }

  await ensureStudentChatBootstrap({
    userId: ctx.userId,
    studentId: ctx.studentId,
    groupId: ctx.groupId,
    groupLabel: ctx.groupLabel || '',
    academicYearId: ctx.academicYearId,
    branchId: ctx.branchId,
    studentName: ctx.studentName,
  });

  const rooms = await listRoomsForUser(ctx.userId, ctx.academicYearId);
  const contacts = await listStudentDmContacts({
    userId: ctx.userId,
    groupId: ctx.groupId,
    academicYearId: ctx.academicYearId,
  });

  const sections = groupRoomsForStudentLanding(rooms);
  if (contacts.length > 0) {
    sections.push({
      key: 'contacts',
      title: 'Contacts',
      rooms: [],
      contacts,
    });
  }

  return {
    sections,
    rooms,
    contacts,
  };
}

export async function openStudentDirectMessage(
  ctx: StudentContext,
  participantUserId: string,
) {
  const room = await ensureDirectMessageRoom({
    academicYearId: ctx.academicYearId,
    branchId: ctx.branchId,
    userId: ctx.userId,
    participantUserId,
  });
  return { roomId: room.id, name: room.name };
}
