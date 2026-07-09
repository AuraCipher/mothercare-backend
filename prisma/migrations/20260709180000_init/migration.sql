-- CreateEnum
CREATE TYPE "Role" AS ENUM ('super_admin', 'management', 'teacher', 'parent', 'student');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('male', 'female', 'other');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('active', 'inactive', 'suspended');

-- CreateEnum
CREATE TYPE "BranchRole" AS ENUM ('branch_admin', 'sub_admin', 'management', 'teacher', 'parent', 'canteen_staff', 'worker');

-- CreateEnum
CREATE TYPE "StaffModule" AS ENUM ('STUDENTS', 'OPERATIONS', 'TIMETABLE', 'ATTENDANCE', 'FEES', 'RESULT', 'CANTEEN', 'STATIONARY', 'EXPENSES', 'DOCUMENTS');

-- CreateEnum
CREATE TYPE "AcademicYearStatus" AS ENUM ('BUILD_STAGE', 'ACTIVE', 'ON_HOLD', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AcademicYearAuditAction" AS ENUM ('CREATED', 'PUBLISHED', 'ARCHIVED', 'UNARCHIVED', 'DELETED', 'PAUSED', 'RESUMED');

-- CreateEnum
CREATE TYPE "PromotionStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'REVERSED', 'FAILED');

-- CreateEnum
CREATE TYPE "StudentStatus" AS ENUM ('ACTIVE', 'GRADUATED', 'WITHDRAWN', 'TRANSFERRED', 'SUSPENDED', 'EXPELED', 'DECEASED');

-- CreateEnum
CREATE TYPE "ApiKeyType" AS ENUM ('publishable', 'secret');

-- CreateEnum
CREATE TYPE "ExamStatus" AS ENUM ('DRAFT', 'ACTIVE');

-- CreateEnum
CREATE TYPE "ReportCardStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "CanteenPersonType" AS ENUM ('STUDENT', 'TEACHER', 'STAFF');

-- CreateEnum
CREATE TYPE "CanteenSupplierPaymentDirection" AS ENUM ('WE_PAID_SUPPLIER', 'SUPPLIER_PAID_US');

-- CreateEnum
CREATE TYPE "CanteenSalePaymentType" AS ENUM ('CASH', 'CREDIT');

-- CreateEnum
CREATE TYPE "StationaryStockMovementType" AS ENUM ('STOCK_IN', 'ADJUSTMENT', 'STUDENT_ASSIGNED');

-- CreateEnum
CREATE TYPE "StationarySupplierPaymentDirection" AS ENUM ('WE_PAID_SUPPLIER', 'SUPPLIER_PAID_US');

-- CreateEnum
CREATE TYPE "OutgoingPaymentType" AS ENUM ('PAYROLL', 'UTILITY', 'OTHER');

-- CreateEnum
CREATE TYPE "OutgoingPaymentStatus" AS ENUM ('PAID', 'VOID');

-- CreateEnum
CREATE TYPE "OutgoingPaymentMethod" AS ENUM ('CASH', 'CHEQUE', 'BANK_TRANSFER', 'ONLINE');

-- CreateEnum
CREATE TYPE "PayrollPayeeType" AS ENUM ('TEACHER', 'STAFF');

-- CreateEnum
CREATE TYPE "PayrollPaymentKind" AS ENUM ('REGULAR', 'EXTRA');

-- CreateEnum
CREATE TYPE "ExpenseCategoryKind" AS ENUM ('UTILITY', 'OTHER');

-- CreateEnum
CREATE TYPE "BatchPromotionRunPhase" AS ENUM ('DRAFT', 'SNAPSHOT_DONE', 'APPLIED', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "StudentCredentialTag" AS ENUM ('CRED_NONE', 'CRED_CARRIED', 'CRED_NEW', 'CRED_RESEND', 'NO_LOGIN');

-- CreateEnum
CREATE TYPE "TenureEndReason" AS ENUM ('RESIGNED', 'TERMINATED', 'TRANSFERRED', 'GRADUATED', 'WITHDRAWN', 'DECEASED', 'LEAVE', 'REJOINED', 'OTHER');

-- CreateEnum
CREATE TYPE "ChatRoomKind" AS ENUM ('school_announcement', 'class_announcement', 'group_chat', 'direct_message', 'system_attendance', 'system_payment');

-- CreateEnum
CREATE TYPE "ChatRoomSource" AS ENUM ('manual', 'subject_assignment', 'system_bootstrap');

-- CreateEnum
CREATE TYPE "ChatMemberAccess" AS ENUM ('owner', 'moderator', 'poster', 'member', 'observer');

-- CreateEnum
CREATE TYPE "ChatMessageType" AS ENUM ('text', 'image', 'video', 'audio', 'voice_note', 'document', 'system', 'announcement');

-- CreateEnum
CREATE TYPE "TeacherPortalAccess" AS ENUM ('FULL', 'READ_ONLY', 'FROZEN');

-- CreateEnum
CREATE TYPE "HodParentContactScope" AS ENUM ('ASSIGNED_ONLY', 'DEPARTMENT_ALL');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT,
    "name" TEXT NOT NULL,
    "username" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'parent',
    "managementPerms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "gender" "Gender",
    "dateOfBirth" TIMESTAMP(3),
    "address" TEXT,
    "profilePhoto" TEXT,
    "profilePhotoId" TEXT,
    "status" "AccountStatus" NOT NULL DEFAULT 'active',
    "isEmailVerified" BOOLEAN NOT NULL DEFAULT false,
    "isPhoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "lastSeen" TIMESTAMP(3),
    "rememberMeToken" TEXT,
    "rememberMeExpiry" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_records" (
    "id" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "storageBucket" TEXT NOT NULL DEFAULT 'local',
    "purpose" TEXT,
    "publicUrl" TEXT,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "uploadedById" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "file_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schools" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "logoUrl" TEXT,
    "website" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Karachi',
    "currency" TEXT NOT NULL DEFAULT 'PKR',
    "passingMarks" DOUBLE PRECISION NOT NULL DEFAULT 50.0,
    "attendanceAlert" INTEGER NOT NULL DEFAULT 75,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "schools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "logoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "teacherParentContactEnabled" BOOLEAN NOT NULL DEFAULT false,
    "teachersCanMarkAttendance" BOOLEAN NOT NULL DEFAULT true,
    "teachersCanEnterMarks" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_calendars" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "academic_calendars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_years" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "status" "AcademicYearStatus" NOT NULL DEFAULT 'BUILD_STAGE',
    "previousAcademicYearId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "academic_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_year_audit_logs" (
    "id" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "action" "AcademicYearAuditAction" NOT NULL,
    "fromStatus" "AcademicYearStatus",
    "toStatus" "AcademicYearStatus",
    "note" TEXT,
    "performedById" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "academic_year_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_year_members" (
    "id" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "academic_year_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_members" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "BranchRole" NOT NULL DEFAULT 'teacher',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "keepTeacherRole" BOOLEAN NOT NULL DEFAULT true,
    "assignedById" TEXT,
    "resignedAt" TIMESTAMP(3),
    "resignedInFavorOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "branch_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_module_permissions" (
    "id" TEXT NOT NULL,
    "branchMemberId" TEXT NOT NULL,
    "module" "StaffModule" NOT NULL,
    "canCreate" BOOLEAN NOT NULL DEFAULT false,
    "canRead" BOOLEAN NOT NULL DEFAULT true,
    "canUpdate" BOOLEAN NOT NULL DEFAULT false,
    "canDelete" BOOLEAN NOT NULL DEFAULT false,
    "archivedCanRead" BOOLEAN NOT NULL DEFAULT false,
    "archivedCanCreate" BOOLEAN NOT NULL DEFAULT false,
    "archivedCanUpdate" BOOLEAN NOT NULL DEFAULT false,
    "archivedCanDelete" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_module_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_tenures" (
    "id" TEXT NOT NULL,
    "branchMemberId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL,
    "leftAt" TIMESTAMP(3),
    "endReason" "TenureEndReason",
    "notes" TEXT,
    "previousTenureId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "branch_tenures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "section" TEXT,
    "displayOrder" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 30,
    "onlyAdminCanSend" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_members" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "group_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subjects" (
    "id" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "totalMarks" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "passingMarks" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "isElective" BOOLEAN NOT NULL DEFAULT false,
    "hodId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_subjects" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "group_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employeeId" TEXT,
    "portalAccess" "TeacherPortalAccess" NOT NULL DEFAULT 'FULL',
    "portalPermissions" JSONB,
    "canViewParentContact" BOOLEAN NOT NULL DEFAULT false,
    "hodParentContactScope" "HodParentContactScope" NOT NULL DEFAULT 'ASSIGNED_ONLY',
    "qualification" TEXT,
    "specialization" TEXT,
    "joiningDate" TIMESTAMP(3),
    "salary" DECIMAL(12,2),
    "phone" TEXT,
    "emergencyContact" TEXT,
    "address" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "gender" "Gender",
    "bloodGroup" TEXT,
    "fatherName" TEXT,
    "cardId" TEXT,
    "severeDisease" TEXT,
    "experience" TEXT,
    "bio" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "credentialGeneratedAt" TIMESTAMP(3),
    "credentialSentAt" TIMESTAMP(3),
    "credentialDeliveredAt" TIMESTAMP(3),
    "credentialSeenAt" TIMESTAMP(3),
    "passwordSetAt" TIMESTAMP(3),
    "credentialStatus" TEXT DEFAULT 'none',

    CONSTRAINT "teacher_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employeeId" TEXT,
    "workRole" TEXT,
    "qualification" TEXT,
    "specialization" TEXT,
    "joiningDate" TIMESTAMP(3),
    "salary" DECIMAL(12,2),
    "phone" TEXT,
    "emergencyContact" TEXT,
    "address" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "gender" "Gender",
    "bloodGroup" TEXT,
    "fatherName" TEXT,
    "cardId" TEXT,
    "severeDisease" TEXT,
    "experience" TEXT,
    "bio" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "staff_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_assignments" (
    "id" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "isClassTeacher" BOOLEAN NOT NULL DEFAULT false,
    "role" TEXT NOT NULL DEFAULT 'primary',
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "teacher_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "management_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employeeId" TEXT,
    "department" TEXT,
    "designation" TEXT,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "joiningDate" TIMESTAMP(3),
    "salary" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "management_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parent_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "occupation" TEXT,
    "employerName" TEXT,
    "maritalStatus" TEXT,
    "monthlyIncome" TEXT,
    "relation" TEXT,
    "cnicNumber" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "parent_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_persons" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "userId" TEXT,
    "admissionNumber" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_school_tenures" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL,
    "leftAt" TIMESTAMP(3),
    "endReason" "TenureEndReason",
    "notes" TEXT,
    "previousTenureId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "student_school_tenures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" TEXT NOT NULL,
    "personId" TEXT,
    "academicYearId" TEXT NOT NULL,
    "groupId" TEXT,
    "familyId" TEXT,
    "name" TEXT NOT NULL,
    "rollNumber" TEXT,
    "admissionNumber" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "gender" "Gender",
    "religion" TEXT,
    "nationality" TEXT DEFAULT 'Pakistani',
    "customFeeAmount" INTEGER,
    "concessionReason" TEXT,
    "feeOverrides" JSONB,
    "address" TEXT,
    "phone" TEXT,
    "bloodGroup" TEXT,
    "bformCnic" TEXT,
    "motherTongue" TEXT,
    "studentEmail" TEXT,
    "studentWhatsapp" TEXT,
    "city" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "previousSchool" TEXT,
    "previousClass" TEXT,
    "tcNumber" TEXT,
    "referredBy" TEXT,
    "profilePhotoId" TEXT,
    "userId" TEXT,
    "username" TEXT,
    "studentNumber" INTEGER,
    "status" "StudentStatus" NOT NULL DEFAULT 'ACTIVE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "admissionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "credentialGeneratedAt" TIMESTAMP(3),
    "credentialSentAt" TIMESTAMP(3),
    "credentialDeliveredAt" TIMESTAMP(3),
    "credentialSeenAt" TIMESTAMP(3),
    "passwordSetAt" TIMESTAMP(3),
    "credentialStatus" TEXT DEFAULT 'none',
    "credentialTag" "StudentCredentialTag" NOT NULL DEFAULT 'CRED_NONE',

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_class_movements" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "fromGroupId" TEXT,
    "toGroupId" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_class_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendances" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "markedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_attendances" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "markedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teacher_attendances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_attendances" (
    "id" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "markedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_attendances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credential_sends" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "seenAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "to" TEXT,
    "errorMsg" TEXT,
    "sentById" TEXT,

    CONSTRAINT "credential_sends_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_parents" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "student_parents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_contacts" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "whatsapp" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "emergency_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_records" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "bloodGroup" TEXT,
    "hasChronicDisease" BOOLEAN NOT NULL DEFAULT false,
    "diseaseDetails" TEXT,
    "allergies" TEXT,
    "disability" TEXT,
    "medicalNotes" TEXT,
    "doctorName" TEXT,
    "doctorPhone" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "health_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "rollNumber" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_year_snapshots" (
    "id" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "newAcademicYearId" TEXT,
    "fromLabel" TEXT NOT NULL,
    "toLabel" TEXT NOT NULL,
    "triggeredById" TEXT NOT NULL,
    "status" "PromotionStatus" NOT NULL DEFAULT 'PENDING',
    "totalStudents" INTEGER NOT NULL DEFAULT 0,
    "totalGraduated" INTEGER NOT NULL DEFAULT 0,
    "canReverse" BOOLEAN NOT NULL DEFAULT true,
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "academic_year_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_snapshots" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "groupName" TEXT NOT NULL,
    "section" TEXT,
    "displayOrder" INTEGER NOT NULL,
    "studentsData" JSONB,
    "teachersData" JSONB,
    "studentCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "group_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "groupId" TEXT,
    "senderId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "mediaUrl" TEXT,
    "chatMessageId" TEXT,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_communities" (
    "id" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "chat_communities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_rooms" (
    "id" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "branchId" TEXT,
    "communityId" TEXT,
    "classGroupId" TEXT,
    "studentId" TEXT,
    "subjectId" TEXT,
    "teacherAssignmentId" TEXT,
    "kind" "ChatRoomKind" NOT NULL,
    "source" "ChatRoomSource" NOT NULL DEFAULT 'manual',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "singletonKey" TEXT,
    "onlyStaffCanPost" BOOLEAN NOT NULL DEFAULT false,
    "studentsCanPost" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_room_members" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "access" "ChatMemberAccess" NOT NULL DEFAULT 'observer',
    "canPost" BOOLEAN NOT NULL DEFAULT false,
    "canRead" BOOLEAN NOT NULL DEFAULT true,
    "isMuted" BOOLEAN NOT NULL DEFAULT false,
    "isPostingRestricted" BOOLEAN NOT NULL DEFAULT false,
    "displayTitle" TEXT,
    "classRoleAssignmentId" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_room_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_dm_threads" (
    "id" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "participantAId" TEXT NOT NULL,
    "participantBId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_dm_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "senderId" TEXT,
    "type" "ChatMessageType" NOT NULL DEFAULT 'text',
    "title" TEXT,
    "content" TEXT,
    "mediaFileId" TEXT,
    "replyToId" TEXT,
    "metadata" JSONB,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_message_read_states" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadMessageId" TEXT,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_message_read_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_role_definitions" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "canPostInGroups" BOOLEAN NOT NULL DEFAULT false,
    "canReceiveDms" BOOLEAN NOT NULL DEFAULT true,
    "canInitiateDms" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "class_role_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_role_assignments" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "roleDefinitionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "userId" TEXT,
    "publicDisplayName" TEXT NOT NULL,
    "isMessagingRestricted" BOOLEAN NOT NULL DEFAULT false,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" TEXT,
    "removedAt" TIMESTAMP(3),
    "removedById" TEXT,

    CONSTRAINT "class_role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_push_crypto_keys" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "keyHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "user_push_crypto_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_notifications" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "roomId" TEXT,
    "chatMessageId" TEXT,
    "date" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "sent" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_notifications" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "paymentId" TEXT,
    "roomId" TEXT,
    "chatMessageId" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "amountPaise" INTEGER,
    "receiptNumber" TEXT,
    "sent" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_promotions" (
    "id" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "fromYear" TEXT NOT NULL,
    "toYear" TEXT NOT NULL,
    "promotedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "totalStudents" INTEGER NOT NULL,
    "canReverse" BOOLEAN NOT NULL DEFAULT true,
    "reversedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "batch_promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_promotion_runs" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "sourceAcademicYearId" TEXT NOT NULL,
    "targetAcademicYearId" TEXT NOT NULL,
    "phase" "BatchPromotionRunPhase" NOT NULL DEFAULT 'DRAFT',
    "carryOptions" JSONB NOT NULL,
    "snapshotId" TEXT,
    "promotedById" TEXT NOT NULL,
    "notes" TEXT,
    "errorMessage" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batch_promotion_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_ay_snapshots" (
    "id" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "assignments" JSONB NOT NULL,
    "firstAssignedAt" TIMESTAMP(3),
    "lastAssignedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teacher_ay_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_recipients" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultWeight" DOUBLE PRECISION,
    "examSessionId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "exam_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_sessions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "exam_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exams" (
    "id" TEXT NOT NULL,
    "examSessionId" TEXT NOT NULL,
    "examTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weightOverride" DOUBLE PRECISION,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "status" "ExamStatus" NOT NULL DEFAULT 'DRAFT',
    "teacherMarksEntry" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_classes" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "exam_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_class_subjects" (
    "id" TEXT NOT NULL,
    "examClassId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "totalMarks" INTEGER,
    "passingMarks" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "exam_class_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marks_entries" (
    "id" TEXT NOT NULL,
    "examClassSubjectId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "marksObtained" DOUBLE PRECISION,
    "isAbsent" BOOLEAN NOT NULL DEFAULT false,
    "enteredBy" TEXT NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "marks_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_scales" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "grade_scales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_bands" (
    "id" TEXT NOT NULL,
    "gradeScaleId" TEXT NOT NULL,
    "minPercent" DOUBLE PRECISION NOT NULL,
    "maxPercent" DOUBLE PRECISION NOT NULL,
    "label" TEXT NOT NULL,
    "gpa" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "grade_bands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subject_results" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "examSessionId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "percentage" DOUBLE PRECISION NOT NULL,
    "grade" TEXT NOT NULL,
    "subjectRank" INTEGER,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "subject_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_cards" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "examSessionId" TEXT NOT NULL,
    "overallPercentage" DOUBLE PRECISION NOT NULL,
    "overallGrade" TEXT NOT NULL,
    "classRank" INTEGER,
    "pdfUrl" TEXT,
    "status" "ReportCardStatus" NOT NULL DEFAULT 'DRAFT',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "report_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "module" TEXT NOT NULL DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ApiKeyType" NOT NULL DEFAULT 'publishable',
    "keyHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_invitations" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "branchId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "admin_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timetables" (
    "id" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'timetable',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "timetables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timetable_slots" (
    "id" TEXT NOT NULL,
    "timetableId" TEXT NOT NULL,
    "dayOfWeek" INTEGER,
    "lectureNumber" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "timetable_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timetable_entries" (
    "id" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "subjectId" TEXT,
    "teacherId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "timetable_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timetable_day_configs" (
    "id" TEXT NOT NULL,
    "timetableId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "timetable_day_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_status_logs" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "previousStatus" "StudentStatus",
    "newStatus" "StudentStatus" NOT NULL,
    "reason" TEXT,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_status_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "families" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fatherName" TEXT,
    "motherName" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_change_logs" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" JSONB,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "family_change_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_heads" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "category" TEXT NOT NULL DEFAULT 'MONTHLY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_heads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_structures" (
    "id" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "feeHeadId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_structures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_change_logs" (
    "id" TEXT NOT NULL,
    "feeStructureId" TEXT NOT NULL,
    "previousAmount" INTEGER NOT NULL,
    "newAmount" INTEGER NOT NULL,
    "reason" TEXT,
    "changedById" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_change_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_fees" (
    "id" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "groupId" TEXT,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "concession" INTEGER NOT NULL DEFAULT 0,
    "lateFee" INTEGER NOT NULL DEFAULT 0,
    "netAmount" INTEGER NOT NULL,
    "extraCharges" INTEGER NOT NULL DEFAULT 0,
    "extraReason" TEXT,
    "paidAmount" INTEGER NOT NULL DEFAULT 0,
    "feeHeadBreakdown" JSONB,
    "status" TEXT NOT NULL DEFAULT 'UNPAID',
    "dueDate" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_fees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_extra_items" (
    "id" TEXT NOT NULL,
    "studentFeeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "sourceType" TEXT DEFAULT 'EXTRA_DUE',
    "metadata" JSONB,
    "stationaryRecordItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_extra_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_carry_forwards" (
    "id" TEXT NOT NULL,
    "fromStudentFeeId" TEXT NOT NULL,
    "toStudentFeeId" TEXT NOT NULL,
    "fromStudentId" TEXT,
    "toStudentId" TEXT,
    "amount" INTEGER NOT NULL,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_carry_forwards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_payments" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "academicYearId" TEXT,
    "receiptNumber" TEXT NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "paymentMethod" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "paymentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "family_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_payment_receipts" (
    "id" TEXT NOT NULL,
    "familyPaymentId" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "templateType" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "totalDuePaise" INTEGER NOT NULL,
    "amountPaidPaise" INTEGER NOT NULL,
    "balanceAfterPaise" INTEGER NOT NULL,
    "paymentMethod" TEXT,
    "reference" TEXT,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "printedAt" TIMESTAMP(3),
    "printCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "family_payment_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "studentFeeId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "familyPaymentId" TEXT,
    "amount" INTEGER NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "reference" TEXT,
    "paymentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT NOT NULL,
    "note" TEXT,
    "revertedAt" TIMESTAMP(3),
    "revertedById" TEXT,
    "revertReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_head_allocations" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "studentFeeId" TEXT NOT NULL,
    "feeHeadId" TEXT,
    "feeExtraItemId" TEXT,
    "amount" INTEGER NOT NULL,
    "revertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_head_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_receipts" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "currentMonthLabel" TEXT NOT NULL,
    "currentMonthTotal" INTEGER NOT NULL,
    "currentMonthHeads" JSONB NOT NULL,
    "currentMonthExtras" JSONB,
    "previousBalancePaise" INTEGER NOT NULL,
    "previousMonthsCount" INTEGER NOT NULL,
    "previousMonths" JSONB,
    "templateType" TEXT,
    "allocations" JSONB,
    "totalDuePaise" INTEGER NOT NULL,
    "amountPaidPaise" INTEGER NOT NULL,
    "balanceAfterPaise" INTEGER NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "reference" TEXT,
    "studentName" TEXT NOT NULL,
    "studentClass" TEXT NOT NULL,
    "studentRoll" TEXT,
    "fatherName" TEXT,
    "isFullyPaid" BOOLEAN NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "printedAt" TIMESTAMP(3),
    "printCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_audit_logs" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "previousValue" JSONB,
    "newValue" JSONB,
    "performedById" TEXT NOT NULL,
    "performedByName" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canteen_suppliers" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactNumber" TEXT,
    "note" TEXT,
    "balanceOwedToSupplier" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "balanceSupplierOwesUs" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "canteen_suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canteen_supplier_payments" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "direction" "CanteenSupplierPaymentDirection" NOT NULL,
    "note" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "canteen_supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canteen_product_categories" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canteen_product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canteen_products" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "supplierId" TEXT,
    "name" TEXT NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "boxPrice" DECIMAL(12,2),
    "unitsPerBox" INTEGER,
    "stockBoxes" INTEGER NOT NULL DEFAULT 0,
    "stockUnits" INTEGER NOT NULL DEFAULT 0,
    "lowStockThreshold" INTEGER NOT NULL DEFAULT 5,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "canteen_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canteen_restock_purchases" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalCost" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "createdById" TEXT,

    CONSTRAINT "canteen_restock_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canteen_purchase_items" (
    "id" TEXT NOT NULL,
    "restockPurchaseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "canteen_purchase_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canteen_accounts" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "personType" "CanteenPersonType" NOT NULL,
    "studentId" TEXT,
    "userId" TEXT,
    "displayName" TEXT NOT NULL,
    "displayPhone" TEXT,
    "runningBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "canteen_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canteen_account_payments" (
    "id" TEXT NOT NULL,
    "canteenAccountId" TEXT NOT NULL,
    "amountPaid" DECIMAL(12,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdById" TEXT,

    CONSTRAINT "canteen_account_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canteen_sales" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "canteenAccountId" TEXT,
    "paymentType" "CanteenSalePaymentType" NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "soldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "canteen_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canteen_sale_items" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceAtSale" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "canteen_sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stationary_categories" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stationary_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stationary_suppliers" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactNumber" TEXT,
    "note" TEXT,
    "balanceOwedToSupplier" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "balanceSupplierOwesUs" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stationary_suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stationary_supplier_payments" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "direction" "StationarySupplierPaymentDirection" NOT NULL,
    "note" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "stationary_supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stationary_products" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "supplierId" TEXT,
    "name" TEXT NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "bundlePrice" INTEGER,
    "unitsPerBundle" INTEGER,
    "stockBundles" INTEGER NOT NULL DEFAULT 0,
    "stockUnits" INTEGER NOT NULL DEFAULT 0,
    "lowStockThreshold" INTEGER NOT NULL DEFAULT 10,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stationary_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stationary_restock_purchases" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalCost" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "createdById" TEXT,

    CONSTRAINT "stationary_restock_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stationary_purchase_items" (
    "id" TEXT NOT NULL,
    "restockPurchaseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "stationary_purchase_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stationary_stock_movements" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "movementType" "StationaryStockMovementType" NOT NULL,
    "quantityBundles" INTEGER NOT NULL DEFAULT 0,
    "quantityUnits" INTEGER NOT NULL DEFAULT 0,
    "unitPriceSnapshot" INTEGER,
    "note" TEXT,
    "studentRecordItemId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stationary_stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_stationary_records" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "studentFeeId" TEXT,
    "academicYearId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_stationary_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_stationary_record_items" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "categoryName" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "lineTotal" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_stationary_record_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_expense_categories" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "kind" "ExpenseCategoryKind" NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branch_expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "utility_providers" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "consumerNumber" TEXT,
    "contactNumber" TEXT,
    "note" TEXT,
    "reminderDayOfMonth" INTEGER,
    "typicalAmount" DECIMAL(12,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "utility_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_outgoing_payments" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "type" "OutgoingPaymentType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paymentMethod" "OutgoingPaymentMethod" NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reference" TEXT,
    "note" TEXT,
    "voucherNumber" TEXT NOT NULL,
    "status" "OutgoingPaymentStatus" NOT NULL DEFAULT 'PAID',
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "voidedById" TEXT,
    "recordedById" TEXT,
    "bulkRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branch_outgoing_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_bulk_runs" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "salaryMonth" TEXT NOT NULL,
    "paymentMethod" "OutgoingPaymentMethod" NOT NULL,
    "paymentKind" "PayrollPaymentKind" NOT NULL DEFAULT 'REGULAR',
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "successCount" INTEGER NOT NULL,
    "failCount" INTEGER NOT NULL,
    "note" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_bulk_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_payment_details" (
    "id" TEXT NOT NULL,
    "outgoingPaymentId" TEXT NOT NULL,
    "payeeUserId" TEXT NOT NULL,
    "payeeType" "PayrollPayeeType" NOT NULL,
    "salaryMonth" TEXT NOT NULL,
    "paymentKind" "PayrollPaymentKind" NOT NULL DEFAULT 'REGULAR',
    "profileSalary" DECIMAL(12,2) NOT NULL,
    "attendanceEarned" DECIMAL(12,2),
    "openingBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_payment_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_month_balances" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "payeeUserId" TEXT NOT NULL,
    "payeeType" "PayrollPayeeType" NOT NULL,
    "salaryMonth" TEXT NOT NULL,
    "profileSalary" DECIMAL(12,2) NOT NULL,
    "attendanceEarned" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "extraDue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "openingBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "closingBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "presentDays" INTEGER NOT NULL DEFAULT 0,
    "absentDays" INTEGER NOT NULL DEFAULT 0,
    "lateDays" INTEGER NOT NULL DEFAULT 0,
    "leaveDays" INTEGER NOT NULL DEFAULT 0,
    "unmarkedDays" INTEGER NOT NULL DEFAULT 0,
    "workingDays" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_month_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "utility_bill_details" (
    "id" TEXT NOT NULL,
    "outgoingPaymentId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "providerId" TEXT,
    "providerName" TEXT NOT NULL,
    "consumerNumber" TEXT,
    "billReference" TEXT,
    "periodStart" DATE,
    "periodEnd" DATE,
    "dueDate" DATE,
    "paymentKind" "PayrollPaymentKind" NOT NULL DEFAULT 'REGULAR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "utility_bill_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "other_payment_details" (
    "id" TEXT NOT NULL,
    "outgoingPaymentId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "payeeName" TEXT NOT NULL,
    "description" TEXT,
    "paymentKind" "PayrollPaymentKind" NOT NULL DEFAULT 'REGULAR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "other_payment_details_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_profilePhotoId_key" ON "users"("profilePhotoId");

-- CreateIndex
CREATE UNIQUE INDEX "users_rememberMeToken_key" ON "users"("rememberMeToken");

-- CreateIndex
CREATE INDEX "users_username_idx" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_phone_idx" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "file_records_storagePath_key" ON "file_records"("storagePath");

-- CreateIndex
CREATE INDEX "file_records_entityType_entityId_idx" ON "file_records"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "branches_name_key" ON "branches"("name");

-- CreateIndex
CREATE UNIQUE INDEX "branches_code_key" ON "branches"("code");

-- CreateIndex
CREATE UNIQUE INDEX "academic_calendars_label_key" ON "academic_calendars"("label");

-- CreateIndex
CREATE UNIQUE INDEX "academic_years_branchId_calendarId_key" ON "academic_years"("branchId", "calendarId");

-- CreateIndex
CREATE INDEX "academic_year_audit_logs_branchId_createdAt_idx" ON "academic_year_audit_logs"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "academic_year_audit_logs_academicYearId_createdAt_idx" ON "academic_year_audit_logs"("academicYearId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "academic_year_members_academicYearId_userId_key" ON "academic_year_members"("academicYearId", "userId");

-- CreateIndex
CREATE INDEX "branch_members_userId_idx" ON "branch_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "branch_members_branchId_userId_key" ON "branch_members"("branchId", "userId");

-- CreateIndex
CREATE INDEX "staff_module_permissions_branchMemberId_idx" ON "staff_module_permissions"("branchMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "staff_module_permissions_branchMemberId_module_key" ON "staff_module_permissions"("branchMemberId", "module");

-- CreateIndex
CREATE INDEX "branch_tenures_branchMemberId_joinedAt_idx" ON "branch_tenures"("branchMemberId", "joinedAt");

-- CreateIndex
CREATE UNIQUE INDEX "branch_tenures_branchMemberId_sequence_key" ON "branch_tenures"("branchMemberId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "groups_academicYearId_name_section_key" ON "groups"("academicYearId", "name", "section");

-- CreateIndex
CREATE UNIQUE INDEX "group_members_groupId_userId_key" ON "group_members"("groupId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "subjects_academicYearId_code_key" ON "subjects"("academicYearId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "group_subjects_groupId_subjectId_key" ON "group_subjects"("groupId", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_profiles_userId_key" ON "teacher_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_profiles_employeeId_key" ON "teacher_profiles"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "staff_profiles_userId_key" ON "staff_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "staff_profiles_employeeId_key" ON "staff_profiles"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "management_profiles_userId_key" ON "management_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "management_profiles_employeeId_key" ON "management_profiles"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "parent_profiles_userId_key" ON "parent_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "parent_profiles_cnicNumber_key" ON "parent_profiles"("cnicNumber");

-- CreateIndex
CREATE UNIQUE INDEX "student_persons_userId_key" ON "student_persons"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "student_persons_admissionNumber_key" ON "student_persons"("admissionNumber");

-- CreateIndex
CREATE INDEX "student_persons_branchId_idx" ON "student_persons"("branchId");

-- CreateIndex
CREATE INDEX "student_school_tenures_branchId_joinedAt_idx" ON "student_school_tenures"("branchId", "joinedAt");

-- CreateIndex
CREATE UNIQUE INDEX "student_school_tenures_personId_sequence_key" ON "student_school_tenures"("personId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "students_admissionNumber_key" ON "students"("admissionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "students_profilePhotoId_key" ON "students"("profilePhotoId");

-- CreateIndex
CREATE UNIQUE INDEX "students_userId_key" ON "students"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "students_studentNumber_key" ON "students"("studentNumber");

-- CreateIndex
CREATE INDEX "students_groupId_idx" ON "students"("groupId");

-- CreateIndex
CREATE INDEX "students_familyId_idx" ON "students"("familyId");

-- CreateIndex
CREATE INDEX "students_academicYearId_idx" ON "students"("academicYearId");

-- CreateIndex
CREATE INDEX "students_personId_idx" ON "students"("personId");

-- CreateIndex
CREATE INDEX "student_class_movements_academicYearId_effectiveAt_idx" ON "student_class_movements"("academicYearId", "effectiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "student_class_movements_studentId_sequence_key" ON "student_class_movements"("studentId", "sequence");

-- CreateIndex
CREATE INDEX "attendances_academicYearId_date_idx" ON "attendances"("academicYearId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "attendances_studentId_date_key" ON "attendances"("studentId", "date");

-- CreateIndex
CREATE INDEX "teacher_attendances_academicYearId_date_idx" ON "teacher_attendances"("academicYearId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_attendances_teacherId_date_key" ON "teacher_attendances"("teacherId", "date");

-- CreateIndex
CREATE INDEX "staff_attendances_academicYearId_date_idx" ON "staff_attendances"("academicYearId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "staff_attendances_staffUserId_date_key" ON "staff_attendances"("staffUserId", "date");

-- CreateIndex
CREATE INDEX "credential_sends_studentId_idx" ON "credential_sends"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "student_parents_studentId_parentId_key" ON "student_parents"("studentId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "health_records_studentId_key" ON "health_records"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_studentId_academicYearId_key" ON "enrollments"("studentId", "academicYearId");

-- CreateIndex
CREATE UNIQUE INDEX "announcements_chatMessageId_key" ON "announcements"("chatMessageId");

-- CreateIndex
CREATE INDEX "announcements_academicYearId_groupId_createdAt_idx" ON "announcements"("academicYearId", "groupId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "chat_communities_groupId_key" ON "chat_communities"("groupId");

-- CreateIndex
CREATE INDEX "chat_communities_academicYearId_idx" ON "chat_communities"("academicYearId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_rooms_teacherAssignmentId_key" ON "chat_rooms"("teacherAssignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_rooms_singletonKey_key" ON "chat_rooms"("singletonKey");

-- CreateIndex
CREATE INDEX "chat_rooms_academicYearId_kind_idx" ON "chat_rooms"("academicYearId", "kind");

-- CreateIndex
CREATE INDEX "chat_rooms_communityId_kind_idx" ON "chat_rooms"("communityId", "kind");

-- CreateIndex
CREATE INDEX "chat_rooms_classGroupId_idx" ON "chat_rooms"("classGroupId");

-- CreateIndex
CREATE INDEX "chat_rooms_studentId_kind_idx" ON "chat_rooms"("studentId", "kind");

-- CreateIndex
CREATE INDEX "chat_room_members_userId_leftAt_idx" ON "chat_room_members"("userId", "leftAt");

-- CreateIndex
CREATE UNIQUE INDEX "chat_room_members_roomId_userId_key" ON "chat_room_members"("roomId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_dm_threads_roomId_key" ON "chat_dm_threads"("roomId");

-- CreateIndex
CREATE INDEX "chat_dm_threads_participantAId_idx" ON "chat_dm_threads"("participantAId");

-- CreateIndex
CREATE INDEX "chat_dm_threads_participantBId_idx" ON "chat_dm_threads"("participantBId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_dm_threads_academicYearId_participantAId_participantBI_key" ON "chat_dm_threads"("academicYearId", "participantAId", "participantBId");

-- CreateIndex
CREATE INDEX "chat_messages_roomId_createdAt_idx" ON "chat_messages"("roomId", "createdAt");

-- CreateIndex
CREATE INDEX "chat_messages_senderId_createdAt_idx" ON "chat_messages"("senderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "chat_message_read_states_roomId_userId_key" ON "chat_message_read_states"("roomId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "class_role_definitions_communityId_name_key" ON "class_role_definitions"("communityId", "name");

-- CreateIndex
CREATE INDEX "class_role_assignments_communityId_removedAt_idx" ON "class_role_assignments"("communityId", "removedAt");

-- CreateIndex
CREATE INDEX "class_role_assignments_userId_idx" ON "class_role_assignments"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "class_role_assignments_roleDefinitionId_studentId_key" ON "class_role_assignments"("roleDefinitionId", "studentId");

-- CreateIndex
CREATE INDEX "user_push_crypto_keys_userId_createdAt_idx" ON "user_push_crypto_keys"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_push_crypto_keys_userId_keyVersion_key" ON "user_push_crypto_keys"("userId", "keyVersion");

-- CreateIndex
CREATE INDEX "attendance_notifications_studentId_date_idx" ON "attendance_notifications"("studentId", "date");

-- CreateIndex
CREATE INDEX "attendance_notifications_sent_idx" ON "attendance_notifications"("sent");

-- CreateIndex
CREATE INDEX "payment_notifications_studentId_createdAt_idx" ON "payment_notifications"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "payment_notifications_sent_idx" ON "payment_notifications"("sent");

-- CreateIndex
CREATE INDEX "batch_promotion_runs_branchId_phase_idx" ON "batch_promotion_runs"("branchId", "phase");

-- CreateIndex
CREATE INDEX "batch_promotion_runs_sourceAcademicYearId_idx" ON "batch_promotion_runs"("sourceAcademicYearId");

-- CreateIndex
CREATE INDEX "batch_promotion_runs_targetAcademicYearId_idx" ON "batch_promotion_runs"("targetAcademicYearId");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_ay_snapshots_academicYearId_teacherId_key" ON "teacher_ay_snapshots"("academicYearId", "teacherId");

-- CreateIndex
CREATE INDEX "notification_recipients_userId_isRead_idx" ON "notification_recipients"("userId", "isRead");

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_token_key" ON "device_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_key" ON "password_reset_tokens"("token");

-- CreateIndex
CREATE INDEX "password_reset_tokens_token_idx" ON "password_reset_tokens"("token");

-- CreateIndex
CREATE INDEX "exam_types_examSessionId_idx" ON "exam_types"("examSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "exam_types_examSessionId_name_key" ON "exam_types"("examSessionId", "name");

-- CreateIndex
CREATE INDEX "exam_sessions_academicYearId_idx" ON "exam_sessions"("academicYearId");

-- CreateIndex
CREATE INDEX "exams_examSessionId_idx" ON "exams"("examSessionId");

-- CreateIndex
CREATE INDEX "exams_examTypeId_idx" ON "exams"("examTypeId");

-- CreateIndex
CREATE INDEX "exam_classes_classId_idx" ON "exam_classes"("classId");

-- CreateIndex
CREATE UNIQUE INDEX "exam_classes_examId_classId_key" ON "exam_classes"("examId", "classId");

-- CreateIndex
CREATE INDEX "exam_class_subjects_subjectId_idx" ON "exam_class_subjects"("subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "exam_class_subjects_examClassId_subjectId_key" ON "exam_class_subjects"("examClassId", "subjectId");

-- CreateIndex
CREATE INDEX "marks_entries_studentId_idx" ON "marks_entries"("studentId");

-- CreateIndex
CREATE INDEX "marks_entries_enteredBy_idx" ON "marks_entries"("enteredBy");

-- CreateIndex
CREATE UNIQUE INDEX "marks_entries_examClassSubjectId_studentId_key" ON "marks_entries"("examClassSubjectId", "studentId");

-- CreateIndex
CREATE INDEX "grade_bands_gradeScaleId_idx" ON "grade_bands"("gradeScaleId");

-- CreateIndex
CREATE INDEX "subject_results_examSessionId_idx" ON "subject_results"("examSessionId");

-- CreateIndex
CREATE INDEX "subject_results_subjectId_idx" ON "subject_results"("subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "subject_results_studentId_examSessionId_subjectId_key" ON "subject_results"("studentId", "examSessionId", "subjectId");

-- CreateIndex
CREATE INDEX "report_cards_examSessionId_idx" ON "report_cards"("examSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "report_cards_studentId_examSessionId_key" ON "report_cards"("studentId", "examSessionId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_createdAt_idx" ON "audit_logs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entityId_idx" ON "audit_logs"("entity", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_module_entity_entityId_idx" ON "audit_logs"("module", "entity", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "api_keys_prefix_idx" ON "api_keys"("prefix");

-- CreateIndex
CREATE INDEX "api_keys_revokedAt_idx" ON "api_keys"("revokedAt");

-- CreateIndex
CREATE INDEX "api_keys_type_idx" ON "api_keys"("type");

-- CreateIndex
CREATE UNIQUE INDEX "admin_invitations_token_key" ON "admin_invitations"("token");

-- CreateIndex
CREATE INDEX "admin_invitations_token_idx" ON "admin_invitations"("token");

-- CreateIndex
CREATE INDEX "admin_invitations_email_idx" ON "admin_invitations"("email");

-- CreateIndex
CREATE INDEX "admin_invitations_branchId_idx" ON "admin_invitations"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "timetables_academicYearId_name_key" ON "timetables"("academicYearId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "timetable_slots_timetableId_lectureNumber_key" ON "timetable_slots"("timetableId", "lectureNumber");

-- CreateIndex
CREATE UNIQUE INDEX "timetable_entries_slotId_groupId_key" ON "timetable_entries"("slotId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "timetable_day_configs_timetableId_dayOfWeek_key" ON "timetable_day_configs"("timetableId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "student_status_logs_studentId_idx" ON "student_status_logs"("studentId");

-- CreateIndex
CREATE INDEX "families_name_idx" ON "families"("name");

-- CreateIndex
CREATE INDEX "families_isActive_idx" ON "families"("isActive");

-- CreateIndex
CREATE INDEX "families_createdById_idx" ON "families"("createdById");

-- CreateIndex
CREATE INDEX "family_change_logs_familyId_idx" ON "family_change_logs"("familyId");

-- CreateIndex
CREATE INDEX "family_change_logs_changedById_idx" ON "family_change_logs"("changedById");

-- CreateIndex
CREATE INDEX "fee_structures_academicYearId_groupId_idx" ON "fee_structures"("academicYearId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "fee_structures_academicYearId_groupId_feeHeadId_effectiveFr_key" ON "fee_structures"("academicYearId", "groupId", "feeHeadId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "fee_change_logs_feeStructureId_idx" ON "fee_change_logs"("feeStructureId");

-- CreateIndex
CREATE INDEX "student_fees_month_year_status_idx" ON "student_fees"("month", "year", "status");

-- CreateIndex
CREATE INDEX "student_fees_academicYearId_status_idx" ON "student_fees"("academicYearId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "student_fees_studentId_month_year_academicYearId_key" ON "student_fees"("studentId", "month", "year", "academicYearId");

-- CreateIndex
CREATE INDEX "fee_extra_items_studentFeeId_idx" ON "fee_extra_items"("studentFeeId");

-- CreateIndex
CREATE INDEX "fee_extra_items_sourceType_idx" ON "fee_extra_items"("sourceType");

-- CreateIndex
CREATE INDEX "fee_extra_items_stationaryRecordItemId_idx" ON "fee_extra_items"("stationaryRecordItemId");

-- CreateIndex
CREATE INDEX "fee_carry_forwards_fromStudentFeeId_idx" ON "fee_carry_forwards"("fromStudentFeeId");

-- CreateIndex
CREATE INDEX "fee_carry_forwards_toStudentFeeId_idx" ON "fee_carry_forwards"("toStudentFeeId");

-- CreateIndex
CREATE UNIQUE INDEX "family_payments_receiptNumber_key" ON "family_payments"("receiptNumber");

-- CreateIndex
CREATE INDEX "family_payments_familyId_idx" ON "family_payments"("familyId");

-- CreateIndex
CREATE INDEX "family_payments_academicYearId_idx" ON "family_payments"("academicYearId");

-- CreateIndex
CREATE UNIQUE INDEX "family_payment_receipts_familyPaymentId_key" ON "family_payment_receipts"("familyPaymentId");

-- CreateIndex
CREATE INDEX "family_payment_receipts_receiptNumber_idx" ON "family_payment_receipts"("receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "payments_receiptNumber_key" ON "payments"("receiptNumber");

-- CreateIndex
CREATE INDEX "payments_studentFeeId_idx" ON "payments"("studentFeeId");

-- CreateIndex
CREATE INDEX "payments_familyPaymentId_idx" ON "payments"("familyPaymentId");

-- CreateIndex
CREATE INDEX "payments_receiptNumber_idx" ON "payments"("receiptNumber");

-- CreateIndex
CREATE INDEX "payments_studentId_idx" ON "payments"("studentId");

-- CreateIndex
CREATE INDEX "payment_head_allocations_paymentId_idx" ON "payment_head_allocations"("paymentId");

-- CreateIndex
CREATE INDEX "payment_head_allocations_studentFeeId_idx" ON "payment_head_allocations"("studentFeeId");

-- CreateIndex
CREATE INDEX "payment_head_allocations_feeHeadId_idx" ON "payment_head_allocations"("feeHeadId");

-- CreateIndex
CREATE INDEX "payment_head_allocations_feeExtraItemId_idx" ON "payment_head_allocations"("feeExtraItemId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_receipts_paymentId_key" ON "payment_receipts"("paymentId");

-- CreateIndex
CREATE INDEX "payment_receipts_paymentId_idx" ON "payment_receipts"("paymentId");

-- CreateIndex
CREATE INDEX "payment_receipts_receiptNumber_idx" ON "payment_receipts"("receiptNumber");

-- CreateIndex
CREATE INDEX "payment_audit_logs_paymentId_createdAt_idx" ON "payment_audit_logs"("paymentId", "createdAt");

-- CreateIndex
CREATE INDEX "payment_audit_logs_performedById_createdAt_idx" ON "payment_audit_logs"("performedById", "createdAt");

-- CreateIndex
CREATE INDEX "canteen_suppliers_branchId_idx" ON "canteen_suppliers"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "canteen_suppliers_branchId_name_key" ON "canteen_suppliers"("branchId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "canteen_suppliers_id_branchId_key" ON "canteen_suppliers"("id", "branchId");

-- CreateIndex
CREATE INDEX "canteen_supplier_payments_supplierId_paidAt_idx" ON "canteen_supplier_payments"("supplierId", "paidAt");

-- CreateIndex
CREATE INDEX "canteen_product_categories_branchId_idx" ON "canteen_product_categories"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "canteen_product_categories_branchId_name_key" ON "canteen_product_categories"("branchId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "canteen_product_categories_id_branchId_key" ON "canteen_product_categories"("id", "branchId");

-- CreateIndex
CREATE INDEX "canteen_products_branchId_idx" ON "canteen_products"("branchId");

-- CreateIndex
CREATE INDEX "canteen_products_categoryId_idx" ON "canteen_products"("categoryId");

-- CreateIndex
CREATE INDEX "canteen_products_supplierId_idx" ON "canteen_products"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "canteen_products_branchId_categoryId_name_key" ON "canteen_products"("branchId", "categoryId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "canteen_products_id_branchId_key" ON "canteen_products"("id", "branchId");

-- CreateIndex
CREATE INDEX "canteen_restock_purchases_branchId_purchaseDate_idx" ON "canteen_restock_purchases"("branchId", "purchaseDate");

-- CreateIndex
CREATE INDEX "canteen_restock_purchases_supplierId_idx" ON "canteen_restock_purchases"("supplierId");

-- CreateIndex
CREATE INDEX "canteen_purchase_items_productId_idx" ON "canteen_purchase_items"("productId");

-- CreateIndex
CREATE INDEX "canteen_purchase_items_restockPurchaseId_idx" ON "canteen_purchase_items"("restockPurchaseId");

-- CreateIndex
CREATE INDEX "canteen_accounts_branchId_isActive_idx" ON "canteen_accounts"("branchId", "isActive");

-- CreateIndex
CREATE INDEX "canteen_accounts_studentId_idx" ON "canteen_accounts"("studentId");

-- CreateIndex
CREATE INDEX "canteen_accounts_userId_idx" ON "canteen_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "canteen_accounts_branchId_studentId_key" ON "canteen_accounts"("branchId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "canteen_accounts_branchId_userId_key" ON "canteen_accounts"("branchId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "canteen_accounts_id_branchId_key" ON "canteen_accounts"("id", "branchId");

-- CreateIndex
CREATE INDEX "canteen_account_payments_canteenAccountId_paidAt_idx" ON "canteen_account_payments"("canteenAccountId", "paidAt");

-- CreateIndex
CREATE INDEX "canteen_sales_branchId_soldAt_idx" ON "canteen_sales"("branchId", "soldAt");

-- CreateIndex
CREATE INDEX "canteen_sales_canteenAccountId_idx" ON "canteen_sales"("canteenAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "canteen_sales_id_branchId_key" ON "canteen_sales"("id", "branchId");

-- CreateIndex
CREATE INDEX "canteen_sale_items_productId_idx" ON "canteen_sale_items"("productId");

-- CreateIndex
CREATE INDEX "canteen_sale_items_saleId_idx" ON "canteen_sale_items"("saleId");

-- CreateIndex
CREATE INDEX "stationary_categories_branchId_idx" ON "stationary_categories"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "stationary_categories_branchId_name_key" ON "stationary_categories"("branchId", "name");

-- CreateIndex
CREATE INDEX "stationary_suppliers_branchId_idx" ON "stationary_suppliers"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "stationary_suppliers_branchId_name_key" ON "stationary_suppliers"("branchId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "stationary_suppliers_id_branchId_key" ON "stationary_suppliers"("id", "branchId");

-- CreateIndex
CREATE INDEX "stationary_supplier_payments_supplierId_paidAt_idx" ON "stationary_supplier_payments"("supplierId", "paidAt");

-- CreateIndex
CREATE INDEX "stationary_products_branchId_idx" ON "stationary_products"("branchId");

-- CreateIndex
CREATE INDEX "stationary_products_categoryId_idx" ON "stationary_products"("categoryId");

-- CreateIndex
CREATE INDEX "stationary_products_supplierId_idx" ON "stationary_products"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "stationary_products_branchId_categoryId_name_key" ON "stationary_products"("branchId", "categoryId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "stationary_products_id_branchId_key" ON "stationary_products"("id", "branchId");

-- CreateIndex
CREATE INDEX "stationary_restock_purchases_branchId_purchaseDate_idx" ON "stationary_restock_purchases"("branchId", "purchaseDate");

-- CreateIndex
CREATE INDEX "stationary_restock_purchases_supplierId_idx" ON "stationary_restock_purchases"("supplierId");

-- CreateIndex
CREATE INDEX "stationary_purchase_items_productId_idx" ON "stationary_purchase_items"("productId");

-- CreateIndex
CREATE INDEX "stationary_purchase_items_restockPurchaseId_idx" ON "stationary_purchase_items"("restockPurchaseId");

-- CreateIndex
CREATE INDEX "stationary_stock_movements_branchId_createdAt_idx" ON "stationary_stock_movements"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "stationary_stock_movements_productId_createdAt_idx" ON "stationary_stock_movements"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "stationary_stock_movements_movementType_idx" ON "stationary_stock_movements"("movementType");

-- CreateIndex
CREATE INDEX "student_stationary_records_branchId_createdAt_idx" ON "student_stationary_records"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "student_stationary_records_studentId_createdAt_idx" ON "student_stationary_records"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "student_stationary_records_studentFeeId_idx" ON "student_stationary_records"("studentFeeId");

-- CreateIndex
CREATE INDEX "student_stationary_records_academicYearId_idx" ON "student_stationary_records"("academicYearId");

-- CreateIndex
CREATE INDEX "student_stationary_record_items_recordId_idx" ON "student_stationary_record_items"("recordId");

-- CreateIndex
CREATE INDEX "student_stationary_record_items_productId_idx" ON "student_stationary_record_items"("productId");

-- CreateIndex
CREATE INDEX "branch_expense_categories_branchId_kind_idx" ON "branch_expense_categories"("branchId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "branch_expense_categories_branchId_kind_name_key" ON "branch_expense_categories"("branchId", "kind", "name");

-- CreateIndex
CREATE INDEX "utility_providers_branchId_idx" ON "utility_providers"("branchId");

-- CreateIndex
CREATE INDEX "utility_providers_categoryId_idx" ON "utility_providers"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "utility_providers_branchId_name_key" ON "utility_providers"("branchId", "name");

-- CreateIndex
CREATE INDEX "branch_outgoing_payments_branchId_type_paidAt_idx" ON "branch_outgoing_payments"("branchId", "type", "paidAt");

-- CreateIndex
CREATE INDEX "branch_outgoing_payments_branchId_status_idx" ON "branch_outgoing_payments"("branchId", "status");

-- CreateIndex
CREATE INDEX "branch_outgoing_payments_bulkRunId_idx" ON "branch_outgoing_payments"("bulkRunId");

-- CreateIndex
CREATE UNIQUE INDEX "branch_outgoing_payments_branchId_voucherNumber_key" ON "branch_outgoing_payments"("branchId", "voucherNumber");

-- CreateIndex
CREATE INDEX "payroll_bulk_runs_branchId_salaryMonth_idx" ON "payroll_bulk_runs"("branchId", "salaryMonth");

-- CreateIndex
CREATE INDEX "payroll_bulk_runs_createdAt_idx" ON "payroll_bulk_runs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_payment_details_outgoingPaymentId_key" ON "payroll_payment_details"("outgoingPaymentId");

-- CreateIndex
CREATE INDEX "payroll_payment_details_payeeUserId_salaryMonth_idx" ON "payroll_payment_details"("payeeUserId", "salaryMonth");

-- CreateIndex
CREATE INDEX "payroll_payment_details_salaryMonth_idx" ON "payroll_payment_details"("salaryMonth");

-- CreateIndex
CREATE INDEX "payroll_month_balances_branchId_salaryMonth_idx" ON "payroll_month_balances"("branchId", "salaryMonth");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_month_balances_branchId_payeeUserId_salaryMonth_key" ON "payroll_month_balances"("branchId", "payeeUserId", "salaryMonth");

-- CreateIndex
CREATE UNIQUE INDEX "utility_bill_details_outgoingPaymentId_key" ON "utility_bill_details"("outgoingPaymentId");

-- CreateIndex
CREATE INDEX "utility_bill_details_categoryId_idx" ON "utility_bill_details"("categoryId");

-- CreateIndex
CREATE INDEX "utility_bill_details_providerId_idx" ON "utility_bill_details"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "other_payment_details_outgoingPaymentId_key" ON "other_payment_details"("outgoingPaymentId");

-- CreateIndex
CREATE INDEX "other_payment_details_categoryId_idx" ON "other_payment_details"("categoryId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_profilePhotoId_fkey" FOREIGN KEY ("profilePhotoId") REFERENCES "file_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_records" ADD CONSTRAINT "file_records_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "academic_calendars"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_previousAcademicYearId_fkey" FOREIGN KEY ("previousAcademicYearId") REFERENCES "academic_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_year_audit_logs" ADD CONSTRAINT "academic_year_audit_logs_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_year_audit_logs" ADD CONSTRAINT "academic_year_audit_logs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_year_audit_logs" ADD CONSTRAINT "academic_year_audit_logs_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_year_members" ADD CONSTRAINT "academic_year_members_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_year_members" ADD CONSTRAINT "academic_year_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_members" ADD CONSTRAINT "branch_members_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_members" ADD CONSTRAINT "branch_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_members" ADD CONSTRAINT "branch_members_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_members" ADD CONSTRAINT "branch_members_resignedInFavorOfId_fkey" FOREIGN KEY ("resignedInFavorOfId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_module_permissions" ADD CONSTRAINT "staff_module_permissions_branchMemberId_fkey" FOREIGN KEY ("branchMemberId") REFERENCES "branch_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_tenures" ADD CONSTRAINT "branch_tenures_branchMemberId_fkey" FOREIGN KEY ("branchMemberId") REFERENCES "branch_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_tenures" ADD CONSTRAINT "branch_tenures_previousTenureId_fkey" FOREIGN KEY ("previousTenureId") REFERENCES "branch_tenures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_hodId_fkey" FOREIGN KEY ("hodId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_subjects" ADD CONSTRAINT "group_subjects_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_subjects" ADD CONSTRAINT "group_subjects_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_profiles" ADD CONSTRAINT "teacher_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_assignments" ADD CONSTRAINT "teacher_assignments_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_assignments" ADD CONSTRAINT "teacher_assignments_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_assignments" ADD CONSTRAINT "teacher_assignments_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_assignments" ADD CONSTRAINT "teacher_assignments_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "management_profiles" ADD CONSTRAINT "management_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_profiles" ADD CONSTRAINT "parent_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_persons" ADD CONSTRAINT "student_persons_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_persons" ADD CONSTRAINT "student_persons_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_school_tenures" ADD CONSTRAINT "student_school_tenures_personId_fkey" FOREIGN KEY ("personId") REFERENCES "student_persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_school_tenures" ADD CONSTRAINT "student_school_tenures_previousTenureId_fkey" FOREIGN KEY ("previousTenureId") REFERENCES "student_school_tenures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_profilePhotoId_fkey" FOREIGN KEY ("profilePhotoId") REFERENCES "file_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_personId_fkey" FOREIGN KEY ("personId") REFERENCES "student_persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_class_movements" ADD CONSTRAINT "student_class_movements_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_markedById_fkey" FOREIGN KEY ("markedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_attendances" ADD CONSTRAINT "teacher_attendances_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_attendances" ADD CONSTRAINT "teacher_attendances_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_attendances" ADD CONSTRAINT "teacher_attendances_markedById_fkey" FOREIGN KEY ("markedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_attendances" ADD CONSTRAINT "staff_attendances_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_attendances" ADD CONSTRAINT "staff_attendances_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_attendances" ADD CONSTRAINT "staff_attendances_markedById_fkey" FOREIGN KEY ("markedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credential_sends" ADD CONSTRAINT "credential_sends_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credential_sends" ADD CONSTRAINT "credential_sends_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_parents" ADD CONSTRAINT "student_parents_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_parents" ADD CONSTRAINT "student_parents_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "parent_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_contacts" ADD CONSTRAINT "emergency_contacts_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_records" ADD CONSTRAINT "health_records_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_year_snapshots" ADD CONSTRAINT "academic_year_snapshots_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_year_snapshots" ADD CONSTRAINT "academic_year_snapshots_newAcademicYearId_fkey" FOREIGN KEY ("newAcademicYearId") REFERENCES "academic_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_year_snapshots" ADD CONSTRAINT "academic_year_snapshots_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_snapshots" ADD CONSTRAINT "group_snapshots_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "academic_year_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_chatMessageId_fkey" FOREIGN KEY ("chatMessageId") REFERENCES "chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_communities" ADD CONSTRAINT "chat_communities_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_communities" ADD CONSTRAINT "chat_communities_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "chat_communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_classGroupId_fkey" FOREIGN KEY ("classGroupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_teacherAssignmentId_fkey" FOREIGN KEY ("teacherAssignmentId") REFERENCES "teacher_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_room_members" ADD CONSTRAINT "chat_room_members_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_room_members" ADD CONSTRAINT "chat_room_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_room_members" ADD CONSTRAINT "chat_room_members_classRoleAssignmentId_fkey" FOREIGN KEY ("classRoleAssignmentId") REFERENCES "class_role_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_dm_threads" ADD CONSTRAINT "chat_dm_threads_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_dm_threads" ADD CONSTRAINT "chat_dm_threads_participantAId_fkey" FOREIGN KEY ("participantAId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_dm_threads" ADD CONSTRAINT "chat_dm_threads_participantBId_fkey" FOREIGN KEY ("participantBId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_mediaFileId_fkey" FOREIGN KEY ("mediaFileId") REFERENCES "file_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_message_read_states" ADD CONSTRAINT "chat_message_read_states_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_message_read_states" ADD CONSTRAINT "chat_message_read_states_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_role_definitions" ADD CONSTRAINT "class_role_definitions_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "chat_communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_role_definitions" ADD CONSTRAINT "class_role_definitions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_role_assignments" ADD CONSTRAINT "class_role_assignments_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "chat_communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_role_assignments" ADD CONSTRAINT "class_role_assignments_roleDefinitionId_fkey" FOREIGN KEY ("roleDefinitionId") REFERENCES "class_role_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_role_assignments" ADD CONSTRAINT "class_role_assignments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_role_assignments" ADD CONSTRAINT "class_role_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_role_assignments" ADD CONSTRAINT "class_role_assignments_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_role_assignments" ADD CONSTRAINT "class_role_assignments_removedById_fkey" FOREIGN KEY ("removedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_push_crypto_keys" ADD CONSTRAINT "user_push_crypto_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_notifications" ADD CONSTRAINT "attendance_notifications_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_notifications" ADD CONSTRAINT "attendance_notifications_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "chat_rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_notifications" ADD CONSTRAINT "attendance_notifications_chatMessageId_fkey" FOREIGN KEY ("chatMessageId") REFERENCES "chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_notifications" ADD CONSTRAINT "payment_notifications_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_notifications" ADD CONSTRAINT "payment_notifications_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_notifications" ADD CONSTRAINT "payment_notifications_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "chat_rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_notifications" ADD CONSTRAINT "payment_notifications_chatMessageId_fkey" FOREIGN KEY ("chatMessageId") REFERENCES "chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_promotions" ADD CONSTRAINT "batch_promotions_promotedById_fkey" FOREIGN KEY ("promotedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_promotion_runs" ADD CONSTRAINT "batch_promotion_runs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_promotion_runs" ADD CONSTRAINT "batch_promotion_runs_sourceAcademicYearId_fkey" FOREIGN KEY ("sourceAcademicYearId") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_promotion_runs" ADD CONSTRAINT "batch_promotion_runs_targetAcademicYearId_fkey" FOREIGN KEY ("targetAcademicYearId") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_promotion_runs" ADD CONSTRAINT "batch_promotion_runs_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "academic_year_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_promotion_runs" ADD CONSTRAINT "batch_promotion_runs_promotedById_fkey" FOREIGN KEY ("promotedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_ay_snapshots" ADD CONSTRAINT "teacher_ay_snapshots_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_types" ADD CONSTRAINT "exam_types_examSessionId_fkey" FOREIGN KEY ("examSessionId") REFERENCES "exam_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_examSessionId_fkey" FOREIGN KEY ("examSessionId") REFERENCES "exam_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_examTypeId_fkey" FOREIGN KEY ("examTypeId") REFERENCES "exam_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_classes" ADD CONSTRAINT "exam_classes_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_classes" ADD CONSTRAINT "exam_classes_classId_fkey" FOREIGN KEY ("classId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_class_subjects" ADD CONSTRAINT "exam_class_subjects_examClassId_fkey" FOREIGN KEY ("examClassId") REFERENCES "exam_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_class_subjects" ADD CONSTRAINT "exam_class_subjects_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marks_entries" ADD CONSTRAINT "marks_entries_examClassSubjectId_fkey" FOREIGN KEY ("examClassSubjectId") REFERENCES "exam_class_subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marks_entries" ADD CONSTRAINT "marks_entries_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marks_entries" ADD CONSTRAINT "marks_entries_enteredBy_fkey" FOREIGN KEY ("enteredBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_bands" ADD CONSTRAINT "grade_bands_gradeScaleId_fkey" FOREIGN KEY ("gradeScaleId") REFERENCES "grade_scales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_results" ADD CONSTRAINT "subject_results_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_results" ADD CONSTRAINT "subject_results_examSessionId_fkey" FOREIGN KEY ("examSessionId") REFERENCES "exam_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_results" ADD CONSTRAINT "subject_results_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_cards" ADD CONSTRAINT "report_cards_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_cards" ADD CONSTRAINT "report_cards_examSessionId_fkey" FOREIGN KEY ("examSessionId") REFERENCES "exam_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_invitations" ADD CONSTRAINT "admin_invitations_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetables" ADD CONSTRAINT "timetables_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_timetableId_fkey" FOREIGN KEY ("timetableId") REFERENCES "timetables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "timetable_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_day_configs" ADD CONSTRAINT "timetable_day_configs_timetableId_fkey" FOREIGN KEY ("timetableId") REFERENCES "timetables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_status_logs" ADD CONSTRAINT "student_status_logs_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_status_logs" ADD CONSTRAINT "student_status_logs_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "families" ADD CONSTRAINT "families_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "families" ADD CONSTRAINT "families_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_change_logs" ADD CONSTRAINT "family_change_logs_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_change_logs" ADD CONSTRAINT "family_change_logs_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_feeHeadId_fkey" FOREIGN KEY ("feeHeadId") REFERENCES "fee_heads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_change_logs" ADD CONSTRAINT "fee_change_logs_feeStructureId_fkey" FOREIGN KEY ("feeStructureId") REFERENCES "fee_structures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_change_logs" ADD CONSTRAINT "fee_change_logs_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_fees" ADD CONSTRAINT "student_fees_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_fees" ADD CONSTRAINT "student_fees_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_fees" ADD CONSTRAINT "student_fees_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_extra_items" ADD CONSTRAINT "fee_extra_items_studentFeeId_fkey" FOREIGN KEY ("studentFeeId") REFERENCES "student_fees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_extra_items" ADD CONSTRAINT "fee_extra_items_stationaryRecordItemId_fkey" FOREIGN KEY ("stationaryRecordItemId") REFERENCES "student_stationary_record_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_carry_forwards" ADD CONSTRAINT "fee_carry_forwards_fromStudentFeeId_fkey" FOREIGN KEY ("fromStudentFeeId") REFERENCES "student_fees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_carry_forwards" ADD CONSTRAINT "fee_carry_forwards_toStudentFeeId_fkey" FOREIGN KEY ("toStudentFeeId") REFERENCES "student_fees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_carry_forwards" ADD CONSTRAINT "fee_carry_forwards_fromStudentId_fkey" FOREIGN KEY ("fromStudentId") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_carry_forwards" ADD CONSTRAINT "fee_carry_forwards_toStudentId_fkey" FOREIGN KEY ("toStudentId") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_payments" ADD CONSTRAINT "family_payments_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_payments" ADD CONSTRAINT "family_payments_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_payment_receipts" ADD CONSTRAINT "family_payment_receipts_familyPaymentId_fkey" FOREIGN KEY ("familyPaymentId") REFERENCES "family_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_studentFeeId_fkey" FOREIGN KEY ("studentFeeId") REFERENCES "student_fees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_familyPaymentId_fkey" FOREIGN KEY ("familyPaymentId") REFERENCES "family_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_revertedById_fkey" FOREIGN KEY ("revertedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_head_allocations" ADD CONSTRAINT "payment_head_allocations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_head_allocations" ADD CONSTRAINT "payment_head_allocations_studentFeeId_fkey" FOREIGN KEY ("studentFeeId") REFERENCES "student_fees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_head_allocations" ADD CONSTRAINT "payment_head_allocations_feeHeadId_fkey" FOREIGN KEY ("feeHeadId") REFERENCES "fee_heads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_head_allocations" ADD CONSTRAINT "payment_head_allocations_feeExtraItemId_fkey" FOREIGN KEY ("feeExtraItemId") REFERENCES "fee_extra_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_audit_logs" ADD CONSTRAINT "payment_audit_logs_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canteen_suppliers" ADD CONSTRAINT "canteen_suppliers_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canteen_supplier_payments" ADD CONSTRAINT "canteen_supplier_payments_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "canteen_suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canteen_supplier_payments" ADD CONSTRAINT "canteen_supplier_payments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canteen_product_categories" ADD CONSTRAINT "canteen_product_categories_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canteen_products" ADD CONSTRAINT "canteen_products_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canteen_products" ADD CONSTRAINT "canteen_products_categoryId_branchId_fkey" FOREIGN KEY ("categoryId", "branchId") REFERENCES "canteen_product_categories"("id", "branchId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canteen_products" ADD CONSTRAINT "canteen_products_supplierId_branchId_fkey" FOREIGN KEY ("supplierId", "branchId") REFERENCES "canteen_suppliers"("id", "branchId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canteen_restock_purchases" ADD CONSTRAINT "canteen_restock_purchases_supplierId_branchId_fkey" FOREIGN KEY ("supplierId", "branchId") REFERENCES "canteen_suppliers"("id", "branchId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canteen_restock_purchases" ADD CONSTRAINT "canteen_restock_purchases_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canteen_restock_purchases" ADD CONSTRAINT "canteen_restock_purchases_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canteen_purchase_items" ADD CONSTRAINT "canteen_purchase_items_restockPurchaseId_fkey" FOREIGN KEY ("restockPurchaseId") REFERENCES "canteen_restock_purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canteen_purchase_items" ADD CONSTRAINT "canteen_purchase_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "canteen_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canteen_accounts" ADD CONSTRAINT "canteen_accounts_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canteen_accounts" ADD CONSTRAINT "canteen_accounts_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canteen_accounts" ADD CONSTRAINT "canteen_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canteen_accounts" ADD CONSTRAINT "canteen_accounts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canteen_account_payments" ADD CONSTRAINT "canteen_account_payments_canteenAccountId_fkey" FOREIGN KEY ("canteenAccountId") REFERENCES "canteen_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canteen_account_payments" ADD CONSTRAINT "canteen_account_payments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canteen_sales" ADD CONSTRAINT "canteen_sales_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canteen_sales" ADD CONSTRAINT "canteen_sales_canteenAccountId_branchId_fkey" FOREIGN KEY ("canteenAccountId", "branchId") REFERENCES "canteen_accounts"("id", "branchId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canteen_sales" ADD CONSTRAINT "canteen_sales_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canteen_sale_items" ADD CONSTRAINT "canteen_sale_items_saleId_branchId_fkey" FOREIGN KEY ("saleId", "branchId") REFERENCES "canteen_sales"("id", "branchId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canteen_sale_items" ADD CONSTRAINT "canteen_sale_items_productId_branchId_fkey" FOREIGN KEY ("productId", "branchId") REFERENCES "canteen_products"("id", "branchId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stationary_categories" ADD CONSTRAINT "stationary_categories_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stationary_suppliers" ADD CONSTRAINT "stationary_suppliers_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stationary_supplier_payments" ADD CONSTRAINT "stationary_supplier_payments_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "stationary_suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stationary_supplier_payments" ADD CONSTRAINT "stationary_supplier_payments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stationary_products" ADD CONSTRAINT "stationary_products_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stationary_products" ADD CONSTRAINT "stationary_products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "stationary_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stationary_products" ADD CONSTRAINT "stationary_products_supplierId_branchId_fkey" FOREIGN KEY ("supplierId", "branchId") REFERENCES "stationary_suppliers"("id", "branchId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stationary_restock_purchases" ADD CONSTRAINT "stationary_restock_purchases_supplierId_branchId_fkey" FOREIGN KEY ("supplierId", "branchId") REFERENCES "stationary_suppliers"("id", "branchId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stationary_restock_purchases" ADD CONSTRAINT "stationary_restock_purchases_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stationary_restock_purchases" ADD CONSTRAINT "stationary_restock_purchases_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stationary_purchase_items" ADD CONSTRAINT "stationary_purchase_items_restockPurchaseId_fkey" FOREIGN KEY ("restockPurchaseId") REFERENCES "stationary_restock_purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stationary_purchase_items" ADD CONSTRAINT "stationary_purchase_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "stationary_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stationary_stock_movements" ADD CONSTRAINT "stationary_stock_movements_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stationary_stock_movements" ADD CONSTRAINT "stationary_stock_movements_productId_branchId_fkey" FOREIGN KEY ("productId", "branchId") REFERENCES "stationary_products"("id", "branchId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stationary_stock_movements" ADD CONSTRAINT "stationary_stock_movements_studentRecordItemId_fkey" FOREIGN KEY ("studentRecordItemId") REFERENCES "student_stationary_record_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stationary_stock_movements" ADD CONSTRAINT "stationary_stock_movements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_stationary_records" ADD CONSTRAINT "student_stationary_records_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_stationary_records" ADD CONSTRAINT "student_stationary_records_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_stationary_records" ADD CONSTRAINT "student_stationary_records_studentFeeId_fkey" FOREIGN KEY ("studentFeeId") REFERENCES "student_fees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_stationary_records" ADD CONSTRAINT "student_stationary_records_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_stationary_records" ADD CONSTRAINT "student_stationary_records_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_stationary_record_items" ADD CONSTRAINT "student_stationary_record_items_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "student_stationary_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_stationary_record_items" ADD CONSTRAINT "student_stationary_record_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "stationary_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_expense_categories" ADD CONSTRAINT "branch_expense_categories_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "utility_providers" ADD CONSTRAINT "utility_providers_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "utility_providers" ADD CONSTRAINT "utility_providers_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "branch_expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_outgoing_payments" ADD CONSTRAINT "branch_outgoing_payments_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_outgoing_payments" ADD CONSTRAINT "branch_outgoing_payments_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_outgoing_payments" ADD CONSTRAINT "branch_outgoing_payments_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_outgoing_payments" ADD CONSTRAINT "branch_outgoing_payments_bulkRunId_fkey" FOREIGN KEY ("bulkRunId") REFERENCES "payroll_bulk_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_bulk_runs" ADD CONSTRAINT "payroll_bulk_runs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_bulk_runs" ADD CONSTRAINT "payroll_bulk_runs_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_payment_details" ADD CONSTRAINT "payroll_payment_details_outgoingPaymentId_fkey" FOREIGN KEY ("outgoingPaymentId") REFERENCES "branch_outgoing_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_payment_details" ADD CONSTRAINT "payroll_payment_details_payeeUserId_fkey" FOREIGN KEY ("payeeUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_month_balances" ADD CONSTRAINT "payroll_month_balances_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "utility_bill_details" ADD CONSTRAINT "utility_bill_details_outgoingPaymentId_fkey" FOREIGN KEY ("outgoingPaymentId") REFERENCES "branch_outgoing_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "utility_bill_details" ADD CONSTRAINT "utility_bill_details_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "branch_expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "utility_bill_details" ADD CONSTRAINT "utility_bill_details_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "utility_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "other_payment_details" ADD CONSTRAINT "other_payment_details_outgoingPaymentId_fkey" FOREIGN KEY ("outgoingPaymentId") REFERENCES "branch_outgoing_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "other_payment_details" ADD CONSTRAINT "other_payment_details_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "branch_expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

