/**
 * DB-03D: Batch Promotion Transaction / Query Hardening — Regression & performance tests.
 *
 * Verifies that applyCarry uses batched operations (createMany, updateMany)
 * and that query count remains bounded regardless of student count.
 */
import { prismaMock } from '../../mocks/prisma';
import { batchPromotionService } from '../../../src/modules/admin/services/batch-promotion.service';

function mockRun(overrides: Record<string, any> = {}) {
  return {
    id: 'run-1',
    branchId: 'branch-1',
    phase: 'SNAPSHOT_DONE',
    sourceAcademicYearId: 'ay-source',
    targetAcademicYearId: 'ay-target',
    carryOptions: { classes: true, subjects: true, students: true, teacherAssignments: true, timetableGrid: true, feeStructures: true },
    sourceAy: { calendar: { label: '2025-26' } },
    targetAy: { calendar: { label: '2026-27' } },
    snapshotId: null,
    ...overrides,
  };
}

function makeStudents(n: number, displayOrderFn: (i: number) => number = (i) => Math.min(i + 1, 9)) {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i + 1}`,
    name: `Student ${i + 1}`,
    rollNumber: String(i + 1),
    userId: `u${i + 1}`,
    personId: `p${i + 1}`,
    admissionNumber: `adm${i + 1}`,
    status: 'ACTIVE',
    isActive: true,
    credentialSentAt: i % 3 === 0 ? new Date() : null,
    credentialStatus: 'none',
    credentialTag: 'CRED_NONE' as const,
    familyId: `f${i + 1}`,
    dateOfBirth: new Date('2010-01-01'),
    gender: 'MALE' as const,
    customFeeAmount: null,
    concessionReason: null,
    feeOverrides: null,
    address: null,
    phone: null,
    bloodGroup: null,
    bformCnic: null,
    motherTongue: null,
    studentEmail: null,
    studentWhatsapp: null,
    city: null,
    postalCode: null,
    country: null,
    previousSchool: null,
    previousClass: null,
    tcNumber: null,
    referredBy: null,
    username: null,
    religion: null,
    nationality: 'Pakistani',
    profilePhotoId: null,
    studentNumber: null,
    credentialGeneratedAt: null,
    credentialDeliveredAt: null,
    credentialSeenAt: null,
    passwordSetAt: null,
    group: { id: `g${displayOrderFn(i)}`, displayOrder: displayOrderFn(i) },
    person: { id: `p${i + 1}` },
  }));
}

function mockApplyCarryDeps(students: ReturnType<typeof makeStudents>, opts: {
  sourceGroups?: Array<{ id: string; name: string; section: string; displayOrder: number; capacity: number; onlyAdminCanSend: boolean; isActive: boolean }>;
  sourceSubjects?: Array<{ id: string; name: string; code: string; description: string | null; totalMarks: number; passingMarks: number; isElective: boolean; hodId: string | null }>;
  createdGroups?: Array<{ id: string; displayOrder: number }>;
  createdSubjects?: Array<{ id: string; code: string }>;
} = {}) {
  // Mock getRun (called by applyCarry)
  prismaMock.batchPromotionRun.findFirst.mockResolvedValue(mockRun() as any);

  // Mock $queryRaw (used by lockAndValidateRun inside transaction)
  (prismaMock as any).$queryRaw.mockResolvedValue([mockRun()]);

  const sourceGroups = opts.sourceGroups ?? [
    { id: 'g1', name: 'Class 1', section: 'A', displayOrder: 1, capacity: 30, onlyAdminCanSend: true, isActive: true },
    { id: 'g2', name: 'Class 2', section: 'A', displayOrder: 2, capacity: 30, onlyAdminCanSend: true, isActive: true },
    { id: 'g3', name: 'Class 3', section: 'A', displayOrder: 3, capacity: 30, onlyAdminCanSend: true, isActive: true },
  ];
  const sourceSubjects = opts.sourceSubjects ?? [
    { id: 'sub1', name: 'Math', code: 'MATH', description: null, totalMarks: 100, passingMarks: 33, isElective: false, hodId: null },
  ];
  const createdGroups = opts.createdGroups ?? sourceGroups.map((g) => ({ id: `new-${g.id}`, displayOrder: g.displayOrder }));
  const createdSubjects = opts.createdSubjects ?? sourceSubjects.map((s) => ({ id: `new-${s.id}`, code: s.code }));

  // deleteMany calls (5)
  prismaMock.student.deleteMany.mockResolvedValue({ count: students.length } as any);
  prismaMock.group.deleteMany.mockResolvedValue({ count: sourceGroups.length } as any);
  prismaMock.subject.deleteMany.mockResolvedValue({ count: sourceSubjects.length } as any);
  prismaMock.feeStructure.deleteMany.mockResolvedValue({ count: 0 } as any);
  prismaMock.teacherAssignment.deleteMany.mockResolvedValue({ count: 0 } as any);

  // sourceGroups findMany
  prismaMock.group.findMany
    .mockResolvedValueOnce(sourceGroups as any)  // source groups
    .mockResolvedValueOnce(createdGroups as any); // created groups in target

  // subjects
  prismaMock.subject.findMany
    .mockResolvedValueOnce(sourceSubjects as any)  // source subjects
    .mockResolvedValueOnce(createdSubjects as any); // created subjects in target

  // groupSubject
  prismaMock.groupSubject.findMany.mockResolvedValue([]);

  // student findMany
  prismaMock.student.findMany.mockResolvedValue(students as any);

  // updateMany for userId clearing
  prismaMock.student.updateMany.mockResolvedValue({ count: students.length } as any);

  // student.createMany (for new students)
  prismaMock.student.createMany.mockResolvedValue({ count: students.length } as any);

  // student.update for personId (for students without personId)
  prismaMock.student.update.mockResolvedValue({} as any);

  // studentPerson.create (for students without personId)
  (prismaMock.studentPerson.create as jest.Mock).mockImplementation(async (args: any) => ({
    id: `new-person-${Date.now()}`,
    ...args.data,
  }));

  // teacherAssignment
  prismaMock.teacherAssignment.findMany.mockResolvedValue([]);
  prismaMock.teacherAssignment.createMany.mockResolvedValue({ count: 0 } as any);

  // feeStructure
  prismaMock.feeStructure.findMany.mockResolvedValue([]);
  prismaMock.feeStructure.createMany.mockResolvedValue({ count: 0 } as any);

  // timetable
  prismaMock.timetable.findMany.mockResolvedValue([]);
  prismaMock.timetableSlot.findMany.mockResolvedValue([]);
  prismaMock.timetableEntry.createMany.mockResolvedValue({ count: 0 } as any);

  // final update
  prismaMock.batchPromotionRun.update.mockResolvedValue({} as any);

  // $transaction passthrough
  prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
}

function countPrismaCalls(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [name, mock] of Object.entries(prismaMock)) {
    if (mock && typeof mock === 'object' && 'mock' in mock) {
      const calls = (mock as any).mock?.calls?.length ?? 0;
      if (calls > 0) counts.set(name, calls);
    }
  }
  return counts;
}

// ═══════════════════════════════════════════════════════════════════
// QUERY-COUNT REGRESSION TESTS
// ═══════════════════════════════════════════════════════════════════

describe('DB-03D: applyCarry query-count scaling', () => {
  beforeEach(() => jest.clearAllMocks());

  test('10 students: student.findMany called once (not N times)', async () => {
    const students = makeStudents(10);
    mockApplyCarryDeps(students);

    await batchPromotionService.applyCarry('run-1', 'branch-1');

    expect(prismaMock.student.findMany).toHaveBeenCalledTimes(1);
  });

  test('10 students: student.createMany called once (not N times)', async () => {
    const students = makeStudents(10);
    mockApplyCarryDeps(students);

    await batchPromotionService.applyCarry('run-1', 'branch-1');

    expect(prismaMock.student.createMany).toHaveBeenCalledTimes(1);
  });

  test('10 students: student.updateMany called once for userId clearing', async () => {
    const students = makeStudents(10);
    mockApplyCarryDeps(students);

    await batchPromotionService.applyCarry('run-1', 'branch-1');

    // updateMany is called for: userId clearing + graduated batch
    // At minimum, userId clearing must be called
    expect(prismaMock.student.updateMany).toHaveBeenCalled();
    const userIdClearCall = prismaMock.student.updateMany.mock.calls.find(
      (call: any[]) => call[0]?.data?.userId === null,
    );
    expect(userIdClearCall).toBeDefined();
  });

  test('50 students: same query pattern as 10 students', async () => {
    const students = makeStudents(50);
    mockApplyCarryDeps(students);

    await batchPromotionService.applyCarry('run-1', 'branch-1');

    // findMany called once, createMany called once
    expect(prismaMock.student.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.student.createMany).toHaveBeenCalledTimes(1);
  });

  test('100 students: same query pattern', async () => {
    const students = makeStudents(100);
    mockApplyCarryDeps(students);

    await batchPromotionService.applyCarry('run-1', 'branch-1');

    expect(prismaMock.student.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.student.createMany).toHaveBeenCalledTimes(1);
  });

  test('500 students: same query pattern', async () => {
    const students = makeStudents(500);
    mockApplyCarryDeps(students);

    await batchPromotionService.applyCarry('run-1', 'branch-1');

    expect(prismaMock.student.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.student.createMany).toHaveBeenCalledTimes(1);
  });

  test('subject.findMany called once (not per-subject)', async () => {
    const students = makeStudents(5);
    mockApplyCarryDeps(students, {
      sourceSubjects: [
        { id: 'sub1', name: 'Math', code: 'MATH', description: null, totalMarks: 100, passingMarks: 33, isElective: false, hodId: null },
        { id: 'sub2', name: 'English', code: 'ENG', description: null, totalMarks: 100, passingMarks: 33, isElective: false, hodId: null },
        { id: 'sub3', name: 'Science', code: 'SCI', description: null, totalMarks: 100, passingMarks: 33, isElective: false, hodId: null },
      ],
    });

    await batchPromotionService.applyCarry('run-1', 'branch-1');

    // 2 calls: source subjects + created subjects in target
    expect(prismaMock.subject.findMany).toHaveBeenCalledTimes(2);
  });

  test('subject.createMany called once (not per-subject)', async () => {
    const students = makeStudents(5);
    mockApplyCarryDeps(students, {
      sourceSubjects: [
        { id: 'sub1', name: 'Math', code: 'MATH', description: null, totalMarks: 100, passingMarks: 33, isElective: false, hodId: null },
        { id: 'sub2', name: 'English', code: 'ENG', description: null, totalMarks: 100, passingMarks: 33, isElective: false, hodId: null },
      ],
    });

    await batchPromotionService.applyCarry('run-1', 'branch-1');

    expect(prismaMock.subject.createMany).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// RESULT-EQUIVALENCE / BEHAVIORAL TESTS
// ═══════════════════════════════════════════════════════════════════

describe('DB-03D: applyCarry behavioral equivalence', () => {
  beforeEach(() => jest.clearAllMocks());

  test('normal promotion: all students in non-highest groups are promoted', async () => {
    const students = makeStudents(5, (i) => (i < 3 ? 1 : 2)); // 3 in g1, 2 in g2
    mockApplyCarryDeps(students);

    await batchPromotionService.applyCarry('run-1', 'branch-1');

    // createMany should receive 5 students
    const createManyCall = prismaMock.student.createMany.mock.calls[0] as any;
    expect(createManyCall[0].data).toHaveLength(5);
  });

  test('graduated students: highest group students get GRADUATED status', async () => {
    // Students in displayOrder=3 (highest) should be graduated
    const students = makeStudents(6, (i) => (i < 2 ? 1 : i < 4 ? 2 : 3));
    mockApplyCarryDeps(students);

    await batchPromotionService.applyCarry('run-1', 'branch-1');

    // updateMany for graduated should be called with status GRADUATED
    const graduatedCall = prismaMock.student.updateMany.mock.calls.find(
      (call: any[]) => call[0]?.data?.status === 'GRADUATED',
    );
    expect(graduatedCall).toBeDefined();
    expect(graduatedCall![0].data).toEqual({
      status: 'GRADUATED',
      isActive: false,
      credentialTag: 'NO_LOGIN',
    });
  });

  test('promoted students get ACTIVE status and correct target group', async () => {
    // g3 is highest — that student graduates, g1/g2 promote
    const students = makeStudents(3, (i) => i + 1); // g1, g2, g3
    mockApplyCarryDeps(students);

    await batchPromotionService.applyCarry('run-1', 'branch-1');

    const createManyCall = prismaMock.student.createMany.mock.calls[0] as any;
    const created = createManyCall[0].data as any[];
    expect(created).toHaveLength(2); // only g1 and g2 students promoted
    expect(created[0].groupId).toBe('new-g2'); // g1 → g2
    expect(created[0].status).toBe('ACTIVE');
    expect(created[1].groupId).toBe('new-g3'); // g2 → g3
    expect(created[1].status).toBe('ACTIVE');
  });

  test('credentialTag is CRED_CARRIED when credentialSentAt exists', async () => {
    const students = makeStudents(2, () => 1);
    students[0].credentialSentAt = new Date();
    mockApplyCarryDeps(students);

    await batchPromotionService.applyCarry('run-1', 'branch-1');

    const createManyCall = prismaMock.student.createMany.mock.calls[0] as any;
    const created = createManyCall[0].data as any[];
    expect(created[0].credentialTag).toBe('CRED_CARRIED');
    expect(created[1].credentialTag).toBe('CRED_NEW');
  });

  test('userId is moved from old to new student record', async () => {
    const students = makeStudents(2, () => 1);
    mockApplyCarryDeps(students);

    await batchPromotionService.applyCarry('run-1', 'branch-1');

    // userId cleared from old records
    const userIdClearCall = prismaMock.student.updateMany.mock.calls.find(
      (call: any[]) => call[0]?.data?.userId === null,
    );
    expect(userIdClearCall).toBeDefined();

    // New students should have the userId
    const createManyCall = prismaMock.student.createMany.mock.calls[0] as any;
    const created = createManyCall[0].data as any[];
    expect(created[0].userId).toBe('u1');
    expect(created[1].userId).toBe('u2');
  });

  test('classes are batch-created with createMany', async () => {
    const students = makeStudents(2, () => 1);
    mockApplyCarryDeps(students);

    await batchPromotionService.applyCarry('run-1', 'branch-1');

    expect(prismaMock.group.createMany).toHaveBeenCalledTimes(1);
  });

  test('subjects are batch-created with createMany', async () => {
    const students = makeStudents(2, () => 1);
    mockApplyCarryDeps(students, {
      sourceSubjects: [
        { id: 'sub1', name: 'Math', code: 'MATH', description: null, totalMarks: 100, passingMarks: 33, isElective: false, hodId: null },
        { id: 'sub2', name: 'English', code: 'ENG', description: null, totalMarks: 100, passingMarks: 33, isElective: false, hodId: null },
      ],
    });

    await batchPromotionService.applyCarry('run-1', 'branch-1');

    expect(prismaMock.subject.createMany).toHaveBeenCalledTimes(1);
  });

  test('all 5 deleteMany operations are executed', async () => {
    const students = makeStudents(2, () => 1);
    mockApplyCarryDeps(students);

    await batchPromotionService.applyCarry('run-1', 'branch-1');

    expect(prismaMock.student.deleteMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.group.deleteMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.subject.deleteMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.feeStructure.deleteMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.teacherAssignment.deleteMany).toHaveBeenCalledTimes(1);
  });

  test('batchPromotionRun updated to APPLIED phase', async () => {
    const students = makeStudents(2, () => 1);
    mockApplyCarryDeps(students);

    await batchPromotionService.applyCarry('run-1', 'branch-1');

    expect(prismaMock.batchPromotionRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-1' },
        data: { phase: 'APPLIED' },
      }),
    );
  });

  test('no students in source year: still clears and updates phase', async () => {
    mockApplyCarryDeps([]);

    await batchPromotionService.applyCarry('run-1', 'branch-1');

    // Should still update to APPLIED
    expect(prismaMock.batchPromotionRun.update).toHaveBeenCalled();
    // createMany should NOT be called
    expect(prismaMock.student.createMany).not.toHaveBeenCalled();
  });

  test('student without personId creates StudentPerson record', async () => {
    const students = makeStudents(2, () => 1);
    students[0].personId = null as any;
    mockApplyCarryDeps(students);

    await batchPromotionService.applyCarry('run-1', 'branch-1');

    // studentPerson.create should be called once for the student without personId
    expect(prismaMock.studentPerson.create).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// AUTHORIZATION / ISOLATION TESTS
// ═══════════════════════════════════════════════════════════════════

describe('DB-03D: applyCarry authorization / isolation', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rejects when run is not in SNAPSHOT_DONE phase', async () => {
    const wrongPhaseRun = mockRun({ phase: 'DRAFT' });
    prismaMock.batchPromotionRun.findFirst.mockResolvedValue(wrongPhaseRun as any);
    (prismaMock as any).$queryRaw.mockResolvedValue([wrongPhaseRun]);

    await expect(
      batchPromotionService.applyCarry('run-1', 'branch-1'),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('SNAPSHOT_DONE') });
  });

  test('rejects when students carry is true but classes is false', async () => {
    prismaMock.batchPromotionRun.findFirst.mockResolvedValue(
      mockRun({ carryOptions: { classes: false, students: true, subjects: false, teacherAssignments: false, timetableGrid: false, feeStructures: false } }) as any,
    );

    await expect(
      batchPromotionService.applyCarry('run-1', 'branch-1'),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('students') });
  });

  test('rejects when teacherAssignments is true but classes or subjects is false', async () => {
    prismaMock.batchPromotionRun.findFirst.mockResolvedValue(
      mockRun({ carryOptions: { classes: true, students: true, subjects: false, teacherAssignments: true, timetableGrid: false, feeStructures: false } }) as any,
    );

    await expect(
      batchPromotionService.applyCarry('run-1', 'branch-1'),
    ).rejects.toMatchObject({ status: 400 });
  });

  test('operations use correct source and target academic year IDs', async () => {
    const students = makeStudents(2, () => 1);
    mockApplyCarryDeps(students, {
      createdGroups: [{ id: 'new-g1', displayOrder: 1 }, { id: 'new-g2', displayOrder: 2 }],
    });

    await batchPromotionService.applyCarry('run-1', 'branch-1');

    // deleteMany should use target academic year
    expect(prismaMock.student.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ academicYearId: 'ay-target' }) }),
    );
    // findMany should use source academic year
    expect(prismaMock.group.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ academicYearId: 'ay-source' }) }),
    );
  });
});
