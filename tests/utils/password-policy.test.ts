import { passwordPolicyError, assertPasswordPolicy } from '../../src/utils/password-policy';

describe('passwordPolicyError', () => {
  test('accepts generator-shaped passwords', () => {
    expect(passwordPolicyError('Xk9mP2qR!aB1')).toBeNull();
  });
  test.each([
    ['short', 'Sh0rt!x1'],
    ['no uppercase', 'newpass123!x'],
    ['no lowercase', 'NEWPASS123!X'],
    ['no digit', 'NewPassword!x'],
    ['no special', 'NewPass1234xy'],
    ['non-string', 12345],
  ])('rejects %s', (_label, pw) => {
    expect(passwordPolicyError(pw)).not.toBeNull();
  });
  test('assertPasswordPolicy throws WEAK_PASSWORD 400', () => {
    expect(() => assertPasswordPolicy('weak')).toThrow(expect.objectContaining({ status: 400, code: 'WEAK_PASSWORD' }));
    expect(() => assertPasswordPolicy('Xk9mP2qR!aB1')).not.toThrow();
  });
});
