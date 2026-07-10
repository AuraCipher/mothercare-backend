import type { PermissionLevel } from './teacher-permissions.types';

export interface PermissionFieldDef {
  key: string;
  label: string;
  description: string;
  kind: 'access' | 'view' | 'write' | 'scope';
  /** When false, hide unless teacher is HOD */
  hodOnly?: boolean;
  /** Branch flag key used when level is inherit (write fields) */
  branchInheritKey?: 'teachersCanMarkAttendance' | 'teachersCanEnterMarks' | 'teacherParentContactEnabled';
}

export interface PermissionGroupDef {
  id: keyof import('./teacher-permissions.types').TeacherPortalPermissionsStored;
  label: string;
  description: string;
  parent?: boolean;
  hodOnly?: boolean;
  fields: PermissionFieldDef[];
}

/** Full catalog for admin UI and documentation. */
export const TEACHER_PERMISSION_CATALOG: PermissionGroupDef[] = [
  {
    id: 'classes',
    label: 'My classes',
    description: 'Class list, class hubs, and navigation to subjects',
    parent: true,
    fields: [{ key: 'access', label: 'Section access', description: 'Open My Classes area', kind: 'access' }],
  },
  {
    id: 'roster',
    label: 'Student roster',
    description: 'View student names and roll numbers in assigned classes',
    fields: [{ key: 'access', label: 'View roster', description: 'See student lists', kind: 'view' }],
  },
  {
    id: 'timetable',
    label: 'Timetable',
    description: 'Personal weekly teaching schedule',
    parent: true,
    fields: [{ key: 'access', label: 'View timetable', description: 'Open timetable page', kind: 'view' }],
  },
  {
    id: 'attendance',
    label: 'Attendance',
    description: 'Daily class attendance',
    parent: true,
    fields: [
      { key: 'access', label: 'Section access', description: 'Open attendance area', kind: 'access' },
      { key: 'view', label: 'View attendance', description: 'See attendance records', kind: 'view' },
      {
        key: 'mark',
        label: 'Mark attendance',
        description: 'Save attendance for today',
        kind: 'write',
        branchInheritKey: 'teachersCanMarkAttendance',
      },
    ],
  },
  {
    id: 'marks',
    label: 'Marks',
    description: 'Exam marks for assigned subjects',
    parent: true,
    fields: [
      { key: 'access', label: 'Section access', description: 'Open marks area', kind: 'access' },
      { key: 'view', label: 'View marks', description: 'See marks grids', kind: 'view' },
      {
        key: 'enter',
        label: 'Enter marks',
        description: 'Save marks when exam allows',
        kind: 'write',
        branchInheritKey: 'teachersCanEnterMarks',
      },
    ],
  },
  {
    id: 'hod',
    label: 'HOD department',
    description: 'Head-of-department marks across all classes in your subjects',
    parent: true,
    hodOnly: true,
    fields: [
      { key: 'access', label: 'Section access', description: 'Open HOD department area', kind: 'access', hodOnly: true },
      { key: 'view', label: 'View department marks', description: 'See all department exam sheets', kind: 'view', hodOnly: true },
      {
        key: 'enter',
        label: 'Enter department marks',
        description: 'Edit marks for HOD subjects',
        kind: 'write',
        branchInheritKey: 'teachersCanEnterMarks',
        hodOnly: true,
      },
    ],
  },
  {
    id: 'announcements',
    label: 'Announcements',
    description: 'School-wide and class announcements (read-only)',
    parent: true,
    fields: [{ key: 'access', label: 'View announcements', description: 'Read school notices', kind: 'view' }],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    description: 'In-app alerts and messages',
    parent: true,
    fields: [
      { key: 'access', label: 'Section access', description: 'Open notifications', kind: 'access' },
      { key: 'markRead', label: 'Mark as read', description: 'Dismiss notifications', kind: 'write' },
    ],
  },
  {
    id: 'app',
    label: 'Mobile app chat',
    description: 'Flutter chat — channel access and posting (works with branch appointments & class roles)',
    parent: true,
    fields: [
      { key: 'access', label: 'Open mobile chat', description: 'Use the chat section in the Flutter app', kind: 'access' },
      {
        key: 'schoolAnnouncementPost',
        label: 'Post — School Announcement',
        description: 'Post in whole-school channel (also requires branch appointment)',
        kind: 'write',
      },
      {
        key: 'teachersAnnouncementPost',
        label: 'Post — Teachers Announcement',
        description: 'Post in staff broadcast channel (also requires branch appointment or allow-all)',
        kind: 'write',
      },
      {
        key: 'classAnnouncementPost',
        label: 'Post — Class Announcement',
        description: 'Post in class announcement channel (also requires class teacher role)',
        kind: 'write',
      },
      {
        key: 'subjectGroupPost',
        label: 'Post — Subject groups',
        description: 'Post in subject group chats (also requires subject assignment)',
        kind: 'write',
      },
      {
        key: 'directMessages',
        label: 'Direct messages',
        description: 'Send and participate in staff DMs',
        kind: 'write',
      },
      {
        key: 'attachments',
        label: 'Send photos, video, voice',
        description: 'Upload media in chat rooms where posting is allowed',
        kind: 'write',
      },
    ],
  },
  {
    id: 'profile',
    label: 'Profile',
    description: 'Own profile and account',
    parent: true,
    fields: [
      { key: 'access', label: 'View profile', description: 'Open profile page', kind: 'view' },
      { key: 'changePassword', label: 'Change password', description: 'Update login password', kind: 'write' },
    ],
  },
  {
    id: 'parentContact',
    label: 'Parent contacts',
    description: 'Parent phone numbers on class rosters (sensitive)',
    parent: true,
    fields: [
      { key: 'access', label: 'Feature access', description: 'Parent contact feature', kind: 'access' },
      {
        key: 'view',
        label: 'View phone numbers',
        description: 'Show parent phones on roster',
        kind: 'view',
        branchInheritKey: 'teacherParentContactEnabled',
      },
    ],
  },
];

export const GLOBAL_PORTAL_MODES = [
  {
    value: 'FULL' as const,
    label: 'Full access',
    description: 'Read and write (subject to feature permissions below)',
  },
  {
    value: 'READ_ONLY' as const,
    label: 'Read only',
    description: 'View permitted features; all writes blocked',
  },
  {
    value: 'FROZEN' as const,
    label: 'Frozen',
    description: 'Login only — portal data blocked',
  },
];

export const PERMISSION_LEVEL_OPTIONS: { value: PermissionLevel; label: string }[] = [
  { value: 'inherit', label: 'Inherit / default' },
  { value: 'allow', label: 'Allow' },
  { value: 'deny', label: 'Deny' },
];

export const HOD_SCOPE_OPTIONS = [
  { value: 'ASSIGNED_ONLY' as const, label: 'Assigned classes only' },
  { value: 'DEPARTMENT_ALL' as const, label: 'All classes in HOD department' },
];
