/**
 * Zod schemas for OpenAPI generation.
 * Mirrors service DTOs and route request bodies where no runtime Zod validator exists.
 */
import { z } from 'zod';
import {
  loginSchema,
  changePasswordSchema,
} from '../../src/modules/auth/auth.schema';

// Re-export auth schemas (runtime-validated)
export { loginSchema, changePasswordSchema };

// ─── Shared primitives ─────────────────────────────────────────────

export const uuidSchema = z.string().uuid();
export const genderSchema = z.enum(['male', 'female', 'other']);
export const paginationMetaSchema = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
});

export const userSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  username: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  role: z.string(),
  status: z.string().optional(),
});

// ─── Auth responses ────────────────────────────────────────────────

export const loginResponseSchema = z.object({
  success: z.literal(true),
  token: z.string(),
  rememberMeToken: z.string().nullable().optional(),
  user: userSummarySchema,
});

export const authUserResponseSchema = z.object({
  success: z.literal(true),
  user: userSummarySchema.extend({
    gender: z.string().nullable().optional(),
    dateOfBirth: z.string().nullable().optional(),
    address: z.string().nullable().optional(),
    lastLoginAt: z.string().nullable().optional(),
  }),
});

export const messageResponseSchema = z.object({
  success: z.literal(true),
  message: z.string().optional(),
});

// ─── Students ──────────────────────────────────────────────────────

export const createStudentRequestSchema = z.object({
  name: z.string(),
  gender: genderSchema.optional(),
  dateOfBirth: z.string().optional(),
  religion: z.string().optional(),
  nationality: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
  phone: z.string().optional(),
  bloodGroup: z.string().optional(),
  bformCnic: z.string().optional(),
  motherTongue: z.string().optional(),
  studentEmail: z.string().optional(),
  studentWhatsapp: z.string().optional(),
  previousSchool: z.string().optional(),
  previousClass: z.string().optional(),
  tcNumber: z.string().optional(),
  referredBy: z.string().optional(),
  groupId: z.string().optional(),
  academicYearId: z.string().optional(),
  admissionNumber: z.string().optional(),
  rollNumber: z.string().optional(),
  profilePhotoId: z.string().optional(),
  guardianName: z.string().optional(),
  guardianRelation: z.string().optional(),
});

export const updateStudentRequestSchema = createStudentRequestSchema.partial().omit({
  guardianName: true,
  guardianRelation: true,
  academicYearId: true,
  rollNumber: true,
});

export const studentSchema = z.object({
  id: z.string(),
  name: z.string(),
  admissionNumber: z.string().nullable().optional(),
  rollNumber: z.string().nullable().optional(),
  gender: z.string().nullable().optional(),
  groupId: z.string().nullable().optional(),
  academicYearId: z.string(),
  isActive: z.boolean().optional(),
  status: z.string().optional(),
});

export const studentListResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(studentSchema),
  meta: paginationMetaSchema,
});

export const studentDetailResponseSchema = z.object({
  success: z.literal(true),
  data: studentSchema,
});

export const emergencyContactRequestSchema = z.object({
  name: z.string(),
  relation: z.string().optional(),
  phone: z.string(),
  priority: z.number().int().optional(),
});

export const healthRecordRequestSchema = z.object({
  allergies: z.string().optional(),
  medicalConditions: z.string().optional(),
  medications: z.string().optional(),
  doctorName: z.string().optional(),
  doctorPhone: z.string().optional(),
});

export const linkParentRequestSchema = z.object({
  parentUserId: z.string().optional(),
  name: z.string().optional(),
  phone: z.string().optional(),
  relation: z.string(),
  isPrimary: z.boolean().optional(),
});

export const setStudentStatusRequestSchema = z.object({
  status: z.string(),
  reason: z.string().optional(),
});

export const setPasswordRequestSchema = z.object({
  password: z.string().min(8),
});

// ─── Academic year ─────────────────────────────────────────────────

export const academicYearStatusSchema = z.enum([
  'BUILD_STAGE', 'ON_HOLD', 'ACTIVE', 'ARCHIVED',
]);

export const createAcademicYearRequestSchema = z.object({
  calendarId: z.string(),
  previousAcademicYearId: z.string().optional(),
  directToArchived: z.boolean().optional(),
});

export const updateAcademicYearRequestSchema = z.object({
  previousAcademicYearId: z.string().optional(),
});

export const unarchiveAcademicYearRequestSchema = z.object({
  target: z.enum(['ON_HOLD', 'BUILD_STAGE']).optional(),
});

export const deleteAcademicYearRequestSchema = z.object({
  confirmLabel: z.string().optional(),
});

export const addAcademicYearMemberRequestSchema = z.object({
  userId: z.string(),
  role: z.string().optional(),
});

export const academicYearSchema = z.object({
  id: z.string(),
  branchId: z.string(),
  calendarId: z.string(),
  status: academicYearStatusSchema,
  previousAcademicYearId: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const academicYearListResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(academicYearSchema),
});

export const academicYearDetailResponseSchema = z.object({
  success: z.literal(true),
  data: academicYearSchema,
});

// ─── Fees ──────────────────────────────────────────────────────────

export const feeHeadCategorySchema = z.enum(['MONTHLY', 'TERM', 'ANNUAL', 'ONE_TIME', 'CUSTOM']);

export const createFeeHeadRequestSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  isOptional: z.boolean().optional(),
  category: feeHeadCategorySchema.optional(),
});

export const updateFeeHeadRequestSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  isOptional: z.boolean().optional(),
  isActive: z.boolean().optional(),
  category: feeHeadCategorySchema.optional(),
});

export const feeHeadSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  isOptional: z.boolean(),
  isActive: z.boolean(),
  category: z.string(),
});

export const createFeeStructureRequestSchema = z.object({
  academicYearId: z.string(),
  groupId: z.string(),
  feeHeadId: z.string(),
  amount: z.number().int(),
  effectiveFrom: z.string().optional(),
});

export const updateFeeStructureAmountRequestSchema = z.object({
  academicYearId: z.string(),
  groupId: z.string(),
  feeHeadId: z.string(),
  amount: z.number().int(),
  effectiveFrom: z.string().optional(),
});

export const generateStudentFeesRequestSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int(),
  academicYearId: z.string().optional(),
  categories: z.array(z.string()).optional(),
  headIds: z.array(z.string()).optional(),
  groupIds: z.array(z.string()).optional(),
  mode: z.enum(['generate', 'update', 'regenerate']).optional(),
});

export const recordPaymentRequestSchema = z.object({
  studentFeeId: z.string(),
  amount: z.number().int().positive(),
  paymentMethod: z.string(),
  reference: z.string().optional(),
  note: z.string().optional(),
});

export const allocatePaymentRequestSchema = z.object({
  studentId: z.string(),
  amount: z.number().int().positive(),
  paymentMethod: z.string(),
  reference: z.string().optional(),
  note: z.string().optional(),
  allocations: z.array(z.object({
    studentFeeId: z.string(),
    amount: z.number().int(),
  })).optional(),
});

export const customFeeRequestSchema = z.object({
  customFeeAmount: z.number().int().nullable().optional(),
  feeOverrides: z.record(z.number()).optional(),
  concessionReason: z.string().optional(),
});

export const feeExtraItemRequestSchema = z.object({
  name: z.string(),
  amount: z.number().int(),
  reason: z.string().optional(),
});

export const paymentSchema = z.object({
  id: z.string(),
  studentFeeId: z.string(),
  studentId: z.string(),
  amount: z.number().int(),
  paymentMethod: z.string(),
  receiptNumber: z.string().nullable().optional(),
  reference: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  createdAt: z.string().optional(),
});

export const studentFeeSchema = z.object({
  id: z.string(),
  studentId: z.string(),
  academicYearId: z.string(),
  month: z.number().int(),
  year: z.number().int(),
  netAmount: z.number().int(),
  paidAmount: z.number().int(),
  status: z.string(),
});

// ─── Branches & calendars ──────────────────────────────────────────

export const createBranchRequestSchema = z.object({
  name: z.string(),
  code: z.string(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  logoUrl: z.string().optional(),
});

export const updateBranchRequestSchema = z.object({
  name: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  logoUrl: z.string().optional(),
  teacherParentContactEnabled: z.boolean().optional(),
  teachersCanMarkAttendance: z.boolean().optional(),
  teachersCanEnterMarks: z.boolean().optional(),
});

export const branchSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
});

export const createCalendarRequestSchema = z.object({
  label: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  isCurrent: z.boolean().optional(),
});

export const updateCalendarRequestSchema = createCalendarRequestSchema.partial();

export const calendarSchema = z.object({
  id: z.string(),
  label: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  isCurrent: z.boolean(),
});

// ─── Subjects & exams ──────────────────────────────────────────────

export const createSubjectRequestSchema = z.object({
  name: z.string(),
  code: z.string().optional(),
  description: z.string().optional(),
  totalMarks: z.number().int().optional(),
  passingMarks: z.number().int().optional(),
  isElective: z.boolean().optional(),
  hodId: z.string().optional(),
});

export const updateSubjectRequestSchema = createSubjectRequestSchema.partial();

export const subjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string().nullable().optional(),
  academicYearId: z.string(),
});

export const createExamSessionRequestSchema = z.object({
  name: z.string(),
  startDate: z.string(),
  endDate: z.string(),
});

export const updateExamSessionRequestSchema = createExamSessionRequestSchema.partial();

export const createExamTypeRequestSchema = z.object({
  name: z.string(),
  defaultWeight: z.number().optional(),
});

export const updateExamTypeRequestSchema = z.object({
  name: z.string().optional(),
  defaultWeight: z.number().nullable().optional(),
});

export const createExamRequestSchema = z.object({
  name: z.string(),
  examTypeId: z.string(),
  weightOverride: z.number().optional(),
  startDate: z.string(),
  endDate: z.string().optional(),
});

export const updateExamRequestSchema = z.object({
  name: z.string().optional(),
  examTypeId: z.string().optional(),
  weightOverride: z.number().nullable().optional(),
  startDate: z.string().optional(),
  endDate: z.string().nullable().optional(),
  status: z.enum(['DRAFT', 'ACTIVE']).optional(),
  teacherMarksEntry: z.boolean().optional(),
});

export const addBranchMemberRequestSchema = z.object({
  userId: z.string(),
  role: z.string(),
  keepTeacherRole: z.boolean().optional(),
});

export const updateBranchMemberRequestSchema = z.object({
  role: z.string().optional(),
  keepTeacherRole: z.boolean().optional(),
});

export const createTeacherRequestSchema = z.object({
  userId: z.string().optional(),
  name: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  email: z.string().optional(),
  branchId: z.string().optional(),
  employeeId: z.string().optional(),
  qualification: z.string().optional(),
  specialization: z.string().optional(),
  joiningDate: z.string().optional(),
  salary: z.number().optional(),
  phone: z.string().optional(),
  gender: genderSchema.optional(),
  profilePhotoId: z.string().optional(),
});

export const updateTeacherRequestSchema = createTeacherRequestSchema.partial().extend({
  portalAccess: z.enum(['FULL', 'READ_ONLY', 'FROZEN']).optional(),
  canViewParentContact: z.boolean().optional(),
  hodParentContactScope: z.enum(['ASSIGNED_ONLY', 'DEPARTMENT_ALL']).optional(),
});

export const createAssignmentRequestSchema = z.object({
  academicYearId: z.string(),
  teacherId: z.string(),
  groupId: z.string(),
  subjectId: z.string(),
  isClassTeacher: z.boolean().optional(),
  role: z.string().optional(),
});

export const updateAssignmentRequestSchema = z.object({
  isClassTeacher: z.boolean().optional(),
});

export const createSectionRequestSchema = z.object({
  name: z.string(),
  displayOrder: z.number().int().optional(),
});

export const updateSectionRequestSchema = z.object({
  name: z.string().optional(),
  displayOrder: z.number().int().optional(),
});

export const recordFamilyPaymentRequestSchema = z.object({
  familyId: z.string(),
  amount: z.number().int().positive(),
  paymentMethod: z.string(),
  reference: z.string().optional(),
  note: z.string().optional(),
});

export const batchAttendanceRequestSchema = z.object({
  date: z.string(),
  records: z.array(z.object({
    studentId: z.string(),
    status: z.string(),
    note: z.string().optional(),
  })),
});

/** Unstructured JSON body — used as fallback for POST/PUT/PATCH without a typed schema */
export const jsonObjectRequestSchema = z.record(z.unknown());

// ─── Generic envelopes ─────────────────────────────────────────────

export const errorEnvelopeSchema = z.object({
  success: z.literal(false),
  message: z.string(),
  errors: z.array(z.object({
    field: z.string(),
    message: z.string(),
  })).optional(),
});

export const genericDataResponseSchema = z.object({
  success: z.literal(true),
  data: z.unknown(),
});

export const genericDataListResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(z.unknown()),
});

/** All named component schemas for OpenAPI `components.schemas` */
export const COMPONENT_SCHEMAS: Record<string, z.ZodTypeAny> = {
  LoginRequest: loginSchema,
  ChangePasswordRequest: changePasswordSchema,
  LoginResponse: loginResponseSchema,
  AuthUserResponse: authUserResponseSchema,
  MessageResponse: messageResponseSchema,
  ErrorEnvelope: errorEnvelopeSchema,
  CreateStudentRequest: createStudentRequestSchema,
  UpdateStudentRequest: updateStudentRequestSchema,
  Student: studentSchema,
  StudentListResponse: studentListResponseSchema,
  StudentDetailResponse: studentDetailResponseSchema,
  EmergencyContactRequest: emergencyContactRequestSchema,
  HealthRecordRequest: healthRecordRequestSchema,
  LinkParentRequest: linkParentRequestSchema,
  SetStudentStatusRequest: setStudentStatusRequestSchema,
  SetPasswordRequest: setPasswordRequestSchema,
  CreateAcademicYearRequest: createAcademicYearRequestSchema,
  UpdateAcademicYearRequest: updateAcademicYearRequestSchema,
  UnarchiveAcademicYearRequest: unarchiveAcademicYearRequestSchema,
  DeleteAcademicYearRequest: deleteAcademicYearRequestSchema,
  AddAcademicYearMemberRequest: addAcademicYearMemberRequestSchema,
  AcademicYear: academicYearSchema,
  AcademicYearListResponse: academicYearListResponseSchema,
  AcademicYearDetailResponse: academicYearDetailResponseSchema,
  CreateFeeHeadRequest: createFeeHeadRequestSchema,
  UpdateFeeHeadRequest: updateFeeHeadRequestSchema,
  FeeHead: feeHeadSchema,
  CreateFeeStructureRequest: createFeeStructureRequestSchema,
  UpdateFeeStructureAmountRequest: updateFeeStructureAmountRequestSchema,
  GenerateStudentFeesRequest: generateStudentFeesRequestSchema,
  RecordPaymentRequest: recordPaymentRequestSchema,
  AllocatePaymentRequest: allocatePaymentRequestSchema,
  CustomFeeRequest: customFeeRequestSchema,
  FeeExtraItemRequest: feeExtraItemRequestSchema,
  Payment: paymentSchema,
  StudentFee: studentFeeSchema,
  CreateBranchRequest: createBranchRequestSchema,
  UpdateBranchRequest: updateBranchRequestSchema,
  Branch: branchSchema,
  CreateCalendarRequest: createCalendarRequestSchema,
  UpdateCalendarRequest: updateCalendarRequestSchema,
  Calendar: calendarSchema,
  CreateSubjectRequest: createSubjectRequestSchema,
  UpdateSubjectRequest: updateSubjectRequestSchema,
  Subject: subjectSchema,
  CreateExamSessionRequest: createExamSessionRequestSchema,
  UpdateExamSessionRequest: updateExamSessionRequestSchema,
  CreateExamTypeRequest: createExamTypeRequestSchema,
  UpdateExamTypeRequest: updateExamTypeRequestSchema,
  CreateExamRequest: createExamRequestSchema,
  UpdateExamRequest: updateExamRequestSchema,
  AddBranchMemberRequest: addBranchMemberRequestSchema,
  UpdateBranchMemberRequest: updateBranchMemberRequestSchema,
  CreateTeacherRequest: createTeacherRequestSchema,
  UpdateTeacherRequest: updateTeacherRequestSchema,
  CreateAssignmentRequest: createAssignmentRequestSchema,
  UpdateAssignmentRequest: updateAssignmentRequestSchema,
  CreateSectionRequest: createSectionRequestSchema,
  UpdateSectionRequest: updateSectionRequestSchema,
  RecordFamilyPaymentRequest: recordFamilyPaymentRequestSchema,
  BatchAttendanceRequest: batchAttendanceRequestSchema,
  JsonObjectRequest: jsonObjectRequestSchema,
  PaginationMeta: paginationMetaSchema,
  GenericDataResponse: genericDataResponseSchema,
  GenericDataListResponse: genericDataListResponseSchema,
};
