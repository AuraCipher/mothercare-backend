-- Allocate student admission/student numbers from a database sequence.
--
-- The create flow calls `nextval('students_number_seq')`, but no migration
-- ever created that sequence, so every call failed and the code fell back
-- to "MAX(studentNumber) + 1". That fallback ordered by studentNumber DESC
-- without NULLS LAST — Postgres sorts NULLs first for DESC — so it always
-- resolved to 1 and produced a duplicate admission number.
--
-- This migration creates the sequence and starts it above every student
-- number already in use, so numbers are never reused.

CREATE SEQUENCE IF NOT EXISTS "students_number_seq";

SELECT setval(
  'students_number_seq',
  GREATEST(COALESCE((SELECT MAX("studentNumber") FROM "students"), 0), 1),
  true
);
