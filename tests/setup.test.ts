/**
 * Infrastructure Verification Test
 *
 * Verifies that the test infrastructure is set up correctly.
 */

import { prismaMock } from './mocks/prisma';

describe('Test Infrastructure', () => {
  it('should have NODE_ENV set to test', () => {
    expect(process.env.NODE_ENV).toBe('test');
  });

  it('should have JWT_SECRET set', () => {
    expect(process.env.JWT_SECRET).toBeDefined();
    expect(process.env.JWT_SECRET!.length).toBeGreaterThan(0);
  });

  it('should have DATABASE_URL set', () => {
    expect(process.env.DATABASE_URL).toBeDefined();
  });

  it('should have APP_MODE set', () => {
    // Note: APP_MODE is 'development' (not 'test') because the env schema
    // at src/config/env.ts only allows 'development' | 'production'.
    expect(process.env.APP_MODE).toBe('development');
  });

  it('should mock Prisma queries', async () => {
    prismaMock.user.findMany.mockResolvedValue([]);
    const result = await prismaMock.user.findMany();
    expect(result).toEqual([]);
    expect(prismaMock.user.findMany).toHaveBeenCalledTimes(1);
  });

  it('should mock Prisma create', async () => {
    const mockUser = { id: 'user-1', name: 'Test User' };
    prismaMock.user.create.mockResolvedValue(mockUser as any);
    const result = await prismaMock.user.create({ data: { name: 'Test User' } } as any);
    expect(result).toEqual(mockUser);
    expect(prismaMock.user.create).toHaveBeenCalledTimes(1);
  });

  it('should allow per-test mock isolation', () => {
    // After clearMocks, previous calls should be reset
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });
});
