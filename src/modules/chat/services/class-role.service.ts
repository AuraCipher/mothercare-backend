import { prisma } from '../../../lib/prisma';
import { syncClassRoleMemberships } from './class-role-sync.service';

export type ClassRoleDefinitionDto = {
  id: string;
  communityId: string;
  name: string;
  description: string | null;
  canPostInGroups: boolean;
  canReceiveDms: boolean;
  canInitiateDms: boolean;
  isActive: boolean;
  assignments: ClassRoleAssignmentDto[];
};

export type ClassRoleAssignmentDto = {
  id: string;
  communityId: string;
  roleDefinitionId: string;
  studentId: string;
  userId: string | null;
  publicDisplayName: string;
  isMessagingRestricted: boolean;
  assignedAt: string;
  student: {
    id: string;
    name: string;
    rollNumber: string | null;
  };
};

const roleInclude = {
  assignments: {
    where: { removedAt: null },
    include: {
      student: { select: { id: true, name: true, rollNumber: true } },
    },
    orderBy: { assignedAt: 'asc' as const },
  },
};

function serializeAssignment(row: {
  id: string;
  communityId: string;
  roleDefinitionId: string;
  studentId: string;
  userId: string | null;
  publicDisplayName: string;
  isMessagingRestricted: boolean;
  assignedAt: Date;
  student: { id: string; name: string; rollNumber: string | null };
}): ClassRoleAssignmentDto {
  return {
    id: row.id,
    communityId: row.communityId,
    roleDefinitionId: row.roleDefinitionId,
    studentId: row.studentId,
    userId: row.userId,
    publicDisplayName: row.publicDisplayName,
    isMessagingRestricted: row.isMessagingRestricted,
    assignedAt: row.assignedAt.toISOString(),
    student: row.student,
  };
}

function serializeRoleDefinition(row: {
  id: string;
  communityId: string;
  name: string;
  description: string | null;
  canPostInGroups: boolean;
  canReceiveDms: boolean;
  canInitiateDms: boolean;
  isActive: boolean;
  assignments: Array<Parameters<typeof serializeAssignment>[0]>;
}): ClassRoleDefinitionDto {
  return {
    id: row.id,
    communityId: row.communityId,
    name: row.name,
    description: row.description,
    canPostInGroups: row.canPostInGroups,
    canReceiveDms: row.canReceiveDms,
    canInitiateDms: row.canInitiateDms,
    isActive: row.isActive,
    assignments: row.assignments.map(serializeAssignment),
  };
}

export async function getActiveCommunityOrThrow(communityId: string) {
  const community = await prisma.chatCommunity.findUnique({
    where: { id: communityId },
    include: {
      group: { select: { id: true, name: true, section: true } },
      academicYear: { select: { id: true, branchId: true, status: true } },
    },
  });
  if (!community || !community.isActive) {
    throw { status: 404, message: 'Community not found' };
  }
  return community;
}

export type CommunitySummary = {
  id: string;
  groupId: string;
  academicYearId: string;
  groupLabel: string;
};

function formatGroupLabel(group: { name: string; section: string | null }): string {
  return group.section ? `${group.name} — ${group.section}` : group.name;
}

/** Find or create chat community for a class group in an academic year. */
export async function resolveCommunityByGroupId(
  groupId: string,
  academicYearId: string,
): Promise<CommunitySummary> {
  const group = await prisma.group.findFirst({
    where: { id: groupId, academicYearId },
    select: { id: true, name: true, section: true },
  });
  if (!group) {
    throw { status: 404, message: 'Class not found' };
  }

  let community = await prisma.chatCommunity.findUnique({ where: { groupId } });
  if (!community) {
    community = await prisma.chatCommunity.create({
      data: { academicYearId, groupId },
    });
  }

  return {
    id: community.id,
    groupId: community.groupId,
    academicYearId: community.academicYearId,
    groupLabel: formatGroupLabel(group),
  };
}

export async function listClassRoleDefinitions(communityId: string): Promise<ClassRoleDefinitionDto[]> {
  await getActiveCommunityOrThrow(communityId);
  const rows = await prisma.classRoleDefinition.findMany({
    where: { communityId, isActive: true },
    include: roleInclude,
    orderBy: { name: 'asc' },
  });
  return rows.map(serializeRoleDefinition);
}

export async function createClassRoleDefinition(input: {
  communityId: string;
  name: string;
  description?: string | null;
  canPostInGroups?: boolean;
  canReceiveDms?: boolean;
  canInitiateDms?: boolean;
  createdById: string;
}): Promise<ClassRoleDefinitionDto> {
  await getActiveCommunityOrThrow(input.communityId);

  const name = input.name?.trim();
  if (!name) {
    throw { status: 400, message: 'Role name is required' };
  }

  try {
    const created = await prisma.classRoleDefinition.create({
      data: {
        communityId: input.communityId,
        name,
        description: input.description?.trim() || null,
        canPostInGroups: input.canPostInGroups ?? false,
        canReceiveDms: input.canReceiveDms ?? true,
        canInitiateDms: input.canInitiateDms ?? false,
        createdById: input.createdById,
      },
      include: roleInclude,
    });
    return serializeRoleDefinition(created);
  } catch (err: any) {
    if (err?.code === 'P2002') {
      throw { status: 409, message: 'A role with this name already exists in this class' };
    }
    throw err;
  }
}

export async function updateClassRoleDefinition(input: {
  communityId: string;
  roleDefinitionId: string;
  name?: string;
  description?: string | null;
  canPostInGroups?: boolean;
  canReceiveDms?: boolean;
  canInitiateDms?: boolean;
}): Promise<ClassRoleDefinitionDto> {
  await getActiveCommunityOrThrow(input.communityId);

  const existing = await prisma.classRoleDefinition.findFirst({
    where: {
      id: input.roleDefinitionId,
      communityId: input.communityId,
      isActive: true,
    },
  });
  if (!existing) {
    throw { status: 404, message: 'Role not found' };
  }

  const name = input.name !== undefined ? input.name.trim() : undefined;
  if (name !== undefined && !name) {
    throw { status: 400, message: 'Role name cannot be empty' };
  }

  try {
    const updated = await prisma.classRoleDefinition.update({
      where: { id: input.roleDefinitionId },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(input.description !== undefined
          ? { description: input.description?.trim() || null }
          : {}),
        ...(input.canPostInGroups !== undefined
          ? { canPostInGroups: input.canPostInGroups }
          : {}),
        ...(input.canReceiveDms !== undefined ? { canReceiveDms: input.canReceiveDms } : {}),
        ...(input.canInitiateDms !== undefined
          ? { canInitiateDms: input.canInitiateDms }
          : {}),
      },
      include: roleInclude,
    });

    if (
      input.canPostInGroups !== undefined &&
      input.canPostInGroups !== existing.canPostInGroups
    ) {
      await syncClassRoleMemberships(input.communityId);
    }

    return serializeRoleDefinition(updated);
  } catch (err: any) {
    if (err?.code === 'P2002') {
      throw { status: 409, message: 'A role with this name already exists in this class' };
    }
    throw err;
  }
}

export async function deleteClassRoleDefinition(input: {
  communityId: string;
  roleDefinitionId: string;
}): Promise<void> {
  await getActiveCommunityOrThrow(input.communityId);

  const existing = await prisma.classRoleDefinition.findFirst({
    where: {
      id: input.roleDefinitionId,
      communityId: input.communityId,
      isActive: true,
    },
  });
  if (!existing) {
    throw { status: 404, message: 'Role not found' };
  }

  await prisma.classRoleDefinition.update({
    where: { id: input.roleDefinitionId },
    data: { isActive: false },
  });

  await syncClassRoleMemberships(input.communityId);
}

export async function assignClassRole(input: {
  communityId: string;
  roleDefinitionId: string;
  studentId: string;
  publicDisplayName?: string;
  isMessagingRestricted?: boolean;
  assignedById: string;
}): Promise<ClassRoleAssignmentDto> {
  const community = await getActiveCommunityOrThrow(input.communityId);

  const role = await prisma.classRoleDefinition.findFirst({
    where: {
      id: input.roleDefinitionId,
      communityId: input.communityId,
      isActive: true,
    },
  });
  if (!role) {
    throw { status: 404, message: 'Role not found' };
  }

  const student = await prisma.student.findFirst({
    where: {
      id: input.studentId,
      groupId: community.groupId,
      academicYearId: community.academicYearId,
    },
    select: { id: true, name: true, rollNumber: true, userId: true },
  });
  if (!student) {
    throw { status: 400, message: 'Student is not enrolled in this class' };
  }
  if (!student.userId) {
    throw { status: 400, message: 'Student does not have a login account' };
  }

  const displayName = input.publicDisplayName?.trim() || `${role.name} — ${student.name}`;

  const assignment = await prisma.classRoleAssignment.upsert({
    where: {
      roleDefinitionId_studentId: {
        roleDefinitionId: input.roleDefinitionId,
        studentId: input.studentId,
      },
    },
    create: {
      communityId: input.communityId,
      roleDefinitionId: input.roleDefinitionId,
      studentId: input.studentId,
      userId: student.userId,
      publicDisplayName: displayName,
      isMessagingRestricted: input.isMessagingRestricted ?? false,
      assignedById: input.assignedById,
    },
    update: {
      removedAt: null,
      removedById: null,
      userId: student.userId,
      publicDisplayName: displayName,
      isMessagingRestricted: input.isMessagingRestricted ?? false,
      assignedById: input.assignedById,
    },
    include: {
      student: { select: { id: true, name: true, rollNumber: true } },
    },
  });

  await syncClassRoleMemberships(input.communityId);
  return serializeAssignment(assignment);
}

export async function removeClassRoleAssignment(input: {
  communityId: string;
  assignmentId: string;
  removedById: string;
}): Promise<void> {
  await getActiveCommunityOrThrow(input.communityId);

  const assignment = await prisma.classRoleAssignment.findFirst({
    where: {
      id: input.assignmentId,
      communityId: input.communityId,
      removedAt: null,
    },
  });
  if (!assignment) {
    throw { status: 404, message: 'Assignment not found' };
  }

  await prisma.classRoleAssignment.update({
    where: { id: input.assignmentId },
    data: {
      removedAt: new Date(),
      removedById: input.removedById,
    },
  });

  await syncClassRoleMemberships(input.communityId);
}
