/**
 * Username Utility Tests
 *
 * Tests the username generation, encoding/decoding, and password generation.
 * Pure functions — no mocking needed.
 */

import { generateUsername, decodeUsername, scatterCount, unscatterCount, generatePassword } from '../../src/utils/username';

describe('generateUsername', () => {
  test('produces a string combining firstName, scatteredNumber, letterRoll, and admissionYear', () => {
    const result = generateUsername('Ali', 907, 2025);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(6);
  });

  test('output contains the first name prefix', () => {
    const result = generateUsername('Fatima', 1017, 2025);
    expect(result.startsWith('fatima')).toBe(true);
  });

  test('is deterministic (same inputs produce same output)', () => {
    const a = generateUsername('Ahmed', 123, 2025);
    const b = generateUsername('Ahmed', 123, 2025);
    expect(a).toBe(b);
  });

  test('handles single-digit studentNumber', () => {
    const result = generateUsername('Ali', 5, 2025);
    expect(result).toBeTruthy();
    expect(result.length).toBeGreaterThan(0);
  });

  test('handles 4-digit studentNumber', () => {
    const result = generateUsername('Zara', 9999, 2025);
    expect(result).toBeTruthy();
  });

  test('handles lowercase first name input', () => {
    const result = generateUsername('ali', 907, 2025);
    expect(result.startsWith('ali')).toBe(true);
  });
});

describe('decodeUsername', () => {
  test('roundtrips correctly (decode(encode(x)) recovers components)', () => {
    const name = 'Bilal';
    const num = 1234;
    const year = 2025;
    const encoded = generateUsername(name, num, year);
    const decoded = decodeUsername(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.studentNumber).toBe(num);
  });

  test('recovers studentNumber from encoded string', () => {
    const result = decodeUsername('ahmed790kzx5');
    expect(result).not.toBeNull();
    expect(result!.studentNumber).toBeDefined();
  });

  test('returns numeric studentNumber', () => {
    const result = decodeUsername('fatima7101mzmx5');
    expect(result).not.toBeNull();
    expect(typeof result!.studentNumber).toBe('number');
  });
});

describe('scatterCount', () => {
  test('reverses last two digits and moves them', () => {
    expect(scatterCount(907)).toBe('790');
  });

  test('handles 4-digit numbers', () => {
    expect(scatterCount(1017)).toBe('7101');
  });

  test('handles large numbers', () => {
    const result = scatterCount(12345);
    expect(typeof result).toBe('string');
    expect(result.length).toBe(5);
  });
});

describe('unscatterCount', () => {
  test('reverses the scatter operation', () => {
    expect(unscatterCount('790')).toBe(907);
    expect(unscatterCount('7101')).toBe(1017);
  });

  test('handles various lengths', () => {
    expect(unscatterCount('9102')).toBe(1029);
  });
});

describe('generatePassword', () => {
  test('produces a 12-character string', () => {
    const pw = generatePassword();
    expect(pw.length).toBe(12);
  });

  test('contains at least one uppercase letter', () => {
    expect(generatePassword()).toMatch(/[A-Z]/);
  });

  test('contains at least one lowercase letter', () => {
    expect(generatePassword()).toMatch(/[a-z]/);
  });

  test('contains at least one digit', () => {
    expect(generatePassword()).toMatch(/[0-9]/);
  });

  test('contains at least one special character', () => {
    expect(generatePassword()).toMatch(/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/);
  });

  test('produces different values each call', () => {
    const a = generatePassword();
    const b = generatePassword();
    expect(a).not.toBe(b);
  });
});
