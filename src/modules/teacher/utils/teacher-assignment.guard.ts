import type { TeacherContext } from '../services/teacher-context.service';
import type { Request } from 'express';

export class TeacherAccessError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Teacher has an assignment for this group (any subject). */
export function assertTeacherAssignedToGroup(ctx: TeacherContext, groupId: string): void {
  if (!ctx.assignmentGroupIds.includes(groupId)) {
    throw new TeacherAccessError(403, 'Access denied: you are not assigned to this class');
  }
}

/** Teacher has assignment for exact group + subject. */
export function assertTeacherAssignedToSubject(
  ctx: TeacherContext,
  groupId: string,
  subjectId: string,
): void {
  const ok = ctx.assignments.some(
    (a) => a.groupId === groupId && a.subjectId === subjectId,
  );
  if (!ok) {
    throw new TeacherAccessError(403, 'Access denied: you are not assigned to this subject');
  }
}

/** Teacher owns this assignment row. */
export function assertTeacherOwnsAssignment(ctx: TeacherContext, assignmentId: string): void {
  if (!ctx.assignments.some((a) => a.id === assignmentId)) {
    throw new TeacherAccessError(403, 'Access denied: assignment not found');
  }
}

/** Class teacher for homeroom-only resources. */
export function assertClassTeacher(ctx: TeacherContext, groupId: string): void {
  if (!ctx.classTeacherGroupIds.includes(groupId)) {
    throw new TeacherAccessError(403, 'Access denied: class teacher only');
  }
}

export function getTeacherContext(req: Request): TeacherContext {
  const ctx = (req as any).teacherContext as TeacherContext | undefined;
  if (!ctx) {
    throw new TeacherAccessError(500, 'Teacher context not initialized');
  }
  return ctx;
}
