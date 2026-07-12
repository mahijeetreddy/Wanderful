from __future__ import annotations

import os

from rq import Queue, SimpleWorker, Worker

from runtime_store import rq_redis_client


def main() -> None:
    connection = rq_redis_client()
    if not connection:
        raise RuntimeError("REDIS_URL is required to start the RQ worker.")
    # Worker forks a work-horse process per job for crash isolation and hard timeouts; os.fork
    # doesn't exist on Windows, so local dev falls back to SimpleWorker (runs jobs in-process).
    worker_class = Worker if hasattr(os, "fork") else SimpleWorker
    worker = worker_class([Queue("planning", connection=connection)], connection=connection)
    worker.work(with_scheduler=True)


if __name__ == "__main__":
    main()
