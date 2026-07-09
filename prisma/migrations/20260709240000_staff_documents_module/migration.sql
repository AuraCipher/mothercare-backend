-- Add DOCUMENTS to StaffModule enum for document drawer RBAC
ALTER TYPE "StaffModule" ADD VALUE IF NOT EXISTS 'DOCUMENTS';
