"""Separate opt-in RQ worker; never consumes the interactive planning queue."""
import os
import threading
import time
from rq import Queue, Worker, SimpleWorker
from runtime_store import rq_redis_client
from config import settings, validate_production_settings
from weather_monitoring import enabled, run_monitoring, QUEUE, INTERVAL


def main():
    validate_production_settings(settings)
    if not enabled(): raise RuntimeError("Weather monitoring is disabled. Configure explicitly before starting.")
    if not os.getenv("OPENWEATHER_API_KEY"): raise RuntimeError("OPENWEATHER_API_KEY is required.")
    connection = rq_redis_client()
    if not connection: raise RuntimeError("REDIS_URL is required.")
    queue = Queue(QUEUE, connection=connection)
    def schedule():
        while True:
            bucket = int(time.time()) // INTERVAL
            lock = f"wanderful:monitor-scheduled:{bucket}"
            if connection.set(lock, "1", nx=True, ex=INTERVAL):
                try: queue.enqueue(run_monitoring, max_requests=20, job_timeout=600, result_ttl=INTERVAL, job_id=f"weather-{bucket}")
                except Exception:
                    connection.delete(lock)
                    raise
            time.sleep(60)
    threading.Thread(target=schedule, daemon=True).start()
    worker_class = Worker if hasattr(os, "fork") else SimpleWorker
    worker_class([queue], connection=connection).work()


if __name__ == "__main__": main()
