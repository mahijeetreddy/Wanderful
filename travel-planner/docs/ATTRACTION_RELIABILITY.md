# Independent attraction research and evidence review

Implemented 2026-09-30. No RAG pipeline, hosted schema/infrastructure changes, commits or pushes.

## Behavior

- Flights, stays and weather stay on the interactive collection path. Attraction research
  starts independently; planning does not wait for its completion. Already-available
  research can inform the initial draft. Late results never regenerate or modify a trip.
- Short category-specific SerpAPI Google Maps queries replace the broad multi-topic
  organic-search query for initial place research. Categories are history, nature, food
  or attractions. Free-form personal interests, travel dates and account IDs are not
  included in the shared research-cache key or query.
- Development uses two dedicated research threads, at most four admitted tasks total,
  single-flight per destination/category, a 40-second retry budget and at most two
  HTTP calls. Only transient connection/timeouts and HTTP 5xx errors are retried.
  Socket/DNS overhead means this is not a guaranteed 40-second wall-clock cutoff.
- Successful research is cached for 24 hours with its original UTC retrieval time.
  Redis is used when configured; otherwise a 128-entry process-local TTL cache is used.
  The latter does not survive restarts or coordinate multiple processes. Failure results
  have a short cooldown, not a fabricated successful result.
- The owner-authorized job research endpoint is read-only. It never starts provider
  requests. Cache reads are separate from trip/selection mutations.
- The UI labels pending/unavailable research as a draft and shows dated source checks.
  Matching requires a provider identity, coordinates, place name and destination address;
  ambiguous matches remain unverified. A source URL alone does not establish accuracy.
- Review is explicit. Applying reviewed references changes only coordinates/source identity
  for activities whose title, location and position still match. It does not change times,
  costs, descriptions or bookings. Save the trip to persist those references to a saved trip.
- Opening hours, admission prices and transit times remain **unknown**, not inferred facts.
  Failed/pending research can be checked again without automatically spending provider quota.

## Production activation is separate

Production does not launch background threads inside RQ's short-lived planning process.
Independent research is disabled until `RESEARCH_RQ_ENABLED=true` is explicitly configured
and a **separate** worker with `RQ_WORKER_QUEUE=research` runs `python worker.py` against
the existing Redis. The default worker remains `planning`. The research RQ job has a
60-second timeout and a best-effort queue-size admission check; this is not a distributed
hard concurrency limit. Keep a controlled number of research workers. Redis is required.

No hosted worker or flag was activated during implementation. Without that configuration,
production clearly reports research unavailable while itinerary planning continues.

## Measurement

Explicit two-plan live run (two concurrent planners, maximum 12 provider HTTP calls and
four LLM requests; no account writes, emails or hosted DB access):

| Metric | Rome, 6 days | London, 3 days |
| --- | ---: | ---: |
| First flights/stays | 5.903 s | 5.198 s |
| Interactive collection | 6.096 s | 6.326 s |
| Independent attraction research | 4.115 s | 3.846 s |
| Complete plan | 25.992 s | 23.548 s |
| Provider place candidates | 12 | 12 |
| Confident activity/place identity matches | 4 | 4 |

All providers returned successfully in this sample; no research retry was needed. The
provider reported 1.14 s / 1.09 s processing, versus approximately 4.1 s / 3.8 s request
wall time. Header-response timing includes network/setup/provider time: it does **not**
separately identify DNS, TLS or connection latency. The results suggest the changed query
and endpoint help, but two different runs cannot isolate a causal speedup or prove p95.

Reproduce with `python scripts/benchmark_planning.py --live --runs 2 --concurrency 2`.
Live calls are explicit and capped; missing credentials or failures remain visible.

## Operational telemetry

Jobs record queue wait, first options, first draft, ready time, enqueue-to-ready time,
trip length and per-provider cache hit/miss where known. Failure records preserve timing
metadata. Browser polling/rendering and final persistence overhead are not included in
enqueue-to-ready; this is server-stage telemetry, not a browser paint-time SLA.

`python -m evaluations.benchmark --runtime` is an explicit read-only aggregate query.
It reads status/metrics rather than whole itinerary records and groups successful latency
by trip length and cached/uncached/mixed/unknown collection. Failures and cancellations
are counted separately. Segmented p95 and full-plan p95 require 200 successful timing
samples; even enough samples do not automatically establish a representative production SLA.
No hosted telemetry query was needed to validate this change.

## Quality audit checklist

For a representative manual review, inspect the source links in the review panel. Check
identity/address, activity date coverage, schedule conflicts and arrival/departure buffers.
Record unknown opening hours, admission prices, transit durations and unsupported claims.
Do not treat structural tests or membership of a URL in a source list as factual validation.
Existing decision previews continue to flag flight/itinerary conflicts. RAG remains deferred.

## Validation

The final full backend run passed **162 tests**. A separate **11-test research suite**
also passed, including the additional production-queue routing test added after full-suite
collection. The **14 targeted browser checks** passed on desktop/mobile for research review,
draft previews and selection/logout isolation. Production build passed.
The finalized review component also passed a two-test desktop/mobile rerun after its
stale-draft safeguard was added. Local API readiness
and the frontend API proxy returned HTTP 200; the UI is available at http://127.0.0.1:5176/.
No commits, pushes, hosted activations or schema migrations were performed.
