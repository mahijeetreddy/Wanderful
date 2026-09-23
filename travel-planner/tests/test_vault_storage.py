from pathlib import Path
import pytest
from vault_storage import FileVaultStorage, configured_vault
from scripts.migrate_vault import migrate


def test_storage_preserves_files_across_instances_and_rejects_overwrite(tmp_path):
    root = tmp_path / "volume"
    first = FileVaultStorage(root)
    first.put("document.pdf", b"private document")
    replacement = FileVaultStorage(root)
    assert replacement.path("document.pdf").read_bytes() == b"private document"
    with pytest.raises(FileExistsError):
        replacement.put("document.pdf", b"replacement")
    assert first.path("document.pdf").read_bytes() == b"private document"
    for name in ("../private", "..\\private", "C:private", ".", "", "a/b"):
        with pytest.raises(ValueError):
            first.path(name)


def test_production_requires_real_dedicated_mount(monkeypatch, tmp_path):
    monkeypatch.setenv("VAULT_STORAGE_DIR", str(tmp_path / "volume" / "documents"))
    monkeypatch.delenv("VAULT_VOLUME_MOUNT", raising=False)
    with pytest.raises(RuntimeError, match="requires absolute"):
        configured_vault(production=True)
    monkeypatch.setenv("VAULT_VOLUME_MOUNT", str(tmp_path / "volume"))
    monkeypatch.setattr("vault_storage.os.path.ismount", lambda _: False)
    with pytest.raises(RuntimeError, match="mounted persistent"):
        configured_vault(production=True)
    monkeypatch.setattr("vault_storage.os.path.ismount", lambda _: True)
    storage = configured_vault(production=True)
    assert storage.root == (tmp_path / "volume" / "documents").resolve()
    monkeypatch.setenv("VAULT_STORAGE_DIR", str(tmp_path / "outside"))
    with pytest.raises(RuntimeError, match="inside"):
        configured_vault(production=True)


def test_migration_is_verified_non_destructive_and_repeatable(tmp_path):
    source, destination = tmp_path / "legacy", tmp_path / "volume"
    old = FileVaultStorage(source)
    old.put("ticket.pdf", b"original ticket")
    missing = migrate(source, destination)
    assert len(missing["issues"]) == 1
    assert not destination.exists()  # Read-only verification creates nothing.
    copied = migrate(source, destination, copy=True)
    assert copied == {"verified": 1, "copied": 1, "issues": [], "source_preserved": True}
    assert old.path("ticket.pdf").read_bytes() == b"original ticket"
    assert migrate(source, destination, copy=True)["copied"] == 0
    other = FileVaultStorage(tmp_path / "different")
    other.put("ticket.pdf", b"do not overwrite")
    assert migrate(source, other.root, copy=True)["issues"]
    assert other.path("ticket.pdf").read_bytes() == b"do not overwrite"
    with pytest.raises(ValueError):
        migrate(source, source / "nested", copy=True)
