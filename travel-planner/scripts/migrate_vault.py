"""Copy/verify legacy vault files without deleting sources or overwriting targets.

Usage: python scripts/migrate_vault.py --source PATH --destination PATH [--copy]
Exit code 1 means at least one file is missing, different, unsafe, or unreadable.
Run verification again after copying, before changing VAULT_STORAGE_DIR.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from vault_storage import FileVaultStorage


def migrate(source: Path, destination: Path, *, copy: bool = False) -> dict:
    source, destination = source.resolve(), destination.resolve()
    if not source.is_dir() or source == destination or source in destination.parents or destination in source.parents:
        raise ValueError("Use separate, non-overlapping source and destination directories.")
    if copy:
        storage = FileVaultStorage(destination)
    else:
        storage = None
    report = {"verified": 0, "copied": 0, "issues": [], "source_preserved": True}
    for entry in sorted(source.iterdir()):
        if entry.is_symlink() or not entry.is_file():
            report["issues"].append({"name": entry.name, "error": "Only regular, non-symlink files are supported."})
            continue
        try:
            target = destination / entry.name
            if target.is_symlink():
                raise ValueError("Destination is a symlink.")
            content = entry.read_bytes()
            if not target.exists() and storage:
                storage.put(entry.name, content)
                report["copied"] += 1
            if not target.is_file():
                raise ValueError("Destination file is missing; use --copy to create it.")
            if hashlib.sha256(content).digest() != hashlib.sha256(target.read_bytes()).digest():
                raise ValueError("Checksum mismatch; destination was not overwritten.")
            report["verified"] += 1
        except (OSError, ValueError) as error:
            report["issues"].append({"name": entry.name, "error": str(error)})
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--copy", action="store_true")
    args = parser.parse_args()
    try:
        result = migrate(args.source, args.destination, copy=args.copy)
    except (ValueError, OSError) as error:
        parser.exit(1, f"Vault verification failed: {error}\n")
    print(json.dumps(result, indent=2))
    sys.exit(1 if result["issues"] else 0)
