# Graph Report - backend  (2026-07-04)

## Corpus Check
- 129 files · ~87,811 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 640 nodes · 1141 edges · 39 communities (31 shown, 8 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a20d7f77`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]

## God Nodes (most connected - your core abstractions)
1. `prisma` - 33 edges
2. `prismaMock` - 23 edges
3. `logAudit()` - 22 edges
4. `StudentService` - 18 edges
5. `AcademicYearService` - 17 edges
6. `unique()` - 16 edges
7. `scripts` - 15 edges
8. `pastDate()` - 15 edges
9. `compilerOptions` - 13 edges
10. `createMockUser()` - 12 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `printStartupBanner()`  [EXTRACTED]
  server.ts → src/lib/startup.ts
- `main()` --calls--> `runStartupChecks()`  [EXTRACTED]
  server.ts → src/lib/startup.ts
- `main()` --calls--> `setupGracefulShutdown()`  [EXTRACTED]
  server.ts → src/lib/startup.ts
- `blacklistToken()` --calls--> `getUpstashRedis()`  [EXTRACTED]
  src/lib/jwt.ts → src/config/redis.ts
- `isBlacklisted()` --calls--> `getUpstashRedis()`  [EXTRACTED]
  src/lib/jwt.ts → src/config/redis.ts

## Import Cycles
- None detected.

## Communities (39 total, 8 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.07
Nodes (53): adminToken, fileTypeMock, managementToken, multerMock, parentToken, sharpMock, teacherToken, adminToken (+45 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (28): createApiKey, listApiKeys, revokeApiKey, router, AuditContext, auditContextMiddleware(), auditContextStorage, router (+20 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (43): author, dependencies, bcryptjs, cookie-parser, cors, dotenv, express, express-rate-limit (+35 more)

### Community 3 - "Community 3"
Cohesion: 0.10
Nodes (21): authMiddleware(), resolveTargetBranchCode(), AuthService, LoginInput, loginSchema, prisma, envSchema, parsed (+13 more)

### Community 4 - "Community 4"
Cohesion: 0.11
Nodes (10): diffFields(), logAudit(), LogAuditParams, CreateExamInput, ExamService, UpdateExamInput, ExamStructureService, CreateExamTypeInput (+2 more)

### Community 5 - "Community 5"
Cohesion: 0.12
Nodes (11): CreateStudentInput, StudentService, UpdateStudentInput, decodeUsername(), DIGIT_TO_LETTER, generatePassword(), generateUsername(), LETTER_TO_DIGIT (+3 more)

### Community 6 - "Community 6"
Cohesion: 0.11
Nodes (9): prisma, router, router, CreateAcademicYearInput, UpdateAcademicYearInput, AddMemberInput, BranchMemberService, UpdateMemberInput (+1 more)

### Community 7 - "Community 7"
Cohesion: 0.07
Nodes (27): devDependencies, eslint, jest, jest-junit, jest-mock-extended, nodemon, prisma, supertest (+19 more)

### Community 8 - "Community 8"
Cohesion: 0.11
Nodes (7): router, router, router, router, router, router, router

### Community 9 - "Community 9"
Cohesion: 0.19
Nodes (15): changePassword, COOKIE_OPTIONS, forgotPassword, getMe, login, logout, refresh, resetPassword (+7 more)

### Community 10 - "Community 10"
Cohesion: 0.17
Nodes (16): CALENDAR_END, CALENDAR_START, DATESHEET_PAPERS, DEFAULT_GROUPS, DEFAULT_SUBJECTS, DEFAULT_TEACHERS, ensureAcademicYear(), ensureBranch() (+8 more)

### Community 11 - "Community 11"
Cohesion: 0.14
Nodes (4): router, TimetableEntryService, TimetableService, TimetableSlotService

### Community 12 - "Community 12"
Cohesion: 0.20
Nodes (3): NotificationService, twilioClient, TeacherProfileService

### Community 13 - "Community 13"
Cohesion: 0.12
Nodes (15): compilerOptions, allowSyntheticDefaultImports, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution, outDir (+7 more)

### Community 14 - "Community 14"
Cohesion: 0.25
Nodes (6): router, computeCompetitionRanks(), computeWeightedAverage(), ExamResult, lookupGrade(), SubjectResultService

### Community 15 - "Community 15"
Cohesion: 0.18
Nodes (6): BranchRole, requireBranchAdmin(), requireBranchRole(), branchScopeMiddleware(), router, BranchAdminService

### Community 17 - "Community 17"
Cohesion: 0.18
Nodes (4): router, CreateSubjectInput, SubjectService, UpdateSubjectInput

### Community 18 - "Community 18"
Cohesion: 0.17
Nodes (3): fileTypeFromBuffer(), mockResult, UploadService

### Community 19 - "Community 19"
Cohesion: 0.20
Nodes (4): router, BranchService, CreateBranchInput, UpdateBranchInput

### Community 20 - "Community 20"
Cohesion: 0.20
Nodes (5): LocalStorageAdapter, storage, StorageService, UPLOAD_ROOT, ALLOWED_MIMES

### Community 21 - "Community 21"
Cohesion: 0.24
Nodes (5): ApiKeyService, extractBranchCode(), generateKey(), generatePrefix(), prisma

### Community 22 - "Community 22"
Cohesion: 0.20
Nodes (4): router, CreateExamSessionInput, ExamSessionService, UpdateExamSessionInput

### Community 23 - "Community 23"
Cohesion: 0.20
Nodes (6): router, CreateAssignmentInput, CreateTeacherProfileInput, TeacherAssignmentService, UpdateAssignmentInput, UpdateTeacherProfileInput

### Community 24 - "Community 24"
Cohesion: 0.24
Nodes (4): router, MarksEntryInput, MarksEntryService, SaveMarksData

### Community 25 - "Community 25"
Cohesion: 0.24
Nodes (5): router, passwordSetLimiter, uploadLimiter, router, upload

### Community 26 - "Community 26"
Cohesion: 0.22
Nodes (3): AcademicCalendarService, CreateCalendarInput, UpdateCalendarInput

### Community 30 - "Community 30"
Cohesion: 0.33
Nodes (5): compilerOptions, rootDir, types, extends, include

## Knowledge Gaps
- **169 isolated node(s):** `config`, `name`, `version`, `description`, `main` (+164 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `prisma` connect `Community 6` to `Community 3`, `Community 4`, `Community 5`, `Community 8`, `Community 11`, `Community 14`, `Community 15`, `Community 17`, `Community 19`, `Community 20`, `Community 22`, `Community 23`, `Community 24`, `Community 25`, `Community 26`, `Community 27`?**
  _High betweenness centrality (0.109) - this node is a cross-community bridge._
- **Why does `AcademicYearService` connect `Community 16` to `Community 6`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Why does `StudentService` connect `Community 5` to `Community 0`, `Community 25`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **What connects `config`, `name`, `version` to the rest of the system?**
  _169 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.06540447504302926 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.06105457909343201 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.045454545454545456 - nodes in this community are weakly interconnected._