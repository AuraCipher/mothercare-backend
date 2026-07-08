import type {
  FeatureAccess,
  PermissionLevel,
  PermissionResolveInput,
  ResolvedTeacherPermissions,
  TeacherPortalPermissionsStored,
} from './teacher-permissions.types';

function resolveLevel(
  level: PermissionLevel | undefined,
  opts: {
    defaultAllow: boolean;
    branchDefault?: boolean;
    isWrite?: boolean;
    readOnlyPortal?: boolean;
  },
): boolean {
  if (level === 'deny') return false;
  if (level === 'allow') {
    if (opts.isWrite && opts.readOnlyPortal) return false;
    return true;
  }
  // inherit
  if (opts.isWrite && opts.readOnlyPortal) return false;
  if (opts.branchDefault !== undefined) return opts.branchDefault;
  return opts.defaultAllow;
}

function feature(
  allowed: boolean,
  reason?: string,
): FeatureAccess {
  return allowed ? { allowed: true } : { allowed: false, reason };
}

function parentAllowed(
  stored: TeacherPortalPermissionsStored,
  group: keyof TeacherPortalPermissionsStored,
  frozen: boolean,
): boolean {
  if (frozen) return false;
  const access = stored[group]?.access;
  if (access === 'deny') return false;
  return true;
}

function childAllowed(
  parentOk: boolean,
  level: PermissionLevel | undefined,
  opts: Parameters<typeof resolveLevel>[1],
): boolean {
  if (!parentOk) return false;
  return resolveLevel(level, opts);
}

export function normalizeStoredPermissions(
  raw: unknown,
  legacy: PermissionResolveInput['legacy'],
): TeacherPortalPermissionsStored {
  const stored: TeacherPortalPermissionsStored =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as TeacherPortalPermissionsStored)
      : {};

  if (!stored.parentContact) stored.parentContact = {};
  if (stored.parentContact.view === undefined && legacy.canViewParentContact) {
    stored.parentContact.view = 'allow';
  }
  if (!stored.parentContact.hodScope) {
    stored.parentContact.hodScope = legacy.hodParentContactScope;
  }

  return stored;
}

export function resolveTeacherPermissions(input: PermissionResolveInput): ResolvedTeacherPermissions {
  const frozen = input.portalAccess === 'FROZEN';
  const readOnlyPortal = input.isReadOnly || input.portalAccess === 'READ_ONLY';
  const stored = normalizeStoredPermissions(input.stored, input.legacy);

  const classesParent = parentAllowed(stored, 'classes', frozen);
  const attendanceParent = parentAllowed(stored, 'attendance', frozen);
  const marksParent = parentAllowed(stored, 'marks', frozen);
  const hodParent = input.isHod && parentAllowed(stored, 'hod', frozen);
  const notificationsParent = parentAllowed(stored, 'notifications', frozen);
  const profileParent = parentAllowed(stored, 'profile', frozen);
  const parentContactParent = parentAllowed(stored, 'parentContact', frozen);

  const classes = feature(
    childAllowed(classesParent, stored.classes?.access, { defaultAllow: true }),
    frozen ? 'Portal frozen' : stored.classes?.access === 'deny' ? 'Classes access denied' : undefined,
  );

  const roster = feature(
    childAllowed(classesParent, stored.roster?.access ?? stored.classes?.access, { defaultAllow: true }),
    !classesParent ? 'Classes access denied' : undefined,
  );

  const timetable = feature(
    childAllowed(parentAllowed(stored, 'timetable', frozen), stored.timetable?.access, {
      defaultAllow: true,
    }),
  );

  const attendanceView = childAllowed(attendanceParent, stored.attendance?.view, { defaultAllow: true });
  const attendanceMark = childAllowed(
    attendanceParent && attendanceView,
    stored.attendance?.mark,
    {
      defaultAllow: true,
      branchDefault: input.branch.teachersCanMarkAttendance,
      isWrite: true,
      readOnlyPortal,
    },
  );

  const marksView = childAllowed(marksParent, stored.marks?.view, { defaultAllow: true });
  const marksEnter = childAllowed(marksParent && marksView, stored.marks?.enter, {
    defaultAllow: true,
    branchDefault: input.branch.teachersCanEnterMarks,
    isWrite: true,
    readOnlyPortal,
  });

  const hodView = childAllowed(hodParent, stored.hod?.view, { defaultAllow: true });
  const hodEnter = childAllowed(hodParent && hodView, stored.hod?.enter, {
    defaultAllow: true,
    branchDefault: input.branch.teachersCanEnterMarks,
    isWrite: true,
    readOnlyPortal,
  });

  const parentContactView = childAllowed(
    parentContactParent,
    stored.parentContact?.view ??
      (input.legacy.canViewParentContact ? 'allow' : undefined),
    {
      defaultAllow: false,
      branchDefault: input.branch.teacherParentContactEnabled,
    },
  );

  return {
    portalAccess: input.portalAccess,
    isFrozen: frozen,
    isReadOnly: readOnlyPortal,
    features: {
      classes,
      roster,
      timetable,
      attendance: {
        allowed: attendanceParent && attendanceView,
        canView: attendanceView,
        canMark: attendanceMark,
        reason: !attendanceParent
          ? 'Attendance access denied'
          : !attendanceView
            ? 'Attendance view denied'
            : undefined,
      },
      marks: {
        allowed: marksParent && marksView,
        canView: marksView,
        canEnter: marksEnter,
        reason: !marksParent ? 'Marks access denied' : !marksView ? 'Marks view denied' : undefined,
      },
      hod: {
        allowed: hodParent && hodView,
        canView: hodView,
        canEnter: hodEnter,
        reason: !input.isHod
          ? 'Not a department head'
          : !hodParent
            ? 'HOD access denied'
            : undefined,
      },
      announcements: feature(
        childAllowed(parentAllowed(stored, 'announcements', frozen), stored.announcements?.access, {
          defaultAllow: true,
        }),
      ),
      notifications: {
        allowed: notificationsParent,
        canMarkRead: childAllowed(notificationsParent, stored.notifications?.markRead, {
          defaultAllow: true,
          isWrite: true,
          readOnlyPortal,
        }),
        reason: !notificationsParent ? 'Notifications access denied' : undefined,
      },
      profile: {
        allowed: profileParent,
        canChangePassword: childAllowed(profileParent, stored.profile?.changePassword, {
          defaultAllow: true,
          isWrite: true,
          readOnlyPortal,
        }),
        reason: !profileParent ? 'Profile access denied' : undefined,
      },
      parentContact: {
        allowed: parentContactParent && parentContactView,
        canView: parentContactView && input.branch.teacherParentContactEnabled,
        hodScope: stored.parentContact?.hodScope ?? input.legacy.hodParentContactScope,
        reason: !parentContactParent
          ? 'Parent contacts denied'
          : !input.branch.teacherParentContactEnabled
            ? 'Branch parent contacts disabled'
            : undefined,
      },
    },
  };
}

export function syncLegacyFieldsFromPermissions(
  stored: TeacherPortalPermissionsStored,
): { canViewParentContact: boolean; hodParentContactScope: 'ASSIGNED_ONLY' | 'DEPARTMENT_ALL' } {
  return {
    canViewParentContact: stored.parentContact?.view === 'allow',
    hodParentContactScope: stored.parentContact?.hodScope ?? 'ASSIGNED_ONLY',
  };
}
