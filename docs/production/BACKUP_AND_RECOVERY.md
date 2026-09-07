# Backup and recovery

QUACK Solo backups use the `quack-solo-backup-v1` directory format. Each included file is recorded with its size and SHA-256 digest. Secret-bearing filenames are excluded, secret-shaped JSON fields are redacted, and restore validates every file before touching the live data directory.

Restore is atomic at the directory boundary:

1. Validate the complete backup.
2. Copy it into a sibling staging directory.
3. Rename the current data directory to a timestamped rollback directory.
4. Rename staging into place.
5. Restore the rollback directory automatically if activation fails.

Keep the rollback directory until QUACK has launched and important missions, action-ledger records, skills, and settings have been checked. Secrets are intentionally not part of ordinary backups and must be restored separately through the operating-system secret store or environment configuration.

If `quack.sqlite` is corrupt, stop QUACK, preserve the corrupt data directory for forensics, validate the selected backup, restore it into the configured data-directory path, and relaunch. Never copy an unvalidated SQLite file over the live database.
