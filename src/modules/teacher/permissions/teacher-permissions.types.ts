/**
 * Teacher portal permission model.
 * Levels: inherit (default) | allow | deny
 * Parent deny blocks entire feature; sub-permissions refine within allowed parents.
 */

export type PermissionLevel = 'inherit' | 'allow' | 'deny';

export type HodParentContactScope = 'ASSIGNED_ONLY' | 'DEPARTMENT_ALL';

export interface TeacherPortalPermissionsStored {
  classes?: { access?: PermissionLevel };
  roster?: { access?: PermissionLevel };
  timetable?: { access?: PermissionLevel };
  attendance?: { access?: PermissionLevel; view?: PermissionLevel; mark?: PermissionLevel };
  marks?: { access?: PermissionLevel; view?: PermissionLevel; enter?: PermissionLevel };
  hod?: { access?: PermissionLevel; view?: PermissionLevel; enter?: PermissionLevel };
  announcements?: { access?: PermissionLevel };
  notifications?: { access?: PermissionLevel; markRead?: PermissionLevel };
  profile?: { access?: PermissionLevel; changePassword?: PermissionLevel };
  parentContact?: {
    access?: PermissionLevel;
    view?: PermissionLevel;
    hodScope?: HodParentContactScope;
  };
  app?: {
    access?: PermissionLevel;
    schoolAnnouncementPost?: PermissionLevel;
    teachersAnnouncementPost?: PermissionLevel;
    classAnnouncementPost?: PermissionLevel;
    subjectGroupPost?: PermissionLevel;
    directMessages?: PermissionLevel;
    attachments?: PermissionLevel;
  };
}

export interface FeatureAccess {
  allowed: boolean;
  reason?: string;
}

export interface AttendancePermissions extends FeatureAccess {
  canView: boolean;
  canMark: boolean;
}

export interface MarksPermissions extends FeatureAccess {
  canView: boolean;
  canEnter: boolean;
}

export interface HodPermissions extends FeatureAccess {
  canView: boolean;
  canEnter: boolean;
}

export interface NotificationsPermissions extends FeatureAccess {
  canMarkRead: boolean;
}

export interface ProfilePermissions extends FeatureAccess {
  canChangePassword: boolean;
}

export interface ParentContactPermissions extends FeatureAccess {
  canView: boolean;
  hodScope: HodParentContactScope;
}

export interface AppChatPermissions extends FeatureAccess {
  canSchoolAnnouncementPost: boolean;
  canTeachersAnnouncementPost: boolean;
  canClassAnnouncementPost: boolean;
  canSubjectGroupPost: boolean;
  canDirectMessages: boolean;
  canAttachments: boolean;
}

export interface ResolvedTeacherPermissions {
  portalAccess: 'FULL' | 'READ_ONLY' | 'FROZEN';
  isFrozen: boolean;
  isReadOnly: boolean;
  features: {
    classes: FeatureAccess;
    roster: FeatureAccess;
    timetable: FeatureAccess;
    attendance: AttendancePermissions;
    marks: MarksPermissions;
    hod: HodPermissions;
    announcements: FeatureAccess;
    notifications: NotificationsPermissions;
    profile: ProfilePermissions;
    parentContact: ParentContactPermissions;
    app: AppChatPermissions;
  };
}

export interface PermissionResolveInput {
  portalAccess: 'FULL' | 'READ_ONLY' | 'FROZEN';
  isReadOnly: boolean;
  isHod: boolean;
  stored: TeacherPortalPermissionsStored | null;
  legacy: {
    canViewParentContact: boolean;
    hodParentContactScope: HodParentContactScope;
  };
  branch: {
    teacherParentContactEnabled: boolean;
    teachersCanMarkAttendance: boolean;
    teachersCanEnterMarks: boolean;
  };
}
