"""Disposable LOCAL Docker checks. Uses cached postgres:16-alpine; never pulls images.

Creates uniquely labelled test resources, then removes only those resources.
No application database, source vault, existing container, or hosted service is touched.
"""
import json
from pathlib import Path
import subprocess
import sys
import time
import uuid


def run(*args):
    result = subprocess.run(list(args), capture_output=True, text=True, timeout=120)
    if result.returncode: raise RuntimeError(result.stderr or result.stdout)
    return result.stdout.strip()


def main():
    suffix = uuid.uuid4().hex[:12]
    label = "wanderful.acceptance=" + suffix
    volume = "wanderful-vault-check-" + suffix
    container = "wanderful-migration-check-" + suffix
    image = "postgres:16-alpine"
    run("docker", "image", "inspect", image, "--format", "{{.Id}}")
    created_volume = created_container = False
    report = {}
    try:
        run("docker", "volume", "create", "--label", label, volume); created_volume = True
        run("docker", "run", "--rm", "--pull=never", "--label", label, "--mount", f"type=volume,source={volume},target=/vault", image, "sh", "-c", "cp /etc/alpine-release /vault/fixture.txt")
        # A different container reads the same fixture after the first was removed.
        run("docker", "run", "--rm", "--pull=never", "--label", label, "--mount", f"type=volume,source={volume},target=/vault", image, "sh", "-c", "cmp /etc/alpine-release /vault/fixture.txt")
        report["mounted_volume_container_recreation"] = "passed"
        run("docker", "run", "--rm", "--pull=never", "-d", "--name", container, "--label", label, "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "-e", "POSTGRES_DB=wanderful_migration_acceptance", "-p", "127.0.0.1:55439:5432", image)
        created_container = True
        for attempt in range(30):
            ready = subprocess.run(["docker", "exec", container, "pg_isready", "-U", "postgres"], capture_output=True)
            if ready.returncode == 0: break
            time.sleep(1)
        else: raise RuntimeError("Disposable PostgreSQL did not become ready.")
        report["postgres_migrations"] = json.loads(run(sys.executable, str(Path(__file__).with_name("verify_postgres_migrations.py")), "--database-url", "postgresql+psycopg://postgres@127.0.0.1:55439/wanderful_migration_acceptance"))
    finally:
        if created_container:
            metadata = json.loads(run("docker", "inspect", container))[0]
            if metadata["Config"]["Labels"].get("wanderful.acceptance") != suffix: raise RuntimeError("Refusing cleanup: container ownership mismatch.")
            run("docker", "stop", container)
        if created_volume:
            metadata = json.loads(run("docker", "volume", "inspect", volume))[0]
            if metadata["Labels"].get("wanderful.acceptance") != suffix: raise RuntimeError("Refusing cleanup: volume ownership mismatch.")
            run("docker", "volume", "rm", volume)
    report["cleanup"] = "Only uniquely labelled acceptance fixture resources removed."
    print(json.dumps(report, indent=2))


if __name__ == "__main__": main()
