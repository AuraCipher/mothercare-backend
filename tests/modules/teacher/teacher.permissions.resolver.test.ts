import {
  resolveTeacherPermissions,
  normalizeStoredPermissions,
} from '../../../src/modules/teacher/permissions/teacher-permissions.resolver';

const branchDefaults = {
  teacherParentContactEnabled: true,
  teachersCanMarkAttendance: true,
  teachersCanEnterMarks: true,
};

describe('teacher permissions resolver', () => {
  test('frozen blocks all features', () => {
    const p = resolveTeacherPermissions({
      portalAccess: 'FROZEN',
      isReadOnly: true,
      isHod: true,
      stored: {},
      legacy: { canViewParentContact: true, hodParentContactScope: 'DEPARTMENT_ALL' },
      branch: branchDefaults,
    });
    expect(p.isFrozen).toBe(true);
    expect(p.features.marks.allowed).toBe(false);
    expect(p.features.hod.allowed).toBe(false);
  });

  test('deny marks parent blocks marks view', () => {
    const p = resolveTeacherPermissions({
      portalAccess: 'FULL',
      isReadOnly: false,
      isHod: false,
      stored: { marks: { access: 'deny' } },
      legacy: { canViewParentContact: false, hodParentContactScope: 'ASSIGNED_ONLY' },
      branch: branchDefaults,
    });
    expect(p.features.marks.allowed).toBe(false);
    expect(p.features.marks.canView).toBe(false);
  });

  test('sub-feature deny mark still allows view', () => {
    const p = resolveTeacherPermissions({
      portalAccess: 'FULL',
      isReadOnly: false,
      isHod: false,
      stored: { attendance: { mark: 'deny' } },
      legacy: { canViewParentContact: false, hodParentContactScope: 'ASSIGNED_ONLY' },
      branch: branchDefaults,
    });
    expect(p.features.attendance.canView).toBe(true);
    expect(p.features.attendance.canMark).toBe(false);
  });

  test('read only portal blocks writes', () => {
    const p = resolveTeacherPermissions({
      portalAccess: 'READ_ONLY',
      isReadOnly: true,
      isHod: false,
      stored: { attendance: { mark: 'allow' }, marks: { enter: 'allow' } },
      legacy: { canViewParentContact: false, hodParentContactScope: 'ASSIGNED_ONLY' },
      branch: branchDefaults,
    });
    expect(p.features.attendance.canMark).toBe(false);
    expect(p.features.marks.canEnter).toBe(false);
  });

  test('parent contact allow requires branch', () => {
    const stored = normalizeStoredPermissions(
      { parentContact: { view: 'allow' } },
      { canViewParentContact: false, hodParentContactScope: 'ASSIGNED_ONLY' },
    );
    const p = resolveTeacherPermissions({
      portalAccess: 'FULL',
      isReadOnly: false,
      isHod: false,
      stored,
      legacy: { canViewParentContact: false, hodParentContactScope: 'ASSIGNED_ONLY' },
      branch: { ...branchDefaults, teacherParentContactEnabled: false },
    });
    expect(p.features.parentContact.canView).toBe(false);
  });

  test('app chat defaults allow posting sub-features when inherit', () => {
    const p = resolveTeacherPermissions({
      portalAccess: 'FULL',
      isReadOnly: false,
      isHod: false,
      stored: {},
      legacy: { canViewParentContact: false, hodParentContactScope: 'ASSIGNED_ONLY' },
      branch: branchDefaults,
    });
    expect(p.features.app.allowed).toBe(true);
    expect(p.features.app.canSchoolAnnouncementPost).toBe(true);
    expect(p.features.app.canAttachments).toBe(true);
  });

  test('app school post deny blocks school channel write', () => {
    const p = resolveTeacherPermissions({
      portalAccess: 'FULL',
      isReadOnly: false,
      isHod: false,
      stored: { app: { schoolAnnouncementPost: 'deny' } },
      legacy: { canViewParentContact: false, hodParentContactScope: 'ASSIGNED_ONLY' },
      branch: branchDefaults,
    });
    expect(p.features.app.allowed).toBe(true);
    expect(p.features.app.canSchoolAnnouncementPost).toBe(false);
    expect(p.features.app.canSubjectGroupPost).toBe(true);
  });

  test('app access deny blocks all mobile chat posting', () => {
    const p = resolveTeacherPermissions({
      portalAccess: 'FULL',
      isReadOnly: false,
      isHod: false,
      stored: { app: { access: 'deny' } },
      legacy: { canViewParentContact: false, hodParentContactScope: 'ASSIGNED_ONLY' },
      branch: branchDefaults,
    });
    expect(p.features.app.allowed).toBe(false);
    expect(p.features.app.canAttachments).toBe(false);
  });
});
