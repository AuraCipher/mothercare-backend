/**
 * Tests for branch-encoded API key pattern.
 *
 * Key format: {type}_mcs_{branchCode}_{randomHex}
 *   Global:  pk_mcs_global_a1b2c3...
 *   Scoped:  pk_mcs_MCS-SOHAN_a1b2c3...
 *
 * The middleware extracts the branch code from the key string
 * and does a fast string match before any bcrypt compare.
 */

import { prismaMock } from '../../mocks/prisma';
import apiKeyService from '../../../src/modules/api-key/api-key.service';
import { createMockApiKey } from '../../helpers/factories';

describe('API Key — branch-encoded pattern', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  describe('verifyByKey with branch code matching', () => {
    test('global key (branch=global) passes for any branch', async () => {
      prismaMock.apiKey.findMany.mockResolvedValue([{ id: 'key-1', name: 'Test', type: 'publishable', keyHash: '$2a$12$hash', prefix: 'pk_mcs_global_dev' }] as any);
      const bcrypt = require('bcryptjs');
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);
      prismaMock.apiKey.update.mockResolvedValue({} as any);

      const result = await apiKeyService.verifyByKey(
        'pk_mcs_global_dev_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6',
        'ANY-BRANCH',
      );

      expect(result).not.toBeNull();
      expect(result!.id).toBe('key-1');
    });

    test('scoped key passes when branch code matches target', async () => {
      prismaMock.apiKey.findMany.mockResolvedValue([{ id: 'key-2', name: 'Sohan Key', type: 'publishable', keyHash: '$2a$12$hash', prefix: 'pk_mcs_MCS-SOHAN_dev' }] as any);
      const bcrypt = require('bcryptjs');
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);
      prismaMock.apiKey.update.mockResolvedValue({} as any);

      const result = await apiKeyService.verifyByKey(
        'pk_mcs_MCS-SOHAN_dev_a1b2c3d4e5f6a1b2c3d4e5f6',
        'MCS-SOHAN',
      );

      expect(result).not.toBeNull();
    });

    test('scoped key is REJECTED when branch code does NOT match target', async () => {
      // Key is for MCS-SOHAN but trying to access RAWALPINDI
      // Should be rejected at Phase 2 (string match) — NO DB call, NO bcrypt
      const result = await apiKeyService.verifyByKey(
        'pk_mcs_MCS-SOHAN_dev_a1b2c3d4e5f6',
        'RAWALPINDI',
      );

      expect(result).toBeNull();
      // The key was rejected before any DB query
      expect(prismaMock.apiKey.findMany).not.toHaveBeenCalled();
    });

    test('malformed key (fewer than 4 parts) returns null', async () => {
      const result = await apiKeyService.verifyByKey('pk_mcs_short');
      expect(result).toBeNull();
    });
  });

  describe('createApiKey with branch code', () => {
    test('creates key with branch code embedded in string', async () => {
      const mockKey = createMockApiKey({ prefix: 'pk_mcs_MCS-SOHAN_test' });
      prismaMock.apiKey.create.mockResolvedValue(mockKey as any);

      const result = await apiKeyService.createApiKey('Sohan Key', 'publishable', 'ceo-1', 'MCS-SOHAN', 'branch-uuid');

      expect(result.key.key).toMatch(/^pk_mcs_MCS-SOHAN_/);
      expect(result.key.prefix).toMatch(/^pk_mcs_MCS-SOHAN_/);
      expect(prismaMock.apiKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ branchId: 'branch-uuid' }),
        }),
      );
    });

    test('creates global key without branch code', async () => {
      const mockKey = createMockApiKey({ prefix: 'sk_mcs_global_test' });
      prismaMock.apiKey.create.mockResolvedValue(mockKey as any);

      const result = await apiKeyService.createApiKey('Global Key', 'secret', 'ceo-1');

      expect(result.key.key).toMatch(/^sk_mcs_global_/);
      expect(result.key.prefix).toMatch(/^sk_mcs_global_/);
      expect(prismaMock.apiKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ branchId: expect.anything() }),
        }),
      );
    });
  });
});
