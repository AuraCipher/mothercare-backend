import type { StudentContext } from './student-context.service';
import { listChatAnnouncementFeed } from '../../chat/services/chat-announcement-feed.service';

/** School-wide + class-targeted announcements for the student's group (read-only). */
export async function listStudentAnnouncements(ctx: StudentContext) {
  return listChatAnnouncementFeed({
    academicYearId: ctx.academicYearId,
    branchId: ctx.branchId,
    roomKinds: ['school_announcement', 'class_announcement'],
    classGroupIds: ctx.groupId ? [ctx.groupId] : [],
  });
}
