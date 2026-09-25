from scripts.readiness import report


def test_readiness_is_read_only_and_does_not_claim_backups_verified(monkeypatch, tmp_path):
    vault = tmp_path / "not-created"
    monkeypatch.setenv("VAULT_STORAGE_DIR", str(vault))
    monkeypatch.delenv("VAULT_VOLUME_MOUNT", raising=False)
    result = report(check_database=True)
    assert result["mutations"] == 0 and not result["ready"]
    assert result["checks"]["database"]["status"] == "passed"
    assert result["checks"]["backup_restore_drill"]["status"] == "operator_verification_required"
    assert not vault.exists()
