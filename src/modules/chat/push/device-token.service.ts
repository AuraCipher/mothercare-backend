import { prisma } from '../../../lib/prisma';

export async function registerDeviceToken(userId: string, token: string, platform: string) {
  const normalizedPlatform = platform.toLowerCase();
  if (!['android', 'ios', 'web'].includes(normalizedPlatform)) {
    throw { status: 400, message: 'platform must be android, ios, or web' };
  }
  if (!token?.trim()) {
    throw { status: 400, message: 'token is required' };
  }

  return prisma.deviceToken.upsert({
    where: { token: token.trim() },
    create: { userId, token: token.trim(), platform: normalizedPlatform },
    update: { userId, platform: normalizedPlatform, updatedAt: new Date() },
  });
}

export async function listDeviceTokensForUsers(userIds: string[]): Promise<string[]> {
  if (!userIds.length) return [];
  const rows = await prisma.deviceToken.findMany({
    where: { userId: { in: userIds } },
    select: { token: true },
  });
  return rows.map((r) => r.token);
}

export async function removeDeviceToken(userId: string, token: string) {
  await prisma.deviceToken.deleteMany({ where: { userId, token } });
}
