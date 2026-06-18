#!/bin/bash
# One-click backup: database + uploaded files
# Usage: bash backup.sh [output-dir]

OUTPUT_DIR="${1:-./backups}"
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
BACKUP_DIR="${OUTPUT_DIR}/backup-${TIMESTAMP}"

mkdir -p "${BACKUP_DIR}"

# 1. Database dump (PostgreSQL)
echo "Backing up database..."
PGPASSWORD="${DB_PASSWORD:-postgres}" pg_dump \
  -h localhost \
  -U postgres \
  -d mothercare \
  -F c \
  -f "${BACKUP_DIR}/database.dump"

# 2. Uploaded files (compressed)
echo "Backing up uploaded files..."
tar czf "${BACKUP_DIR}/uploads.tar.gz" \
  -C "$(dirname "$0")/../uploads" .

# 3. Summary
echo "Backup complete: ${BACKUP_DIR}"
ls -lh "${BACKUP_DIR}/"
