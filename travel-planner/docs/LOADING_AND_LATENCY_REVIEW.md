# Loading experience and latency review

## Implemented (September 30, 2026)

- Public provider responses have a bounded process-local TTL cache (128 entries,
  256 KB maximum per entry) so repeated local searches benefit even without Redis.
  Redis remains available for cross-process caching. This cache contains no account,
  saved-trip, document, payment, or generated-itinerary records.
- Initial flight/stay cache keys now reflect their actual unfiltered query.
  Changing a soft budget target re-ranks the same quotes instead of fetching them
  again. Dates, traveler counts, currency and destination still distinguish keys.
- Explicit rechecks bypass both cache layers. Provider retrieval timestamps remain
  unchanged; cache hits do not make prices fresh again. Failures are not inserted.
  Redis write failures do not discard successful responses.
- Native Gemini requests no longer repeat the entire output schema in both prompt
  text and SDK configuration. Alternative JSON-mode providers retain a text schema.
- A shared SVG/CSS loading component covers flights/returns/handoffs, stays/property
  details, itinerary generation, route resolution, guidebooks, journals, trip tools,
  comparison searches, inbox processing, vault operations, money, account lists,
  preferences, shared trips, job history and offline opening. Small submit buttons
  retain their existing disabled/busy labels rather than growing into illustrations.
- Scenes use cream/blue/orange in light mode and blue/gold in dark mode. Motion
  finishes within four seconds, has a pause control on full scenes, and is disabled
  for reduced-motion users. No timers, animation library, raster downloads, or fake
  percentage progress. Existing results remain visible during refreshes.

## Critical path and next architectural priorities

The last recorded live runs, **before these changes**, were 25.992 seconds for six
days and 23.548 seconds for three days. These are individual samples, not p95.
Provider collection took roughly 6 seconds; generation roughly 17–20 seconds.
See [research measurements](ATTRACTION_RELIABILITY.md).

1. **Measure publication overhead.** `job_tasks.publish_provider` synchronously
   persists offer snapshots, while `publish_days` performs cancellation checks and
   database progress writes inside the model streaming callback. Slow database
   round trips can therefore delay collection/stream consumption. Instrument these
   separately, then use a bounded latest-preview publisher if material. Final trip
   persistence and offer ownership must remain transactional; never fire-and-forget
   final saves or weaken logout/cancellation checks.
2. **Coalesce identical in-flight provider requests.** The new local cache avoids
   sequential repeats, not simultaneous misses. A bounded single-flight layer can
   reduce duplicate calls during bursts; it needs independent waiter deadlines,
   forced-refresh ordering, and tests for failures/cancellation. Across workers this
   requires Redis coordination, not just Python thread locks.
3. **Separate activity drafting from quote completion only with an explicit data
   contract.** Today generation waits for flights, hotels and weather. Starting it
   early could overlap approximately six seconds, but arrival constraints and
   price estimates would need deterministic reconciliation before publishing the
   final plan. Do not remove provider grounding to make a benchmark look faster.
4. **Evaluate model/output tradeoffs with fixtures and bounded live trials.** The
   model dominates cold generation. Compare completion/repair rates and factual
   checks as well as latency. More threads/processes do not accelerate a single
   remote inference; per-day parallel calls can increase quota pressure and harm
   coherence. Existing RQ remains for isolation/throughput, not a speed guarantee.
5. **Measure cold imports and queue wait independently.** Agent-framework imports
   and worker startup are distinct from warm generation time. Lazy-load legacy
   planning dependencies after confirming all entry points and compatibility tests.

## Verification and limits

- Backend regression suite: **167 passed** after the cache/prompt changes.
- October 3 follow-up: production build passed; all **5 cache-focused tests**
  passed, including an additional budget-only query-reuse regression.
- Full desktop/mobile browser suite: **56 passed** (6.9 minutes), including
  production offline reload/logout and the new themed loading checks. Flight and
  hotel screenshots were visually inspected in dark and light themes.
- New cache tests cover eviction, expiry, response size, failures, force refresh,
  query separation and unchanged retrieval timestamps.
- Browser coverage adds desktop/mobile loading transitions, light-theme contrast,
  reduced motion and pause behavior alongside existing draft and route journeys.
- No new live-provider benchmark was run for this increment. No percentage speedup
  or production p95 is claimed. Process-local caching is not distributed caching.
- No RAG, paid services, hosted migrations, deployments, commits or pushes.
