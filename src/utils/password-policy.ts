/**
 * Shared credential password policy (M22 §14).
 *
 * The manual-flow generators (web crypto.getRandomValues) always produce
 * 12-char passwords with upper+lower+digit+special. The backend re-validates
 * the contract so a crafted request cannot bypass the UI with a weak password.
 * Applied to the Student/Teacher/Staff save-credential endpoints. Legacy
 * set-password routes are untouched (their migration owns that hardening).
 */

const MIN_LENGTH = 12;
const SPECIAL = '!@#$%^&*()_+-=[]{}|;:,.<>?';

export function passwordPolicyError(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < MIN_LENGTH) {
    return `Password must be at least ${MIN_LENGTH} characters.`;
  }
  if (!/[A-Z]/.test(password)) return 'Password must include an uppercase letter.';
  if (!/[a-z]/.test(password)) return 'Password must include a lowercase letter.';
  if (!/[0-9]/.test(password)) return 'Password must include a digit.';
  if (![...password].some((ch) => SPECIAL.includes(ch))) {
    return 'Password must include a special character.';
  }
  return null;
}

/** Throw a 400 shaped like other service errors when the policy fails. */
export function assertPasswordPolicy(password: unknown): void {
  const reason = passwordPolicyError(password);
  if (reason) throw { status: 400, code: 'WEAK_PASSWORD', message: reason };
}
