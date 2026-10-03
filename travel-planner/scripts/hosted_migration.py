"""Explicit backup/rehearsal and guarded upgrade for the configured application DB.

No credentials or row contents are printed. Backups remain in ignored .secrets.
prepare reads the hosted database; apply is the only hosted mutation command.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from config import settings
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url, URL
from alembic.runtime.migration import MigrationContext

PG = Path("C:/Program Files/PostgreSQL/18/bin")
STORE = ROOT / ".secrets" / "migration-backups"
SOURCE = "20260920_05"
TARGET = "20260923_08"


def run(args, env=None, timeout=120):
    startup = subprocess.STARTUPINFO() if os.name == "nt" else None
    if startup:
        startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startup.wShowWindow = 0
    # A background postmaster can inherit pg_ctl's pipes on Windows. Do not
    # wait for pipe EOF from a server that is intentionally staying alive.
    detached = Path(str(args[0])).name.lower() == "pg_ctl.exe"
    output = {"stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL} if detached else {"capture_output": True}
    result = subprocess.run([str(arg) for arg in args], env=env, cwd=ROOT, timeout=timeout, startupinfo=startup, **output)
    if result.returncode:
        # pg tools may echo connection details: never print their raw stderr.
        raise RuntimeError(f"{Path(str(args[0])).name} failed (exit {result.returncode}); hosted migration not assumed successful.")
    return result.stdout or b""


def target_url():
    runtime, migration = make_url(settings.database_url), make_url(settings.migration_database_url)
    same = (runtime.host or "").replace("-pooler", "") == (migration.host or "").replace("-pooler", "")
    if migration.get_backend_name() != "postgresql" or not same or runtime.database != migration.database or runtime.username != migration.username:
        raise ValueError("Runtime and migration database identity do not match.")
    return migration


def fingerprint(url):
    identity = [url.host, url.port or 5432, url.database, url.username]
    return hashlib.sha256(json.dumps(identity).encode()).hexdigest()


def connection_env(url):
    env = {key: value for key, value in os.environ.items() if not key.startswith("PG")}
    env.update(PGHOST=url.host or "127.0.0.1", PGPORT=str(url.port or 5432), PGDATABASE=url.database or "postgres", PGUSER=url.username or "postgres", PGPASSWORD=url.password or "", PGCONNECT_TIMEOUT="15")
    env["PGSSLMODE"] = str(url.query.get("sslmode", "prefer"))
    if "channel_binding" in url.query: env["PGCHANNELBINDING"] = str(url.query["channel_binding"])
    return env


def inventory(url, previous=None):
    engine = create_engine(url, connect_args={"connect_timeout": 15}, isolation_level="REPEATABLE READ")
    try:
        with engine.connect() as connection:
            connection.execute(text("SET TRANSACTION READ ONLY"))
            connection.execute(text("SET LOCAL TIME ZONE 'UTC'"))
            connection.execute(text("SET LOCAL statement_timeout = '60s'"))
            inspector = inspect(connection)
            revision = MigrationContext.configure(connection).get_current_revision()
            quote = engine.dialect.identifier_preparer.quote
            result = {}
            tables = previous.keys() if previous is not None else inspector.get_table_names(schema="public")
            for table in sorted(tables):
                if table == "alembic_version": continue
                columns = previous[table]["columns"] if previous else [column["name"] for column in inspector.get_columns(table, schema="public")]
                keys = inspector.get_pk_constraint(table, schema="public").get("constrained_columns") or columns
                query = "SELECT " + ",".join(quote(column) for column in columns) + " FROM public." + quote(table) + " ORDER BY " + ",".join(quote(key) for key in keys)
                digest = hashlib.sha256()
                count = 0
                for row in connection.execute(text(query)):
                    digest.update(json.dumps(list(row), sort_keys=True, default=str, ensure_ascii=True).encode() + b"\n")
                    count += 1
                result[table] = {"columns": columns, "count": count, "sha256": digest.hexdigest()}
            return {"revision": revision, "tables": result}
    finally:
        engine.dispose()


def migrate(url):
    env = {**os.environ, "DATABASE_URL": url.render_as_string(hide_password=False), "MIGRATION_DATABASE_URL": url.render_as_string(hide_password=False), "ADMIN_EMAILS": ""}
    # Lock/statement timeouts prevent an upgrade from hanging behind active writers.
    env["PGOPTIONS"] = "-c lock_timeout=10000 -c statement_timeout=120000"
    run([sys.executable, "-m", "alembic", "upgrade", TARGET], env=env, timeout=150)


def verify_schema(url):
    engine = create_engine(url, connect_args={"connect_timeout": 15})
    try:
        with engine.connect() as connection:
            connection.execute(text("SET TRANSACTION READ ONLY"))
            inspector = inspect(connection)
            required = {"search_sessions", "offer_snapshots", "trip_selections", "trip_records", "trip_history"}
            assert required <= set(inspector.get_table_names(schema="public")), "Required tables missing"
            assert "revision" in {col["name"] for col in inspector.get_columns("saved_trips", schema="public")}, "Revision column missing"
            assert MigrationContext.configure(connection).get_current_revision() == TARGET, "Revision not at target"
    finally: engine.dispose()


def prepare():
    url = target_url()
    before = inventory(url)
    if before["revision"] != SOURCE: raise ValueError("Source revision differs from reviewed migrations; stop and review.")
    STORE.mkdir(parents=True, exist_ok=True)
    folder = STORE / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + secrets.token_hex(3))
    folder.mkdir()
    if os.name == "nt":
        account = run(["whoami"]).decode().strip()
        run(["icacls", folder, "/inheritance:r", "/grant:r", f"{account}:(OI)(CI)F"])
    archive = folder / "application-public.dump"
    print("Creating private public-schema backup…", flush=True)
    run([PG / "pg_dump.exe", "--format=custom", "--schema=public", "--no-owner", "--no-acl", "--file", archive], env=connection_env(url), timeout=180)
    run([PG / "pg_restore.exe", "--list", archive])
    after = inventory(url, before["tables"])
    if before != after: raise ValueError("Database changed during backup. Stop edits and prepare a fresh backup.")
    cluster = folder / "restore-cluster"
    password = secrets.token_urlsafe(32)
    password_file = folder / "local-restore-password"
    password_file.write_text(password, encoding="utf-8")
    local = URL.create("postgresql+psycopg", username="restore_owner", password=password, host="127.0.0.1", port=55441, database="postgres", query={"sslmode": "disable"})
    started = False
    try:
        run([PG / "initdb.exe", "-D", cluster, "-U", "restore_owner", "--auth-host=scram-sha-256", "--auth-local=scram-sha-256", "--pwfile", password_file, "--encoding=UTF8", "--locale=C"])
        run([PG / "pg_ctl.exe", "-D", cluster, "-l", folder / "restore.log", "-o", "-h 127.0.0.1 -p 55441", "-w", "start"])
        started = True
        print("Restoring backup into isolated local PostgreSQL…", flush=True)
        # Only this fresh, password-isolated local cluster is a restore target.
        # Replace initdb's empty public schema with the archived public schema.
        run([PG / "pg_restore.exe", "--exit-on-error", "--clean", "--if-exists", "--no-owner", "--no-acl", "--dbname=postgres", archive], env=connection_env(local), timeout=180)
        if inventory(local, before["tables"]) != before: raise ValueError("Restore content verification failed.")
        print("Rehearsing additive migrations on the restored copy…", flush=True)
        migrate(local)
        restored = inventory(local, before["tables"])
        if restored["tables"] != before["tables"]: raise ValueError("Migration changed existing row contents during rehearsal.")
        verify_schema(local)
        manifest = {"target_fingerprint": fingerprint(url), "source_revision": SOURCE, "target_revision": TARGET, "created_at": datetime.now(timezone.utc).isoformat(), "backup_sha256": hashlib.sha256(archive.read_bytes()).hexdigest(), "before": before, "restore_verified": True, "migration_rehearsed": True}
        (folder / "verification.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        print(json.dumps({"prepared": str(folder.relative_to(ROOT)), "restore_verified": True, "migration_rehearsed": True, "table_count": len(before["tables"])}))
    finally:
        if started: run([PG / "pg_ctl.exe", "-D", cluster, "-m", "fast", "-w", "stop"])
        if password_file.exists(): password_file.unlink()


def apply(folder_name):
    folder = (ROOT / folder_name).resolve()
    if folder.parent != STORE.resolve(): raise ValueError("Use a prepared backup directory under .secrets/migration-backups.")
    manifest = json.loads((folder / "verification.json").read_text(encoding="utf-8"))
    url = target_url()
    if not manifest.get("restore_verified") or not manifest.get("migration_rehearsed") or manifest["target_fingerprint"] != fingerprint(url):
        raise ValueError("Backup verification or target identity does not match.")
    if (datetime.now(timezone.utc) - datetime.fromisoformat(manifest["created_at"])).total_seconds() > 3600:
        raise ValueError("Backup verification is over an hour old. Prepare a fresh copy.")
    archive = folder / "application-public.dump"
    if hashlib.sha256(archive.read_bytes()).hexdigest() != manifest["backup_sha256"]: raise ValueError("Backup checksum mismatch.")
    current = inventory(url, manifest["before"]["tables"])
    if current != manifest["before"]: raise ValueError("Hosted rows or revision changed after backup; prepare again.")
    print("Applying the approved hosted migration…", flush=True)
    migrate(url)
    after = inventory(url, manifest["before"]["tables"])
    verify_schema(url)
    preserved = after["tables"] == manifest["before"]["tables"]
    result = {"revision": after["revision"], "existing_rows_unchanged": preserved, "verified_at": datetime.now(timezone.utc).isoformat()}
    (folder / "applied.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))
    if not preserved: raise ValueError("Schema upgraded, but row fingerprints changed. Review concurrent writes; do not roll back automatically.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("prepare", "apply"))
    parser.add_argument("--backup")
    args = parser.parse_args()
    try:
        prepare() if args.operation == "prepare" else apply(args.backup or "")
    except Exception as exc:
        print(json.dumps({"error": str(exc) if isinstance(exc, (ValueError, AssertionError, RuntimeError)) else type(exc).__name__, "operation": args.operation}), file=sys.stderr)
        raise SystemExit(1)
