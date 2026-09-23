"""Private, filesystem-backed document storage; never a public static directory."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Protocol


class VaultStorage(Protocol):
    def put(self, name: str, content: bytes) -> None: ...
    def path(self, name: str) -> Path: ...
    def delete(self, name: str) -> None: ...


class FileVaultStorage:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)

    def path(self, name: str) -> Path:
        if not isinstance(name, str) or not name or name in {".", ".."} or any(char in name for char in ("/", "\\", ":", "\x00")):
            raise ValueError("Invalid vault file name.")
        candidate = self.root / name
        if candidate.is_symlink() or candidate.resolve().parent != self.root:
            raise ValueError("Invalid vault path.")
        return candidate

    def put(self, name: str, content: bytes) -> None:
        target = self.path(name)
        # Exclusive creation avoids replacing either a document or a raced-in symlink.
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
        except BaseException:
            target.unlink(missing_ok=True)
            raise

    def delete(self, name: str) -> None:
        self.path(name).unlink(missing_ok=True)


def configured_vault(*, production: bool) -> FileVaultStorage:
    configured = os.getenv("VAULT_STORAGE_DIR", "")
    root = Path(configured) if configured else Path.cwd() / ".crewai_runtime" / "travel-vault"
    if production:
        mount_setting = os.getenv("VAULT_VOLUME_MOUNT", "")
        if not configured or not root.is_absolute() or not mount_setting:
            raise RuntimeError("Production vault requires absolute VAULT_STORAGE_DIR and VAULT_VOLUME_MOUNT.")
        mount = Path(mount_setting)
        if not mount.is_absolute() or mount.resolve() == Path(mount.anchor) or not os.path.ismount(mount):
            raise RuntimeError("VAULT_VOLUME_MOUNT must be a dedicated mounted persistent volume, not the filesystem root.")
        if not root.resolve().is_relative_to(mount.resolve()):
            raise RuntimeError("VAULT_STORAGE_DIR must be inside VAULT_VOLUME_MOUNT.")
    return FileVaultStorage(root)
