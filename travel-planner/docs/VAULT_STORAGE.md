# Private document storage

Development defaults to `.crewai_runtime/travel-vault`. Document metadata remains in
the database; file contents stay out of public assets and shared browser caches.
Every download requires the owning account and returns `Cache-Control: private, no-store`.
Files are created exclusively with private permissions; existing files cannot be overwritten.

## Container configuration

The local Compose API mounts the named `travel_vault` volume at
`/var/lib/wanderful/vault`. Replacing the API container preserves this volume.
Do not use `docker compose down --volumes` unless you explicitly intend to erase it.
Back up the database and document volume together. This configuration is not a backup.

Production requires both variables:

```text
VAULT_STORAGE_DIR=/var/lib/wanderful/vault
VAULT_VOLUME_MOUNT=/var/lib/wanderful/vault
```

Startup checks that the mount exists, is not the filesystem root, and contains the
storage directory. Provisioning/attaching a hosted persistent volume is a separate
operator action; no hosting plan or infrastructure is changed by this implementation.
Mount validation detects missing mounts, not the durability guarantees of a hosting provider.

## Move existing files safely

Stop document uploads/deletions during the copy and configuration switch. Use explicit,
separate directories; run as an account with read access to the source and write access
to the destination. This command never deletes originals or overwrites existing files.

```powershell
python scripts/migrate_vault.py --source "C:\old-vault" --destination "D:\persistent-vault" --copy
python scripts/migrate_vault.py --source "C:\old-vault" --destination "D:\persistent-vault"
```

Without `--copy`, verification is read-only. JSON output reports copied and SHA-256-verified
files, missing files, and mismatches; any issue produces a nonzero exit code. Investigate
issues before changing `VAULT_STORAGE_DIR`. Preserve filenames because database metadata
references them. Symlinks and nested directories are rejected. Source cleanup, backups,
and retention policies require a separate explicit operator decision.

Automated tests cover reopening storage, safe paths, exclusive creation, mount validation,
repeatable copy/verification, and authenticated downloads. A real container-recreation
test remains a separate acceptance check; unit tests do not prove hosted durability.
