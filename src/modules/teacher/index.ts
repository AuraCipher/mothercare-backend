export { default as teacherPortalRouter } from './routes/teacher.routes';
export type { TeacherContext } from './services/teacher-context.service';
export {
  assertTeacherAssignedToGroup,
  assertTeacherAssignedToSubject,
  assertTeacherOwnsAssignment,
  assertClassTeacher,
  TeacherAccessError,
} from './utils/teacher-assignment.guard';
