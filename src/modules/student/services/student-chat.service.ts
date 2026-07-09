import type { StudentContext } from './student-context.service';
import {
  ensureStudentChatBootstrap,
  groupRoomsForStudentLanding,
} from '../../chat/services/chat-community.bootstrap';
import { listRoomsForUser } from '../../chat/services/chat-access.service';

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
  return {
    sections: groupRoomsForStudentLanding(rooms),
    rooms,
  };
}
