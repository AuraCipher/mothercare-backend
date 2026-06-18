#!/bin/bash
# One-click restore: database + uploaded files
# Usage: bash restore.sh <backup-dir>

BACKUP_DIR="${1}"
if [ -z "${BACKUP_DIR}" ]; then
  echo "Usage: bash restore.sh <backup-dir>"
  exit 1
fi

if [ ! -f "${BACKUP_DIR}/database.dump" ]; then
  echo "Error: No database.dump found in ${BACKUP_DIR}"
  exit 1
fi

# 1. Restore database
echo "Restoring database..."
PGPASSWORD="${DB_PASSWORD:-postgres}" pg_restore \
  -h localhost \
  -U postgres \
  -d mothercare \
  --clean \
  -j 4 \
  "${BACKUP_DIR}/database.dump" || echo "Warning: Some restore errors may be ignored"

# 2. Restore uploaded files
echo "Restoring uploaded files..."
if [ -f "${BACKUP_DIR}/uploads.tar.gz" ]; then
  tar xzf "${BACKUP_DIR}/uploads.tar.gz" \
    -C "$(dirname "$0")/../uploads"
fi

echo "Restore complete"
