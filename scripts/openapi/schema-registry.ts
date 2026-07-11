/**
 * Maps HTTP operations to request/response schema component names.
 * Keys: "METHOD /path" (OpenAPI-normalized path with {param} style).
 */
export interface OperationSpec {
  /** Component schema name for requestBody */
  requestBody?: string;
  /** Component schema name for 200/201 response body */
  response?: string;
  /** HTTP status for success response (default 200) */
  successStatus?: number;
  /** Extra query parameters beyond auto-detected branchId/academicYearId */
  queryParams?: Array<{ name: string; schema: string; required?: boolean; description?: string }>;
  /** Human-readable summary override */
  summary?: string;
  /** Skip default branchId/academicYearId query params */
  skipAdminScope?: boolean;
}

export type OperationRegistry = Record<string, OperationSpec>;

/** Explicit per-operation overrides (highest priority). */
export const OPERATION_REGISTRY: OperationRegistry = {
  // ─── Auth ────────────────────────────────────────────────────────
  'POST /auth/login': {
    requestBody: 'LoginRequest',
    response: 'LoginResponse',
    summary: 'Login with username, email, or phone',
    skipAdminScope: true,
  },
  'PUT /auth/password': {
    requestBody: 'ChangePasswordRequest',
    response: 'MessageResponse',
    summary: 'Change password for current user',
    skipAdminScope: true,
  },
  'GET /auth/me': {
    response: 'AuthUserResponse',
    summary: 'Get current authenticated user',
    skipAdminScope: true,
  },
  'POST /auth/refresh': {
    response: 'LoginResponse',
    summary: 'Refresh JWT token',
    skipAdminScope: true,
  },
  'POST /auth/logout': {
    response: 'MessageResponse',
    summary: 'Logout and clear session',
    skipAdminScope: true,
  },

  // ─── Students ────────────────────────────────────────────────────
  'GET /admin/students': {
    response: 'StudentListResponse',
    summary: 'List students with search and pagination',
    queryParams: [
      { name: 'search', schema: 'string', description: 'Search by name or admission number' },
      { name: 'groupId', schema: 'string', description: 'Filter by class/group' },
      { name: 'rollNumber', schema: 'string', description: 'Filter by roll number' },
      { name: 'page', schema: 'integer', description: 'Page number (default 1)' },
      { name: 'limit', schema: 'integer', description: 'Page size (default 20)' },
    ],
  },
  'GET /admin/students/{id}': {
    response: 'StudentDetailResponse',
    summary: 'Get student detail',
  },
  'POST /admin/students': {
    requestBody: 'CreateStudentRequest',
    response: 'StudentDetailResponse',
    successStatus: 201,
    summary: 'Create a new student',
  },
  'PUT /admin/students/{id}': {
    requestBody: 'UpdateStudentRequest',
    response: 'StudentDetailResponse',
    summary: 'Update student profile',
  },
  'POST /admin/students/{id}/emergency-contact': {
    requestBody: 'EmergencyContactRequest',
    response: 'GenericDataResponse',
    successStatus: 201,
    summary: 'Add emergency contact',
  },
  'PUT /admin/students/{id}/emergency-contact/{contactId}': {
    requestBody: 'EmergencyContactRequest',
    response: 'GenericDataResponse',
    summary: 'Update emergency contact',
  },
  'PUT /admin/students/{id}/health-record': {
    requestBody: 'HealthRecordRequest',
    response: 'GenericDataResponse',
    summary: 'Upsert student health record',
  },
  'POST /admin/students/{id}/parents': {
    requestBody: 'LinkParentRequest',
    response: 'GenericDataResponse',
    successStatus: 201,
    summary: 'Link parent to student',
  },
  'PUT /admin/students/{id}/status': {
    requestBody: 'SetStudentStatusRequest',
    response: 'StudentDetailResponse',
    summary: 'Change student status',
  },
  'PUT /admin/students/{id}/set-password': {
    requestBody: 'SetPasswordRequest',
    response: 'MessageResponse',
    summary: 'Set student portal password',
  },

  // ─── Academic year ───────────────────────────────────────────────
  'POST /admin/branches/{branchId}/academic-years': {
    requestBody: 'CreateAcademicYearRequest',
    response: 'AcademicYearDetailResponse',
    successStatus: 201,
    summary: 'Create academic year for branch',
    skipAdminScope: true,
  },
  'GET /admin/branches/{branchId}/academic-years': {
    response: 'AcademicYearListResponse',
    summary: 'List academic years for branch',
    skipAdminScope: true,
    queryParams: [
      { name: 'status', schema: 'string', description: 'Filter by status (BUILD_STAGE, ACTIVE, etc.)' },
    ],
  },
  'GET /admin/branches/{branchId}/academic-years/{id}': {
    response: 'AcademicYearDetailResponse',
    summary: 'Get academic year detail',
    skipAdminScope: true,
  },
  'PUT /admin/branches/{branchId}/academic-years/{id}': {
    requestBody: 'UpdateAcademicYearRequest',
    response: 'AcademicYearDetailResponse',
    summary: 'Update academic year',
    skipAdminScope: true,
  },
  'PATCH /admin/branches/{branchId}/academic-years/{id}/unarchive': {
    requestBody: 'UnarchiveAcademicYearRequest',
    response: 'AcademicYearDetailResponse',
    summary: 'Restore archived academic year',
    skipAdminScope: true,
  },
  'DELETE /admin/branches/{branchId}/academic-years/{id}': {
    requestBody: 'DeleteAcademicYearRequest',
    response: 'MessageResponse',
    summary: 'Delete archived academic year',
    skipAdminScope: true,
  },
  'POST /admin/branches/{branchId}/academic-years/{ayId}/members': {
    requestBody: 'AddAcademicYearMemberRequest',
    response: 'GenericDataResponse',
    successStatus: 201,
    summary: 'Add member to academic year',
    skipAdminScope: true,
  },

  // ─── Fees ────────────────────────────────────────────────────────
  'GET /admin/fee-heads': {
    response: 'GenericDataListResponse',
    summary: 'List all fee heads',
  },
  'POST /admin/fee-heads': {
    requestBody: 'CreateFeeHeadRequest',
    response: 'GenericDataResponse',
    successStatus: 201,
    summary: 'Create fee head',
  },
  'PUT /admin/fee-heads/{id}': {
    requestBody: 'UpdateFeeHeadRequest',
    response: 'GenericDataResponse',
    summary: 'Update fee head',
  },
  'GET /admin/fee-structures': {
    response: 'GenericDataListResponse',
    summary: 'List fee structures for academic year',
    queryParams: [
      { name: 'groupId', schema: 'string', description: 'Filter by class/group' },
    ],
  },
  'POST /admin/fee-structures': {
    requestBody: 'CreateFeeStructureRequest',
    response: 'GenericDataResponse',
    successStatus: 201,
    summary: 'Create or update fee structure',
  },
  'POST /admin/fee-structures/update-amount': {
    requestBody: 'UpdateFeeStructureAmountRequest',
    response: 'GenericDataResponse',
    summary: 'Update fee structure amount',
  },
  'POST /admin/student-fees/generate': {
    requestBody: 'GenerateStudentFeesRequest',
    response: 'GenericDataResponse',
    summary: 'Generate monthly student fees',
  },
  'POST /admin/payments': {
    requestBody: 'RecordPaymentRequest',
    response: 'GenericDataResponse',
    successStatus: 201,
    summary: 'Record a payment against a student fee',
  },
  'POST /admin/payments/allocate': {
    requestBody: 'AllocatePaymentRequest',
    response: 'GenericDataResponse',
    successStatus: 201,
    summary: 'Record payment with head allocations',
  },
  'PUT /admin/students/{id}/custom-fee': {
    requestBody: 'CustomFeeRequest',
    response: 'GenericDataResponse',
    summary: 'Set per-student custom fee or head overrides',
  },
  'POST /admin/student-fees/{id}/extra-items': {
    requestBody: 'FeeExtraItemRequest',
    response: 'GenericDataResponse',
    successStatus: 201,
    summary: 'Add extra fee item to student fee',
  },
  'GET /admin/student-fees': {
    response: 'GenericDataListResponse',
    summary: 'List student fees',
    queryParams: [
      { name: 'month', schema: 'integer' },
      { name: 'year', schema: 'integer' },
      { name: 'groupId', schema: 'string' },
      { name: 'status', schema: 'string' },
    ],
  },
  'GET /admin/payments': {
    response: 'GenericDataListResponse',
    summary: 'List payments',
    queryParams: [
      { name: 'studentId', schema: 'string' },
      { name: 'from', schema: 'string', description: 'ISO date' },
      { name: 'to', schema: 'string', description: 'ISO date' },
    ],
  },

  // ─── Branches & calendars ────────────────────────────────────────
  'POST /admin/branches': {
    requestBody: 'CreateBranchRequest',
    response: 'GenericDataResponse',
    successStatus: 201,
    summary: 'Create branch',
    skipAdminScope: true,
  },
  'PUT /admin/branches/{id}': {
    requestBody: 'UpdateBranchRequest',
    response: 'GenericDataResponse',
    summary: 'Update branch',
    skipAdminScope: true,
  },
  'GET /admin/branches': {
    response: 'GenericDataListResponse',
    summary: 'List branches',
    skipAdminScope: true,
  },
  'GET /admin/branches/{id}': {
    response: 'GenericDataResponse',
    summary: 'Get branch detail',
    skipAdminScope: true,
  },
  'POST /admin/calendars': {
    requestBody: 'CreateCalendarRequest',
    response: 'GenericDataResponse',
    successStatus: 201,
    summary: 'Create academic calendar',
    skipAdminScope: true,
  },
  'PUT /admin/calendars/{id}': {
    requestBody: 'UpdateCalendarRequest',
    response: 'GenericDataResponse',
    summary: 'Update academic calendar',
    skipAdminScope: true,
  },

  // ─── Subjects & exams ────────────────────────────────────────────
  'POST /admin/branches/{branchId}/academic-years/{ayId}/subjects': {
    requestBody: 'CreateSubjectRequest',
    response: 'GenericDataResponse',
    successStatus: 201,
    summary: 'Create subject',
    skipAdminScope: true,
  },
  'PUT /admin/branches/{branchId}/subjects/{id}': {
    requestBody: 'UpdateSubjectRequest',
    response: 'GenericDataResponse',
    summary: 'Update subject',
    skipAdminScope: true,
  },
  'POST /admin/sessions/{sessionId}/exams': {
    requestBody: 'CreateExamRequest',
    response: 'GenericDataResponse',
    successStatus: 201,
    summary: 'Create exam in session',
  },
  'PATCH /admin/exams/{examId}': {
    requestBody: 'UpdateExamRequest',
    response: 'GenericDataResponse',
    summary: 'Update exam',
  },

  // ─── Teachers & assignments ──────────────────────────────────────
  'POST /admin/teachers': {
    requestBody: 'CreateTeacherRequest',
    response: 'GenericDataResponse',
    successStatus: 201,
    summary: 'Create teacher profile',
  },
  'PUT /admin/teachers/{id}': {
    requestBody: 'UpdateTeacherRequest',
    response: 'GenericDataResponse',
    summary: 'Update teacher profile',
  },
  'POST /admin/assignments': {
    requestBody: 'CreateAssignmentRequest',
    response: 'GenericDataResponse',
    successStatus: 201,
    summary: 'Create teacher assignment',
  },
  'PUT /admin/assignments/{id}': {
    requestBody: 'UpdateAssignmentRequest',
    response: 'GenericDataResponse',
    summary: 'Update teacher assignment',
  },

  // ─── Exam sessions & types ───────────────────────────────────────
  'POST /admin/exam-sessions': {
    requestBody: 'CreateExamSessionRequest',
    response: 'GenericDataResponse',
    successStatus: 201,
    summary: 'Create exam session',
  },
  'PATCH /admin/exam-sessions/{sessionId}': {
    requestBody: 'UpdateExamSessionRequest',
    response: 'GenericDataResponse',
    summary: 'Update exam session',
  },
  'GET /admin/exam-sessions': {
    response: 'GenericDataListResponse',
    summary: 'List exam sessions',
  },
  'POST /admin/sessions/{sessionId}/types': {
    requestBody: 'CreateExamTypeRequest',
    response: 'GenericDataResponse',
    successStatus: 201,
    summary: 'Create exam type',
  },
  'PATCH /admin/sessions/{sessionId}/types/{typeId}': {
    requestBody: 'UpdateExamTypeRequest',
    response: 'GenericDataResponse',
    summary: 'Update exam type',
  },

  // ─── Sections ────────────────────────────────────────────────────
  'POST /admin/branches/{branchId}/academic-years/{ayId}/sections': {
    requestBody: 'CreateSectionRequest',
    response: 'GenericDataResponse',
    successStatus: 201,
    summary: 'Create section',
    skipAdminScope: true,
  },
  'PUT /admin/branches/{branchId}/sections/{id}': {
    requestBody: 'UpdateSectionRequest',
    response: 'GenericDataResponse',
    summary: 'Update section',
    skipAdminScope: true,
  },

  // ─── Attendance ──────────────────────────────────────────────────
  'POST /admin/attendance/batch': {
    requestBody: 'BatchAttendanceRequest',
    response: 'GenericDataResponse',
    summary: 'Batch mark student attendance',
  },

  // ─── Family payments ─────────────────────────────────────────────
  'POST /admin/family-payments': {
    requestBody: 'RecordFamilyPaymentRequest',
    response: 'GenericDataResponse',
    successStatus: 201,
    summary: 'Record family payment',
  },
};

/**
 * Convention-based rules applied when no explicit registry entry exists.
 * Matched in order; first match wins.
 */
export interface CrudRule {
  method: string;
  pathPattern: RegExp;
  requestBody?: string;
  response?: string;
  successStatus?: number;
}

export const CRUD_RULES: CrudRule[] = [
  { method: 'post', pathPattern: /^\/admin\/students$/, requestBody: 'CreateStudentRequest', response: 'StudentDetailResponse', successStatus: 201 },
  { method: 'put', pathPattern: /^\/admin\/students\/\{id\}$/, requestBody: 'UpdateStudentRequest', response: 'StudentDetailResponse' },
  { method: 'get', pathPattern: /^\/admin\/students\/\{id\}$/, response: 'StudentDetailResponse' },
  { method: 'get', pathPattern: /^\/admin\/students$/, response: 'StudentListResponse' },
  { method: 'post', pathPattern: /^\/admin\/fee-heads$/, requestBody: 'CreateFeeHeadRequest', response: 'GenericDataResponse', successStatus: 201 },
  { method: 'put', pathPattern: /^\/admin\/fee-heads\/\{id\}$/, requestBody: 'UpdateFeeHeadRequest', response: 'GenericDataResponse' },
  { method: 'post', pathPattern: /^\/admin\/fee-structures$/, requestBody: 'CreateFeeStructureRequest', response: 'GenericDataResponse', successStatus: 201 },
  { method: 'post', pathPattern: /^\/admin\/payments$/, requestBody: 'RecordPaymentRequest', response: 'GenericDataResponse', successStatus: 201 },
  { method: 'post', pathPattern: /^\/admin\/student-fees\/generate$/, requestBody: 'GenerateStudentFeesRequest', response: 'GenericDataResponse' },
  { method: 'post', pathPattern: /^\/admin\/branches\/\{branchId\}\/academic-years$/, requestBody: 'CreateAcademicYearRequest', response: 'AcademicYearDetailResponse', successStatus: 201 },
  { method: 'put', pathPattern: /^\/admin\/branches\/\{branchId\}\/academic-years\/\{id\}$/, requestBody: 'UpdateAcademicYearRequest', response: 'AcademicYearDetailResponse' },
  { method: 'get', pathPattern: /^\/admin\/branches\/\{branchId\}\/academic-years$/, response: 'AcademicYearListResponse' },
  { method: 'get', pathPattern: /^\/admin\/branches\/\{branchId\}\/academic-years\/\{id\}$/, response: 'AcademicYearDetailResponse' },
  { method: 'post', pathPattern: /^\/admin\/branches$/, requestBody: 'CreateBranchRequest', response: 'GenericDataResponse', successStatus: 201 },
  { method: 'put', pathPattern: /^\/admin\/branches\/\{id\}$/, requestBody: 'UpdateBranchRequest', response: 'GenericDataResponse' },
  { method: 'post', pathPattern: /^\/admin\/calendars$/, requestBody: 'CreateCalendarRequest', response: 'GenericDataResponse', successStatus: 201 },
  { method: 'put', pathPattern: /^\/admin\/calendars\/\{id\}$/, requestBody: 'UpdateCalendarRequest', response: 'GenericDataResponse' },
  { method: 'post', pathPattern: /^\/admin\/branches\/\{branchId\}\/academic-years\/\{ayId\}\/subjects$/, requestBody: 'CreateSubjectRequest', response: 'GenericDataResponse', successStatus: 201 },
  { method: 'put', pathPattern: /^\/admin\/branches\/\{branchId\}\/subjects\/\{id\}$/, requestBody: 'UpdateSubjectRequest', response: 'GenericDataResponse' },
  { method: 'post', pathPattern: /^\/admin\/sessions\/\{sessionId\}\/exams$/, requestBody: 'CreateExamRequest', response: 'GenericDataResponse', successStatus: 201 },
  { method: 'patch', pathPattern: /^\/admin\/exams\/\{examId\}$/, requestBody: 'UpdateExamRequest', response: 'GenericDataResponse' },
  { method: 'post', pathPattern: /^\/admin\/teachers$/, requestBody: 'CreateTeacherRequest', response: 'GenericDataResponse', successStatus: 201 },
  { method: 'put', pathPattern: /^\/admin\/teachers\/\{id\}$/, requestBody: 'UpdateTeacherRequest', response: 'GenericDataResponse' },
  { method: 'post', pathPattern: /^\/admin\/assignments$/, requestBody: 'CreateAssignmentRequest', response: 'GenericDataResponse', successStatus: 201 },
  { method: 'put', pathPattern: /^\/admin\/assignments\/\{id\}$/, requestBody: 'UpdateAssignmentRequest', response: 'GenericDataResponse' },
  { method: 'post', pathPattern: /^\/admin\/exam-sessions$/, requestBody: 'CreateExamSessionRequest', response: 'GenericDataResponse', successStatus: 201 },
  { method: 'patch', pathPattern: /^\/admin\/exam-sessions\/\{sessionId\}$/, requestBody: 'UpdateExamSessionRequest', response: 'GenericDataResponse' },
  { method: 'post', pathPattern: /^\/admin\/sessions\/\{sessionId\}\/types$/, requestBody: 'CreateExamTypeRequest', response: 'GenericDataResponse', successStatus: 201 },
  { method: 'patch', pathPattern: /^\/admin\/sessions\/\{sessionId\}\/types\/\{typeId\}$/, requestBody: 'UpdateExamTypeRequest', response: 'GenericDataResponse' },
  { method: 'post', pathPattern: /^\/auth\/login$/, requestBody: 'LoginRequest', response: 'LoginResponse' },
  { method: 'put', pathPattern: /^\/auth\/password$/, requestBody: 'ChangePasswordRequest', response: 'MessageResponse' },
];

const MUTATION_METHODS = new Set(['post', 'put', 'patch']);
const BODY_METHODS = new Set(['post', 'put', 'patch']);

/** Apply method/path conventions when no explicit rule matched */
function applyFallbacks(method: string, path: string, partial?: OperationSpec): OperationSpec {
  const spec: OperationSpec = { ...partial };
  const hasPathParam = /\{[^}]+\}/.test(path);

  // System/health — minimal spec
  if (path === '/' || path === '/health') {
    return { response: 'MessageResponse', skipAdminScope: true };
  }

  if (!spec.response) {
    if (method === 'get') {
      spec.response = hasPathParam ? 'GenericDataResponse' : 'GenericDataListResponse';
    } else if (MUTATION_METHODS.has(method)) {
      spec.response = 'GenericDataResponse';
      if (method === 'post' && !spec.successStatus) spec.successStatus = 201;
    } else if (method === 'delete') {
      spec.response = 'MessageResponse';
    }
  }

  // Typed request bodies take priority; otherwise use generic object for mutations
  if (!spec.requestBody && BODY_METHODS.has(method) && !path.startsWith('/api')) {
    const actionSuffix = path.split('/').pop() ?? '';
    const noBodyActions = new Set([
      'revert', 'print-receipt', 'reactivate', 'deactivate', 'send-credentials',
      'notify', 'resume', 'publish', 'pause', 'archive', 'unarchive', 'end', 'void', 'unlink',
      'refresh', 'logout', 'duplicate-last',
    ]);
    if (!noBodyActions.has(actionSuffix)) {
      spec.requestBody = 'JsonObjectRequest';
    }
  }

  return spec;
}

/** Maps validate(schemaName) in route files to component schema names */
export const ZOD_VALIDATE_MAP: Record<string, string> = {
  loginSchema: 'LoginRequest',
  changePasswordSchema: 'ChangePasswordRequest',
};

export function operationKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

export function resolveOperation(method: string, path: string): OperationSpec {
  const key = operationKey(method, path);
  if (OPERATION_REGISTRY[key]) return applyFallbacks(method, path, OPERATION_REGISTRY[key]);

  for (const rule of CRUD_RULES) {
    if (rule.method === method && rule.pathPattern.test(path)) {
      return applyFallbacks(method, path, {
        requestBody: rule.requestBody,
        response: rule.response,
        successStatus: rule.successStatus,
      });
    }
  }
  return applyFallbacks(method, path);
}
