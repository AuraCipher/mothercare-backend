/**
 * DB-03E: Batch Promotion Concurrency / Idempotency Hardening — Regression tests.
 *
 * Verifies that promotion-run phase transitions are validated atomically
 * inside the transaction using SELECT ... FOR UPDATE, preventing concurrent
 * duplicate execution.
 *
 * IMPORTANT: Unit tests verify state-transition determinism using mocks.
 * True PostgreSQL row-lock behavior (blocking concurrent transactions) cannot
 * be verified in unit tests — it is a database-level guarantee from FOR UPDATE.
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

function mockApplyCarryDeps(runOverrides: Record<string, any> = {}) {
  const run = mockRun(runOverrides);
  prismaMock.batchPromotionRun.findFirst.mockResolvedValue(run as any);
  (prismaMock as any).$queryRaw.mockResolvedValue([run]);

  prismaMock.student.deleteMany.mockResolvedValue({ count: 0 } as any);
  prismaMock.group.deleteMany.mockResolvedValue({ count: 0 } as any);
  prismaMock.subject.deleteMany.mockResolvedValue({ count: 0 } as any);
  prismaMock.feeStructure.deleteMany.mockResolvedValue({ count: 0 } as any);
  prismaMock.teacherAssignment.deleteMany.mockResolvedValue({ count: 0 } as any);
  // Return at least one source group to avoid "Source year has no groups"
  prismaMock.group.findMany.mockResolvedValue([
    { id: 'g1', name: 'Class 1', section: 'A', displayOrder: 1, capacity: 30, onlyAdminCanSend: true, isActive: true },
  ] as any);
  prismaMock.subject.findMany.mockResolvedValue([]);
  prismaMock.groupSubject.findMany.mockResolvedValue([]);
  prismaMock.student.findMany.mockResolvedValue([]);
  prismaMock.student.updateMany.mockResolvedValue({ count: 0 } as any);
  prismaMock.teacherAssignment.findMany.mockResolvedValue([]);
  prismaMock.teacherAssignment.createMany.mockResolvedValue({ count: 0 } as any);
  prismaMock.feeStructure.findMany.mockResolvedValue([]);
  prismaMock.feeStructure.createMany.mockResolvedValue({ count: 0 } as any);
  prismaMock.timetable.findMany.mockResolvedValue([]);
  prismaMock.timetableSlot.findMany.mockResolvedValue([]);
  prismaMock.timetableEntry.createMany.mockResolvedValue({ count: 0 } as any);
  prismaMock.batchPromotionRun.update.mockResolvedValue({} as any);
  prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
}

function mockSnapshotDeps(runOverrides: Record<string, any> = {}) {
  const run = mockRun({ phase: 'DRAFT', ...runOverrides });
  prismaMock.batchPromotionRun.findFirst.mockResolvedValue(run as any);
  (prismaMock as any).$queryRaw.mockResolvedValue([run]);

  prismaMock.academicYear.findUnique.mockResolvedValue({
    id: 'ay-source',
    calendar: { label: '2025-26' },
    groups: [],
  } as any);
  prismaMock.student.count.mockResolvedValue(0 as any);
  prismaMock.academicYearSnapshot.create.mockResolvedValue({ id: 'snap-1' } as any);
  prismaMock.groupSnapshot.createMany.mockResolvedValue({ count: 0 } as any);
  prismaMock.teacherAssignment.findMany.mockResolvedValue([]);
  prismaMock.teacherAySnapshot.upsert.mockResolvedValue({} as any);
  prismaMock.batchPromotionRun.update.mockResolvedValue({} as any);
  prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
}

function mockPublishDeps(runOverrides: Record<string, any> = {}) {
  const run = mockRun({ phase: 'APPLIED', ...runOverrides });
  prismaMock.batchPromotionRun.findFirst.mockResolvedValue(run as any);
  (prismaMock as any).$queryRaw.mockResolvedValue([run]);

  prismaMock.academicYear.update.mockResolvedValue({} as any);
  prismaMock.academicYearSnapshot.update.mockResolvedValue({} as any);
  prismaMock.batchPromotionRun.update.mockResolvedValue({} as any);
  prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
}

// ═══════════════════════════════════════════════════════════════════
// FOR UPDATE VERIFICATION
// ═══════════════════════════════════════════════════════════════════

describe('DB-03E: lockAndValidateRun uses FOR UPDATE', () => {
  beforeEach(() => jest.clearAllMocks());

  test('applyCarry calls $queryRaw with FOR UPDATE inside transaction', async () => {
    mockApplyCarryDeps();

    await batchPromotionService.applyCarry('run-1', 'branch-1');

    expect((prismaMock as any).$queryRaw).toHaveBeenCalled();
    const call = (prismaMock as any).$queryRaw.mock.calls[0];
    const sql = call[0].join('');
    expect(sql).toContain('FOR UPDATE');
  });

  test('snapshotRun calls $queryRaw with FOR UPDATE inside transaction', async () => {
    mockSnapshotDeps();

    await batchPromotionService.snapshotRun('run-1', 'branch-1', 'admin-1');

    expect((prismaMock as any).$queryRaw).toHaveBeenCalled();
    const call = (prismaMock as any).$queryRaw.mock.calls[0];
    const sql = call[0].join('');
    expect(sql).toContain('FOR UPDATE');
  });

  test('publish calls $queryRaw with FOR UPDATE inside transaction', async () => {
    mockPublishDeps();

    await batchPromotionService.publish('run-1', 'branch-1');

    expect((prismaMock as any).$queryRaw).toHaveBeenCalled();
    const call = (prismaMock as any).$queryRaw.mock.calls[0];
    const sql = call[0].join('');
    expect(sql).toContain('FOR UPDATE');
  });

  test('$queryRaw receives correct runId and branchId parameters', async () => {
    mockApplyCarryDeps();

    await batchPromotionService.applyCarry('run-1', 'branch-1');

    const call = (prismaMock as any).$queryRaw.mock.calls[0];
    const params = call.slice(1);
    expect(params).toContain('run-1');
    expect(params).toContain('branch-1');
  });
});

// ═══════════════════════════════════════════════════════════════════
// PHASE TRANSITION VALIDATION
// ═══════════════════════════════════════════════════════════════════

describe('DB-03E: phase transition validation inside transaction', () => {
  beforeEach(() => jest.clearAllMocks());

  test('applyCarry rejects when $queryRaw returns wrong phase', async () => {
    const wrongPhaseRun = mockRun({ phase: 'DRAFT' });
    prismaMock.batchPromotionRun.findFirst.mockResolvedValue(wrongPhaseRun as any);
    (prismaMock as any).$queryRaw.mockResolvedValue([wrongPhaseRun]);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));

    await expect(
      batchPromotionService.applyCarry('run-1', 'branch-1'),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('SNAPSHOT_DONE') });
  });

  test('snapshotRun rejects when $queryRaw returns wrong phase', async () => {
    const wrongPhaseRun = mockRun({ phase: 'SNAPSHOT_DONE' });
    prismaMock.batchPromotionRun.findFirst.mockResolvedValue(wrongPhaseRun as any);
    (prismaMock as any).$queryRaw.mockResolvedValue([wrongPhaseRun]);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));

    await expect(
      batchPromotionService.snapshotRun('run-1', 'branch-1', 'admin-1'),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('DRAFT') });
  });

  test('publish rejects when $queryRaw returns wrong phase', async () => {
    const wrongPhaseRun = mockRun({ phase: 'DRAFT' });
    prismaMock.batchPromotionRun.findFirst.mockResolvedValue(wrongPhaseRun as any);
    (prismaMock as any).$queryRaw.mockResolvedValue([wrongPhaseRun]);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));

    await expect(
      batchPromotionService.publish('run-1', 'branch-1'),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('APPLIED') });
  });

  test('applyCarry rejects when $queryRaw returns empty array (run not found)', async () => {
    prismaMock.batchPromotionRun.findFirst.mockResolvedValue(mockRun() as any);
    (prismaMock as any).$queryRaw.mockResolvedValue([]);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));

    await expect(
      batchPromotionService.applyCarry('run-1', 'branch-1'),
    ).rejects.toMatchObject({ status: 404, message: 'Promotion run not found' });
  });
});

// ═══════════════════════════════════════════════════════════════════
// CONCURRENT applyCarry SCENARIOS
// ═══════════════════════════════════════════════════════════════════

describe('DB-03E: concurrent applyCarry protection', () => {
  beforeEach(() => jest.clearAllMocks());

  test('second applyCarry call fails when phase has already transitioned', async () => {
    // First call: $queryRaw returns SNAPSHOT_DONE → succeeds → phase becomes APPLIED
    const run = mockRun({ phase: 'SNAPSHOT_DONE' });
    prismaMock.batchPromotionRun.findFirst.mockResolvedValue(run as any);

    let queryRawCallCount = 0;
    (prismaMock as any).$queryRaw.mockImplementation(async () => {
      queryRawCallCount++;
      if (queryRawCallCount === 1) {
        return [mockRun({ phase: 'SNAPSHOT_DONE' })];
      }
      return [mockRun({ phase: 'APPLIED' })];
    });

    prismaMock.student.deleteMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.group.deleteMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.subject.deleteMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.feeStructure.deleteMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.teacherAssignment.deleteMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.group.findMany.mockResolvedValue([
      { id: 'g1', name: 'Class 1', section: 'A', displayOrder: 1, capacity: 30, onlyAdminCanSend: true, isActive: true },
    ] as any);
    prismaMock.subject.findMany.mockResolvedValue([]);
    prismaMock.groupSubject.findMany.mockResolvedValue([]);
    prismaMock.student.findMany.mockResolvedValue([]);
    prismaMock.student.updateMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.teacherAssignment.findMany.mockResolvedValue([]);
    prismaMock.teacherAssignment.createMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.feeStructure.findMany.mockResolvedValue([]);
    prismaMock.feeStructure.createMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.timetable.findMany.mockResolvedValue([]);
    prismaMock.timetableSlot.findMany.mockResolvedValue([]);
    prismaMock.timetableEntry.createMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.batchPromotionRun.update.mockResolvedValue({} as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));

    // First call succeeds
    await batchPromotionService.applyCarry('run-1', 'branch-1');

    // Second call fails because phase is now APPLIED
    await expect(
      batchPromotionService.applyCarry('run-1', 'branch-1'),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('APPLIED') });
  });

  test('applyCarry rejects after publish (phase is PUBLISHED)', async () => {
    const run = mockRun({ phase: 'PUBLISHED' });
    prismaMock.batchPromotionRun.findFirst.mockResolvedValue(run as any);
    (prismaMock as any).$queryRaw.mockResolvedValue([run]);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));

    await expect(
      batchPromotionService.applyCarry('run-1', 'branch-1'),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('SNAPSHOT_DONE') });
  });
});

// ═══════════════════════════════════════════════════════════════════
// CONCURRENT snapshotRun SCENARIOS
// ═══════════════════════════════════════════════════════════════════

describe('DB-03E: concurrent snapshotRun protection', () => {
  beforeEach(() => jest.clearAllMocks());

  test('second snapshotRun call fails when phase has already transitioned', async () => {
    const run = mockRun({ phase: 'DRAFT' });
    prismaMock.batchPromotionRun.findFirst.mockResolvedValue(run as any);

    let queryRawCallCount = 0;
    (prismaMock as any).$queryRaw.mockImplementation(async () => {
      queryRawCallCount++;
      if (queryRawCallCount === 1) {
        return [mockRun({ phase: 'DRAFT' })];
      }
      return [mockRun({ phase: 'SNAPSHOT_DONE' })];
    });

    prismaMock.academicYear.findUnique.mockResolvedValue({
      id: 'ay-source', calendar: { label: '2025-26' }, groups: [],
    } as any);
    prismaMock.student.count.mockResolvedValue(0 as any);
    prismaMock.academicYearSnapshot.create.mockResolvedValue({ id: 'snap-1' } as any);
    prismaMock.groupSnapshot.createMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.teacherAssignment.findMany.mockResolvedValue([]);
    prismaMock.teacherAySnapshot.upsert.mockResolvedValue({} as any);
    prismaMock.batchPromotionRun.update.mockResolvedValue({} as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));

    // First call succeeds
    await batchPromotionService.snapshotRun('run-1', 'branch-1', 'admin-1');

    // Second call fails because phase is now SNAPSHOT_DONE
    await expect(
      batchPromotionService.snapshotRun('run-1', 'branch-1', 'admin-1'),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('DRAFT') });
  });
});

// ═══════════════════════════════════════════════════════════════════
// CONCURRENT publish SCENARIOS
// ═══════════════════════════════════════════════════════════════════

describe('DB-03E: concurrent publish protection', () => {
  beforeEach(() => jest.clearAllMocks());

  test('second publish call fails when phase has already transitioned', async () => {
    const run = mockRun({ phase: 'APPLIED' });
    prismaMock.batchPromotionRun.findFirst.mockResolvedValue(run as any);

    let queryRawCallCount = 0;
    (prismaMock as any).$queryRaw.mockImplementation(async () => {
      queryRawCallCount++;
      if (queryRawCallCount === 1) {
        return [mockRun({ phase: 'APPLIED' })];
      }
      return [mockRun({ phase: 'PUBLISHED' })];
    });

    prismaMock.academicYear.update.mockResolvedValue({} as any);
    prismaMock.academicYearSnapshot.update.mockResolvedValue({} as any);
    prismaMock.batchPromotionRun.update.mockResolvedValue({} as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));

    // First call succeeds
    await batchPromotionService.publish('run-1', 'branch-1');

    // Second call fails because phase is now PUBLISHED
    await expect(
      batchPromotionService.publish('run-1', 'branch-1'),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('APPLIED') });
  });

  test('publish rejects after DRAFT phase', async () => {
    mockPublishDeps({ phase: 'DRAFT' });

    await expect(
      batchPromotionService.publish('run-1', 'branch-1'),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('APPLIED') });
  });
});

// ═══════════════════════════════════════════════════════════════════
// RACE WITH INVALID PHASE TRANSITION
// ═══════════════════════════════════════════════════════════════════

describe('DB-03E: invalid phase transitions', () => {
  beforeEach(() => jest.clearAllMocks());

  test('applyCarry cannot skip from DRAFT to APPLIED', async () => {
    const run = mockRun({ phase: 'DRAFT' });
    prismaMock.batchPromotionRun.findFirst.mockResolvedValue(run as any);
    (prismaMock as any).$queryRaw.mockResolvedValue([run]);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));

    await expect(
      batchPromotionService.applyCarry('run-1', 'branch-1'),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('SNAPSHOT_DONE') });
  });

  test('publish cannot skip from SNAPSHOT_DONE to PUBLISHED', async () => {
    const run = mockRun({ phase: 'SNAPSHOT_DONE' });
    prismaMock.batchPromotionRun.findFirst.mockResolvedValue(run as any);
    (prismaMock as any).$queryRaw.mockResolvedValue([run]);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));

    await expect(
      batchPromotionService.publish('run-1', 'branch-1'),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('APPLIED') });
  });

  test('snapshotRun cannot be called on SNAPSHOT_DONE run', async () => {
    const run = mockRun({ phase: 'SNAPSHOT_DONE' });
    prismaMock.batchPromotionRun.findFirst.mockResolvedValue(run as any);
    (prismaMock as any).$queryRaw.mockResolvedValue([run]);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));

    await expect(
      batchPromotionService.snapshotRun('run-1', 'branch-1', 'admin-1'),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('DRAFT') });
  });
});

// ═══════════════════════════════════════════════════════════════════
// SEQUENTIAL IDEMPOTENCY
// ═══════════════════════════════════════════════════════════════════

describe('DB-03E: sequential idempotency', () => {
  beforeEach(() => jest.clearAllMocks());

  test('repeated applyCarry after completion fails with correct phase', async () => {
    const run = mockRun({ phase: 'APPLIED' });
    prismaMock.batchPromotionRun.findFirst.mockResolvedValue(run as any);
    (prismaMock as any).$queryRaw.mockResolvedValue([run]);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));

    await expect(
      batchPromotionService.applyCarry('run-1', 'branch-1'),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('SNAPSHOT_DONE') });
  });

  test('repeated snapshotRun after completion fails with correct phase', async () => {
    const run = mockRun({ phase: 'SNAPSHOT_DONE' });
    prismaMock.batchPromotionRun.findFirst.mockResolvedValue(run as any);
    (prismaMock as any).$queryRaw.mockResolvedValue([run]);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));

    await expect(
      batchPromotionService.snapshotRun('run-1', 'branch-1', 'admin-1'),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('DRAFT') });
  });

  test('repeated publish after completion fails with correct phase', async () => {
    const run = mockRun({ phase: 'PUBLISHED' });
    prismaMock.batchPromotionRun.findFirst.mockResolvedValue(run as any);
    (prismaMock as any).$queryRaw.mockResolvedValue([run]);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));

    await expect(
      batchPromotionService.publish('run-1', 'branch-1'),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('APPLIED') });
  });
});

// ═══════════════════════════════════════════════════════════════════
// ROLLBACK / FAILURE BEHAVIOR
// ═══════════════════════════════════════════════════════════════════

describe('DB-03E: rollback / failure behavior', () => {
  beforeEach(() => jest.clearAllMocks());

  test('transaction failure does not permanently mark run as APPLIED', async () => {
    const run = mockRun({ phase: 'SNAPSHOT_DONE' });
    prismaMock.batchPromotionRun.findFirst.mockResolvedValue(run as any);
    (prismaMock as any).$queryRaw.mockResolvedValue([run]);

    // First call: transaction fails mid-way
    prismaMock.student.deleteMany.mockRejectedValueOnce(new Error('DB connection lost'));
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));

    await expect(
      batchPromotionService.applyCarry('run-1', 'branch-1'),
    ).rejects.toThrow();

    // Verify batchPromotionRun.update was NOT called (phase not changed)
    expect(prismaMock.batchPromotionRun.update).not.toHaveBeenCalled();
  });

  test('failed run can be retried (phase unchanged)', async () => {
    const run = mockRun({ phase: 'SNAPSHOT_DONE' });
    prismaMock.batchPromotionRun.findFirst.mockResolvedValue(run as any);
    (prismaMock as any).$queryRaw.mockResolvedValue([mockRun({ phase: 'SNAPSHOT_DONE' })]);

    prismaMock.student.deleteMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.group.deleteMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.subject.deleteMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.feeStructure.deleteMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.teacherAssignment.deleteMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.group.findMany.mockResolvedValue([
      { id: 'g1', name: 'Class 1', section: 'A', displayOrder: 1, capacity: 30, onlyAdminCanSend: true, isActive: true },
    ] as any);
    prismaMock.subject.findMany.mockResolvedValue([]);
    prismaMock.groupSubject.findMany.mockResolvedValue([]);
    prismaMock.student.findMany.mockResolvedValue([]);
    prismaMock.student.updateMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.teacherAssignment.findMany.mockResolvedValue([]);
    prismaMock.teacherAssignment.createMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.feeStructure.findMany.mockResolvedValue([]);
    prismaMock.feeStructure.createMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.timetable.findMany.mockResolvedValue([]);
    prismaMock.timetableSlot.findMany.mockResolvedValue([]);
    prismaMock.timetableEntry.createMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.batchPromotionRun.update.mockResolvedValue({} as any);

    // First attempt: $transaction throws after callback
    prismaMock.$transaction.mockImplementationOnce(async (cb: any) => {
      const tx = { ...prismaMock, $queryRaw: (prismaMock as any).$queryRaw };
      await cb(tx);
      throw new Error('Simulated failure');
    });

    await expect(
      batchPromotionService.applyCarry('run-1', 'branch-1'),
    ).rejects.toThrow();

    // NOTE: In real PostgreSQL, the transaction rollback would undo batchPromotionRun.update.
    // The mock runs the callback to completion before throwing, so update IS called.
    // This is a mock limitation — the important assertion is that $queryRaw was called
    // (proving lockAndValidateRun executed), and the retry succeeds.

    // Second attempt: succeeds (phase is still SNAPSHOT_DONE because $queryRaw returns SNAPSHOT_DONE)
    prismaMock.batchPromotionRun.update.mockClear();
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    await batchPromotionService.applyCarry('run-1', 'branch-1');

    // $queryRaw was called twice (once per attempt)
    expect((prismaMock as any).$queryRaw).toHaveBeenCalledTimes(2);
    // Second attempt's update was called
    expect(prismaMock.batchPromotionRun.update).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// AUTHORIZATION VERIFICATION
// ═══════════════════════════════════════════════════════════════════

describe('DB-03E: authorization preserved', () => {
  beforeEach(() => jest.clearAllMocks());

  test('applyCarry still validates carry option dependencies before transaction', async () => {
    const run = mockRun({
      carryOptions: { classes: false, students: true, subjects: false, teacherAssignments: false, timetableGrid: false, feeStructures: false },
    });
    prismaMock.batchPromotionRun.findFirst.mockResolvedValue(run as any);

    // Should fail on carry option validation BEFORE $queryRaw is called
    await expect(
      batchPromotionService.applyCarry('run-1', 'branch-1'),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('students') });

    // $queryRaw should NOT have been called (failed before transaction)
    expect((prismaMock as any).$queryRaw).not.toHaveBeenCalled();
  });

  test('getRun still validates branchId', async () => {
    prismaMock.batchPromotionRun.findFirst.mockResolvedValue(null as any);

    await expect(
      batchPromotionService.applyCarry('run-1', 'wrong-branch'),
    ).rejects.toMatchObject({ status: 404 });
  });
});
