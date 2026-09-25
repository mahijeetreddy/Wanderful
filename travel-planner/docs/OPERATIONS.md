# Local operations and release gates

These commands do not deploy the app. Hosted migrations, mounting a production volume,
and starting scheduled workers remain explicit operator actions.

## Offline companion

Prepare a saved trip in **Trip tools → Budget, offline & recovery → Offline Companion**.
Then open `/offline` once and verify the prepared trip before disconnecting. The production
build installs a versioned application shell and precaches its hashed JavaScript/CSS.
The offline page only reads account-scoped IndexedDB packs. It does not fetch private APIs,
map tiles, document files, or live prices. Explicit logout/account deletion clears device
copies; a cross-tab generation check prevents late saves from restoring them. A device
copy is not encrypted storage: prepare packs only on a trusted device.

The companion is read-only. Reconnection requires session validation before mutations.
The development service worker does not precache a shell; test real offline reloads using
`npm run build` followed by `npm run preview`. Flask also serves `/offline`, `/sw.js`,
and `/manifest.webmanifest` from the production build with appropriate worker headers.

## Itinerary history

Open **Itinerary history** on the saved trip or its Trip tools tab. Choose a revision and
explicitly restore it. Restoring creates another revision; it does not delete history.
It only restores itinerary content and selected snapshots. Payments, settlements,
documents, priorities, monitoring subscriptions and booking status are not undone.
Conflicts with recorded bookings/payments require separate explicit review.

## Weather watch — disabled by default

The only automatic monitoring capability is OpenWeather's five-day/three-hour forecast.
Flight delays, fatigue and other disruptions remain user-triggered. Forecast thresholds
are planning heuristics, not official safety alerts: thunderstorms, snow, at least 5 mm
rain per three-hour slot, wind at least 12 m/s, temperatures at least 35°C or at most 0°C.
No email is sent; no itinerary changes are automatic.

Requirements: existing `OPENWEATHER_API_KEY`, `REDIS_URL`, and a migrated database.
Only after operator configuration, set `WEATHER_MONITORING_ENABLED=true` and run:

```powershell
python monitor_worker.py
```

Local Compose also provides an optional `monitoring` profile (`weather-monitor` service).
It still requires the explicit feature flag in `.env` and already-applied schema. Nothing
starts it during ordinary `docker compose up`; do not enable it against an unmigrated DB.

This process consumes **weather-monitoring**, never **planning**. Its scheduler enqueues
one capped batch every six-hour UTC bucket, deduplicated through Redis. Each batch makes
at most 20 forecast requests. Exact destination coordinates share a cached forecast for
that bucket. Missing credentials, absent coordinates, out-of-window trips, unavailable
forecasts and exhausted caps do not produce invented alerts. Users separately opt in on
each saved trip. Stopping the worker or setting the feature flag false disables checking.
The worker is not started or added to hosted infrastructure by implementation.

Scheduler ticks retry transient Redis/enqueue failures without terminating the scheduler
thread. A short-lived `wanderful:monitor-heartbeat` key indicates scheduler activity,
not successful forecast delivery. Notices are labelled current, resolved, stale (no
usable refresh within 12 hours), or expired. Only current notices on enabled subscriptions
offer recovery previews. Repeated unchanged forecasts refresh freshness without new alerts.

## Evaluation and performance

```powershell
python -m evaluations.benchmark
python -m evaluations.benchmark --runtime
python -m evaluations.benchmark --live-query query.json --max-requests 1
```

The default command is an eight-case recorded-fixture contract evaluation, included in CI.
`--runtime` reads aggregate telemetry from the configured database/Redis without provider
requests. It reports missing samples, failures, provider/first-useful/full-plan timings,
fallback rate, offer completeness, cache hits, cached-call timings, and handoff counters.
No account identifiers or trip contents are printed. Redis timing samples are capped at
1,000 and expire after seven days. Cached-call timing measures a backend cache lookup,
not browser/network round-trip latency.

Live probes are explicit, synchronous SerpAPI requests with a cap of 1–5. `query.json`
contains normal `google_flights` or `google_hotels` parameters, never credentials. The
command reads the existing environment key and reports missing credentials/errors without
substituting fixture success. It does not create a trip, book, or purchase anything.
These probes can consume the existing provider quota; none were run automatically.
See [measured benchmark notes](BENCHMARKS.md). Targets are not guarantees.

## Disposable local acceptance checks

Before any release, run the read-only preflight:

```powershell
python scripts/readiness.py --database --redis
```

It checks production settings, schema table/column presence, Redis, the dedicated vault
mount and offline build assets without applying migrations or creating directories. It
does not certify constraints/indexes or backups. Backup restoration remains a mandatory
operator gate: restore a matching database/vault backup into an isolated environment,
verify document hashes and owner-only downloads, verify trip/ledger counts, record the
backup timestamps and results, and retain the originals. Never test restores against the
active database. Apply hosted migrations and enable workers only after explicit approval.

Current environment preflight (2026-09-25): missing search sessions/offer snapshots/trip
records/selections/history tables and saved-trip revision; Redis unset; secure-cookie/CSRF
flags not production-ready; dedicated vault mount absent. These settings were not changed.

```powershell
python -m pytest -q
npm run build
npm run test:browser
python scripts/verify_local_acceptance.py
```

Browser tests run the dev app on port 5174 and production preview on 5175; build first.
They use desktop/mobile profiles, reduced-motion preference and mocked provider responses.
Screenshots/traces are in ignored `test-results/`. No real accounts or bookings are used.

The Docker check requires cached `postgres:16-alpine` and free localhost port 55439.
It never pulls images. It creates uniquely labelled disposable resources, verifies
file persistence across container replacement and additive migrations through revision 08,
then validates ownership labels before removing only its own fixture containers/volumes.
Existing trips, legacy expense JSON and historical offer IDs must remain unchanged.

For real vault migration, use the separate [vault copy/verify procedure](VAULT_STORAGE.md).
