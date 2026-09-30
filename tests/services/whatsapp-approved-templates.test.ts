/**
 * M19.1 — Approved WhatsApp Template Mapping Regression Tests
 *
 * Locks the currently approved production layouts:
 *   teacher_wc → 4 vars: [teacherName, website, username, password]
 *   staff_wc   → 5 vars: [designation, staffName, website, username, password]
 *   student_wc → 5 vars: [studentName, class, website, username, password]
 *
 * Every test below is a dry run: fetch (the provider send) is mocked and
 * negative tests assert it is NEVER called. No real WhatsApp message can
 * be sent from this suite. Synthetic values only.
 */

// ─── Env mock ──────────────────────────────────────────────
const envMock: Record<string, string> = {
  TWILIO_ACCOUNT_SID: 'ACtest123',
  TWILIO_AUTH_TOKEN: 'auth_token_test',
  TWILIO_WHATSAPP_FROM: '14155551234',
  TWILIO_TEMPLATE_STUDENT: 'HXstudent_test_sid',
  TWILIO_TEMPLATE_TEACHER: 'HXteacher_test_sid',
  TWILIO_TEMPLATE_STAFF: 'HXstaff_test_sid',
  FRONTEND_URL: 'https://example.invalid',
  JWT_SECRET: 'test-jwt-secret-at-least-32-chars-long!!!!!!!!',
};

jest.mock('../../src/config/env', () => ({
  __esModule: true,
  default: new Proxy(
    {},
    {
      get(_target, prop: string) {
        return envMock[prop] ?? '';
      },
    },
  ),
}));

jest.mock('../../src/lib/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  sendTemplateMessage,
  buildTeacherParameters,
  buildStaffParameters,
  buildStudentParameters,
  formatClassLabel,
  TEMPLATE_VARIABLE_COUNTS,
  type TwilioTemplateParameter,
} from '../../src/services/twilio-whatsapp.service';
import { deliverCredential } from '../../src/services/credential-delivery.service';

const txt = (text: string): TwilioTemplateParameter => ({ type: 'text', text });

function mockFetchSuccess() {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ sid: 'SMtest123', status: 'queued' }),
  }) as any;
}

const originalFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  envMock.TWILIO_ACCOUNT_SID = 'ACtest123';
  envMock.TWILIO_AUTH_TOKEN = 'auth_token_test';
  envMock.TWILIO_WHATSAPP_FROM = '14155551234';
  envMock.TWILIO_TEMPLATE_STUDENT = 'HXstudent_test_sid';
  envMock.TWILIO_TEMPLATE_TEACHER = 'HXteacher_test_sid';
  envMock.TWILIO_TEMPLATE_STAFF = 'HXstaff_test_sid';
  envMock.FRONTEND_URL = 'https://example.invalid';
  global.fetch = jest.fn() as any; // default: record calls, never send
});

afterEach(() => {
  global.fetch = originalFetch;
});

// ─── Positive: exact approved layouts ──────────────────────

describe('M19.1 — approved template layouts', () => {
  test('TEMPLATE_VARIABLE_COUNTS declares the approved 4/5/5 contract', () => {
    expect(TEMPLATE_VARIABLE_COUNTS).toEqual({ teacher: 4, staff: 5, student: 5 });
  });

  test('teacher_wc produces exactly [Teacher, website, USER, PASS]', () => {
    const params = buildTeacherParameters({
      name: 'Teacher',
      website: 'https://example.invalid',
      username: 'USER',
      password: 'PASS',
    });
    expect(params).toHaveLength(4);
    expect(params.map((p) => p.text)).toEqual([
      'Teacher',
      'https://example.invalid',
      'USER',
      'PASS',
    ]);
  });

  test('staff_wc produces exactly [Teacher, Staff Member, website, USER, PASS]', () => {
    const params = buildStaffParameters({
      designation: 'Teacher',
      name: 'Staff Member',
      website: 'https://example.invalid',
      username: 'USER',
      password: 'PASS',
    });
    expect(params).toHaveLength(5);
    expect(params.map((p) => p.text)).toEqual([
      'Teacher',
      'Staff Member',
      'https://example.invalid',
      'USER',
      'PASS',
    ]);
  });

  test('student_wc produces exactly [Student, Grade 5, website, USER, PASS]', () => {    const params = buildStudentParameters({
      name: 'Student',
      className: 'Grade 5',
      website: 'https://example.invalid',
      username: 'USER',
      password: 'PASS',
    });
    expect(params).toHaveLength(5);
    expect(params.map((p) => p.text)).toEqual([
      'Student',
      'Grade 5',
      'https://example.invalid',
      'USER',
      'PASS',
    ]);
  });
});

// ─── Positive: ContentVariables wire format (mocked send) ──

describe('M19.1 — provider payload wire format', () => {
  function contentVariablesOfMock(): Record<string, string> {
    const callArgs = (global.fetch as jest.Mock).mock.calls[0];
    const body: string = callArgs[1].body;
    const rawVars = body.split('ContentVariables=')[1].split('&')[0];
    return JSON.parse(decodeURIComponent(rawVars));
  }

  test('teacher_wc sends ContentVariables {"1".."4"} with no fifth slot', async () => {
    mockFetchSuccess();
    await sendTemplateMessage({
      to: '03001234567',
      recipientType: 'teacher',
      bodyParameters: buildTeacherParameters({
        name: '[TEACHER_NAME]',
        website: 'https://example.invalid',
        username: '[USERNAME]',
        password: '[PASSWORD]',
      }),
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(contentVariablesOfMock()).toEqual({
      1: '[TEACHER_NAME]',
      2: 'https://example.invalid',
      3: '[USERNAME]',
      4: '[PASSWORD]',
    });
  });

  test('staff_wc sends ContentVariables {"1".."5"} in approved order', async () => {
    mockFetchSuccess();
    await sendTemplateMessage({
      to: '03001234567',
      recipientType: 'staff',
      bodyParameters: buildStaffParameters({
        designation: '[DESIGNATION]',
        name: '[STAFF_NAME]',
        website: 'https://example.invalid',
        username: '[USERNAME]',
        password: '[PASSWORD]',
      }),
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(contentVariablesOfMock()).toEqual({
      1: '[DESIGNATION]',
      2: '[STAFF_NAME]',
      3: 'https://example.invalid',
      4: '[USERNAME]',
      5: '[PASSWORD]',
    });
  });

  test('student_wc sends ContentVariables {"1".."5"} in approved order', async () => {
    mockFetchSuccess();
    await sendTemplateMessage({
      to: '03001234567',
      recipientType: 'student',
      bodyParameters: buildStudentParameters({
        name: '[STUDENT_NAME]',
        className: '[CLASS]',
        website: 'https://example.invalid',
        username: '[USERNAME]',
        password: '[PASSWORD]',
      }),
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(contentVariablesOfMock()).toEqual({
      1: '[STUDENT_NAME]',
      2: '[CLASS]',
      3: 'https://example.invalid',
      4: '[USERNAME]',
      5: '[PASSWORD]',
    });
  });

  test('From is always whatsapp:+<sender> (no silent omission)', async () => {
    mockFetchSuccess();
    await sendTemplateMessage({
      to: '03001234567',
      recipientType: 'teacher',
      bodyParameters: buildTeacherParameters({
        name: 'T',
        website: 'https://example.invalid',
        username: 'U',
        password: 'P',
      }),
    });
    const body: string = (global.fetch as jest.Mock).mock.calls[0][1].body;
    expect(body).toContain('From=whatsapp%3A%2B14155551234');
  });
});

// ─── Negative: count guard fails closed, no outbound call ──

describe('M19.1 — variable count guard (no outbound call on mismatch)', () => {
  test.each([
    ['teacher with 5 variables (old shared-builder shape)', 'teacher', 5],
    ['teacher with 3 variables', 'teacher', 3],
    ['staff with 4 variables', 'staff', 4],
    ['staff with 6 variables', 'staff', 6],
    ['student with 4 variables', 'student', 4],
    ['student with 6 variables', 'student', 6],
  ])('%s fails closed', async (_label, recipientType, count) => {
    await expect(
      sendTemplateMessage({
        to: '03001234567',
        recipientType: recipientType as 'teacher' | 'staff' | 'student',
        bodyParameters: Array.from({ length: count as number }, (_, i) => txt(`V${i + 1}`)),
      }),
    ).rejects.toMatchObject({ code: 'template_mismatch' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('empty variable fails closed', async () => {
    await expect(
      sendTemplateMessage({
        to: '03001234567',
        recipientType: 'student',
        bodyParameters: [txt('S'), txt('C'), txt('W'), txt('U'), txt('  ')],
      }),
    ).rejects.toMatchObject({ code: 'template_mismatch' });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ─── Negative: missing semantic inputs ─────────────────────

describe('M19.1 — missing designation / class fail closed', () => {
  test('staff builder throws when designation is missing', () => {
    expect(() =>
      buildStaffParameters({
        designation: '',
        name: 'Staff Member',
        website: 'https://example.invalid',
        username: 'USER',
        password: 'PASS',
      }),
    ).toThrow(expect.objectContaining({ code: 'template_mismatch' }));
  });

  test('student builder throws when class is missing', () => {
    expect(() =>
      buildStudentParameters({
        name: 'Student',
        className: '   ',
        website: 'https://example.invalid',
        username: 'USER',
        password: 'PASS',
      }),
    ).toThrow(expect.objectContaining({ code: 'template_mismatch' }));
  });

  test('deliverCredential(staff) without designation fails without provider call', async () => {
    const result = await deliverCredential({
      to: '03001234567',
      username: 'USER',
      password: 'PASS',
      name: 'Staff Member',
      recipientType: 'staff',
    });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('template_mismatch');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('deliverCredential(student) without className fails without provider call', async () => {
    const result = await deliverCredential({
      to: '03001234567',
      username: 'USER',
      password: 'PASS',
      name: 'Student',
      recipientType: 'student',
    });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('template_mismatch');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('deliverCredential(staff/student) with values succeeds (mocked provider)', async () => {
    mockFetchSuccess();
    const staff = await deliverCredential({
      to: '03001234567',
      username: 'USER',
      password: 'PASS',
      name: 'Staff Member',
      recipientType: 'staff',
      designation: 'Accountant',
    });
    const student = await deliverCredential({
      to: '03001234567',
      username: 'USER',
      password: 'PASS',
      name: 'Student',
      recipientType: 'student',
      className: 'Grade 5',
    });
    expect(staff.success).toBe(true);
    expect(student.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

// ─── Negative: missing config / bad recipient ──────────────

describe('M19.1 — config and recipient guards', () => {
  test('missing template SID fails closed without provider call', async () => {
    envMock.TWILIO_TEMPLATE_TEACHER = '';
    await expect(
      sendTemplateMessage({
        to: '03001234567',
        recipientType: 'teacher',
        bodyParameters: buildTeacherParameters({
          name: 'T',
          website: 'https://example.invalid',
          username: 'U',
          password: 'P',
        }),
      }),
    ).rejects.toMatchObject({ code: 'config_missing' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('missing TWILIO_WHATSAPP_FROM fails closed without provider call', async () => {
    envMock.TWILIO_WHATSAPP_FROM = '';
    await expect(
      sendTemplateMessage({
        to: '03001234567',
        recipientType: 'teacher',
        bodyParameters: buildTeacherParameters({
          name: 'T',
          website: 'https://example.invalid',
          username: 'U',
          password: 'P',
        }),
      }),
    ).rejects.toMatchObject({ code: 'config_missing' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('invalid recipient number fails closed without provider call', async () => {
    await expect(
      sendTemplateMessage({
        to: 'not-a-number!!!',
        recipientType: 'teacher',
        bodyParameters: buildTeacherParameters({
          name: 'T',
          website: 'https://example.invalid',
          username: 'U',
          password: 'P',
        }),
      }),
    ).rejects.toMatchObject({ code: 'invalid_phone' });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ─── student_wc {{2}} class-label formatting (option a) ───
// The approved body prints "admission in Class {{2}}", so one leading
// "Class" is stripped from the group name to avoid "Class Class 3".

describe('M19.1 — class label formatting', () => {
  test('strips leading "Class" and appends section', () => {
    expect(formatClassLabel('Class 3', 'A')).toBe('3 - A');
  });

  test('strips case-insensitively without section', () => {
    expect(formatClassLabel('class 10', null)).toBe('10');
  });

  test('leaves names without the prefix untouched', () => {
    expect(formatClassLabel('Playgroup', null)).toBe('Playgroup');
  });

  test('does not strip mid-string occurrences', () => {
    expect(formatClassLabel('Classroom Juniors', 'B')).toBe('Classroom Juniors - B');
  });
});
