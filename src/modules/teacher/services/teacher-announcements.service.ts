import type { TeacherContext } from './teacher-context.service';
import { listChatAnnouncementFeed } from '../../chat/services/chat-announcement-feed.service';

/** Teachers see school-wide, staff-only, and class-targeted announcements (read-only). */
export async function listTeacherAnnouncements(ctx: TeacherContext) {
  return listChatAnnouncementFeed({
    academicYearId: ctx.academicYearId,
    branchId: ctx.branchId,
    roomKinds: ['school_announcement', 'teacher_announcement', 'class_announcement'],
    classGroupIds: ctx.assignmentGroupIds,
  });
}
