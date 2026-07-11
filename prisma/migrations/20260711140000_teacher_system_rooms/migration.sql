-- Teacher fixed contacts: own attendance + payroll (salary), not student data
ALTER TYPE "ChatRoomKind" ADD VALUE 'system_teacher_attendance';
ALTER TYPE "ChatRoomKind" ADD VALUE 'system_teacher_payroll';
