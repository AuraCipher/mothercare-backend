-- Repair students that were created under the wrong academic year.
--
-- `StudentService.create` used to resolve the academic year with a global
-- "first ACTIVE academic year" lookup, which could return a year belonging
-- to a DIFFERENT branch. Those students were written with that foreign
-- academicYearId, so every list scoped to the admin's own branch/year
-- (GET /admin/students filters on academicYearId) silently omitted them —
-- they only showed up on their own detail page.
--
-- The class (group) a student is assigned to is authoritative for the
-- academic year, and the branch comes from that year.

-- 1. A student always belongs to the academic year of their class.
UPDATE students s
SET "academicYearId" = g."academicYearId"
FROM groups g
WHERE g.id = s."groupId"
  AND s."academicYearId" IS DISTINCT FROM g."academicYearId";

-- 2. The person record must sit in the same branch as the student's year.
UPDATE student_persons p
SET "branchId" = ay."branchId"
FROM academic_years ay
WHERE ay.id IN (SELECT DISTINCT "academicYearId" FROM students WHERE "personId" = p.id)
  AND p."branchId" IS DISTINCT FROM ay."branchId";
