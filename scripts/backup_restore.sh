#!/usr/bin/env bash
# EduSMS — PostgreSQL Backup & Restoration Utility
set -euo pipefail

ACTION="${1:-}"
TARGET_FILE="${2:-edusms_backup_$(date +%Y%m%d_%H%M%S).dump}"
DB_NAME="${POSTGRES_DB:-edusms}"
DB_USER="${POSTGRES_USER:-edusms}"
DB_HOST="${POSTGRES_HOST:-localhost}"
DB_PORT="${POSTGRES_PORT:-5432}"

case "$ACTION" in
  backup)
    echo "[EduSMS] Creating compressed custom-format PostgreSQL backup -> $TARGET_FILE"
    pg_dump -Fc -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$TARGET_FILE"
    chmod 600 "$TARGET_FILE"
    echo "[EduSMS] Backup complete: $TARGET_FILE"
    ;;
  restore)
    if [ ! -f "$TARGET_FILE" ]; then
      echo "Error: Backup file '$TARGET_FILE' does not exist." >&2
      exit 1
    fi
    echo "[EduSMS] Restoring '$TARGET_FILE' into database '$DB_NAME'..."
    pg_restore --clean --if-exists --no-owner -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" "$TARGET_FILE"
    echo "[EduSMS] Restore complete."
    ;;
  *)
    echo "Usage:"
    echo "  $0 backup [output_file.dump]"
    echo "  $0 restore <input_file.dump>"
    exit 1
    ;;
esac
