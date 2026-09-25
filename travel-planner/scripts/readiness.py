"""Read-only readiness report. Never applies migrations or activates services."""
import argparse
from dataclasses import replace
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dotenv import load_dotenv
load_dotenv()
from config import get_settings, validate_production_settings


def report(check_database=False, check_redis=False):
    settings = get_settings()
    checks = {}
    try:
        validate_production_settings(replace(settings, environment="production"))
        checks["production_configuration"] = {"status": "passed"}
    except RuntimeError as error:
        checks["production_configuration"] = {"status": "blocked", "reason": str(error)}
    root = Path(os.getenv("VAULT_STORAGE_DIR", ".crewai_runtime/travel-vault"))
    mount = Path(os.getenv("VAULT_VOLUME_MOUNT", "."))
    volume_ok = root.is_absolute() and mount.is_absolute() and mount.resolve() != Path(mount.anchor) and os.path.ismount(mount) and root.resolve().is_relative_to(mount.resolve())
    checks["persistent_vault_mount"] = {"status": "passed" if volume_ok else "blocked"}
    dist = Path(__file__).resolve().parents[1] / "dist"
    checks["offline_build"] = {"status": "passed" if all((dist / name).is_file() for name in ("index.html", "sw.js", "manifest.webmanifest")) and '"development"' not in (dist / "sw.js").read_text() else "blocked"}
    checks["database"] = {"status": "not_checked"}
    if check_database:
        from sqlalchemy import inspect
        from database import engine, Base
        import models
        try:
            inspector = inspect(engine)
            tables = set(inspector.get_table_names())
            missing = sorted(set(Base.metadata.tables) - tables)
            columns = {name: sorted(set(table.columns.keys()) - {c["name"] for c in inspector.get_columns(name)}) for name, table in Base.metadata.tables.items() if name in tables}
            columns = {name: values for name, values in columns.items() if values}
            checks["database"] = {"status": "blocked" if missing or columns else "passed", "missing_tables": missing, "missing_columns": columns}
        except Exception:
            checks["database"] = {"status": "unavailable"}
    checks["redis"] = {"status": "not_checked"}
    if check_redis:
        from runtime_store import rq_redis_client
        try:
            connection = rq_redis_client()
            checks["redis"] = {"status": "passed" if connection and connection.ping() else "not_configured", "monitor_scheduler_heartbeat": bool(connection and connection.get("wanderful:monitor-heartbeat"))}
        except Exception:
            checks["redis"] = {"status": "unavailable"}
    checks["backup_restore_drill"] = {"status": "operator_verification_required", "reason": "Verify a database and vault backup restoration in an isolated environment before production release."}
    return {"mode": "read-only-readiness", "ready": all(value["status"] == "passed" for value in checks.values()), "checks": checks, "mutations": 0}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", action="store_true")
    parser.add_argument("--redis", action="store_true")
    args = parser.parse_args()
    result = report(args.database, args.redis)
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result["ready"] else 1)
