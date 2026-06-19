/**
 * Username Encoder / Decoder / Generator
 * ======================================
 *
 * Generates opaque-but-deterministic student usernames using a
 * multi-step transformation that is NOT obvious to a casual observer.
 *
 * Username Pattern:
 *   <firstName><scatteredCount><rollLetters><yearLastDigit>
 *
 * Example: 907th student, Roll 012, Year 2026
 *   → ali + 790 + zmp + 6  =  ali790zmp6
 *
 * ============================================================================
 * STEP 1 — Scatter the total student count
 * ============================================================================
 * The total number of students in the system is "scattered" so the
 * count is not obvious.
 *
 * Rule:
 *   - Reverse the last 2 digits of the count
 *   - Take the remaining prefix (first n-2 digits) as-is
 *   - Combine: first_element_of_reversed + prefix + second_element_of_reversed
 *
 * Examples:
 *   Count 907  (3 digits)
 *     → last two "07" reversed = [7, 0]
 *     → prefix = [9]
 *     → combine = [7] + [9] + [0] = "790"
 *
 *   Count 1017 (4 digits)
 *     → last two "17" reversed = [7, 1]
 *     → prefix = [1, 0]
 *     → combine = [7] + [1, 0] + [1] = "7101"
 *
 * ============================================================================
 * STEP 2 — Encode roll number as letters
 * ============================================================================
 * Each digit (0-9) maps to a random unique letter. The mapping is
 * fixed and arbitrary — there is NO sequential pattern to guess.
 *
 *   Digit:  0   1   2   3   4   5   6   7   8   9
 *   Letter: z   m   p   w   q   t   v   x   r   k
 *
 *   Roll 012 → z + m + p = "zmp"
 *   Roll 144 → m + q + q = "mqq"
 *   Roll 050 → z + t + z = "ztz"
 *
 * ============================================================================
 * STEP 3 — Assemble username
 * ============================================================================
 *   <firstName_lowercase> + <scatteredCount> + <rollLetters> + <yearLastDigit>
 *
 * Example:
 *   907th student, Roll 012, Year 2026, Name "Ali"
 *     → scattered(907) = "790"
 *     → rollToLetters("012") = "zmp"
 *     → year last digit = "6"
 *     → ali + 790 + zmp + 6 = "ali790zmp6"
 *
 * ============================================================================
 * DECODING (for admin reference)
 * ============================================================================
 * Given username "ali790zmp6", the admin can decode:
 *   1. Strip firstName prefix → extract "790zmp6"
 *   2. The numeric part (790) is the scattered count
 *      → reverse: rev[0]=7, rest=90, rev[1]=0 → unscatter: 9 + 0 + 7 = 907
 *   3. The letter part (zmp) decodes via reverse map
 *      → z→0, m→1, p→2 → roll = 012
 *   4. Last digit (6) = year 2026
 */

// ─── Digit-to-Letter mapping (random, no sequential pattern) ──────
const DIGIT_TO_LETTER: Record<string, string> = {
  '0': 'z',
  '1': 'm',
  '2': 'p',
  '3': 'w',
  '4': 'q',
  '5': 't',
  '6': 'v',
  '7': 'x',
  '8': 'r',
  '9': 'k',
};

// ─── Reverse mapping (letter → digit, for decoding) ──────────────
const LETTER_TO_DIGIT: Record<string, string> = {};
for (const [digit, letter] of Object.entries(DIGIT_TO_LETTER)) {
  LETTER_TO_DIGIT[letter] = digit;
}

/**
 * Generate a random password (12 chars, UTF-8 safe)
 * Used as initial password when creating student credentials.
 */
export function generatePassword(): string {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const digits = '0123456789';
  const special = '!@#$%^&*()_+-=[]{}|;:,.<>?';
  const all = upper + lower + digits + special;

  let pw = '';
  // Ensure at least one of each type
  pw += upper[Math.floor(Math.random() * upper.length)];
  pw += lower[Math.floor(Math.random() * lower.length)];
  pw += digits[Math.floor(Math.random() * digits.length)];
  pw += special[Math.floor(Math.random() * special.length)];

  for (let i = 0; i < 8; i++) {
    pw += all[Math.floor(Math.random() * all.length)];
  }

  // Shuffle using Fisher-Yates
  const arr = pw.split('');
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr.join('');
}

/**
 * Scatter the student count so it's not obvious:
 *   - Reverse last 2 digits
 *   - Prefix first n-2 digits
 *   - Combine: rev[0] + prefix + rev[1]
 *
 * Examples:
 *   907  → "790"
 *   1017 → "7101"
 *   42   → "24"       (2-digit: no prefix, just reverse)
 *   8    → "8"        (1-digit: unchanged)
 */
export function scatterCount(count: number): string {
  const s = count.toString();
  if (s.length <= 1) return s;

  const reversedLastTwo = s.slice(-2).split('').reverse(); // last 2 reversed
  const prefix = s.slice(0, -2); // everything before last 2

  // Combine: first of reversed + prefix + second of reversed
  return reversedLastTwo[0] + prefix + (reversedLastTwo[1] || '');
}

/**
 * Reverse of scatterCount — reconstruct original count from scattered form.
 * Admin use only (rarely needed).
 *
 * Examples:
 *   "790"  → 907
 *   "7101" → 1017
 *   "24"   → 42
 */
export function unscatterCount(scattered: string): number {
  if (scattered.length <= 1) return parseInt(scattered, 10);

  const first = scattered[0];           // rev[0]
  const last = scattered[scattered.length - 1]; // rev[1]
  const middle = scattered.slice(1, -1); // original prefix

  // Reconstruct: prefix + reverse(last + first)
  const originalLastTwo = last + first;
  return parseInt(middle + originalLastTwo, 10);
}

/**
 * Encode a roll number (string of digits) into 3 letters.
 *
 * Each digit maps to a fixed random letter:
 *   0→z  1→m  2→p  3→w  4→q  5→t  6→v  7→x  8→r  9→k
 *
 * Examples:
 *   "012" → "zmp"
 *   "144" → "mqq"
 *   "001" → "zzm"
 *
 * Supports 1-4 digit roll numbers. If roll has fewer than 3 digits,
 * it's zero-padded on the left before encoding so output is always
 * exactly 3 characters.
 */
export function rollToLetters(roll: string): string {
  // Zero-pad to 3 digits (roll "12" → "012")
  const padded = roll.padStart(3, '0');
  // Map each digit to its letter
  return padded
    .split('')
    .map(d => DIGIT_TO_LETTER[d] || d) // fallback: keep original char
    .join('');
}

/**
 * Decode 3 letters back to roll number digits.
 * Admin use only (rarely needed).
 *
 * Examples:
 *   "zmp" → "012"
 *   "mqq" → "144"
 */
export function lettersToRoll(letters: string): string {
  return letters
    .split('')
    .map(l => LETTER_TO_DIGIT[l] || l)
    .join('')
    .replace(/^0+/, '') || '0'; // remove leading zeros, "012" → "12"
}

/**
 * Generate a full username.
 *
 * The username encodes the studentNumber TWICE (scattered + letter-encoded)
 * with the admission year appended, making it hard to reverse-engineer.
 *
 * Pattern: <firstName><scatteredStudentNumber><studentNumberLetters><admissionYearLast>
 *
 * @param firstName - Student's first name (lowercased, non-alphanumeric stripped)
 * @param studentNumber - Permanent sequential number assigned on admission
 * @param admissionYear - Year the student was admitted (e.g., 2026)
 * @returns Generated username string
 *
 * Example:
 *   generateUsername("Ali", 907, 2026)
 *   → ali + 790 + kzx + 6
 *   → "ali790kzx6"
 */
export function generateUsername(
  firstName: string,
  studentNumber: number,
  admissionYear: number,
): string {
  // Sanitize name: lowercase, strip non-alphanumeric
  const cleanName = firstName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

  const scattered = scatterCount(studentNumber);
  const numberLetters = rollToLetters(studentNumber.toString());
  const yearLastDigit = admissionYear.toString().slice(-1);

  return `${cleanName}${scattered}${numberLetters}${yearLastDigit}`;
}

/**
 * Decode a username back into its components (admin reference).
 *
 * Example:
 *   decodeUsername("ali790kzx6")
 *   → { firstName: "ali", studentNumber: 907, admissionYearLastDigit: "6" }
 */
export function decodeUsername(username: string): {
  firstName: string;
  studentNumber: number;
  admissionYearLastDigit: string;
} | null {
  try {
    const match = username.match(/^([a-z]+)(\d+)([a-z]+)(\d)$/);
    if (!match) return null;

    const firstName = match[1];
    const scattered = match[2];
    const numberLetters = match[3];
    const yearLastDigit = match[4];

    const studentNumber = unscatterCount(scattered);

    return { firstName, studentNumber, admissionYearLastDigit: yearLastDigit };
  } catch {
    return null;
  }
}
