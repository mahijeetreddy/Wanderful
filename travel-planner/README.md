# Wanderful

Wanderful turns a short description of your trip into a complete, day-by-day travel
plan — built from real flight and hotel availability, live weather, and your stated
budget and interests, not generic suggestions.

## What you can do

- **Describe your trip and get a full itinerary.** Enter your origin, destination,
  dates, budget, and interests, and Wanderful builds a day-by-day plan with paced
  activities, estimated costs, and a running budget breakdown.
- **Compare real flights and hotels.** Browse live flight and hotel options side by
  side — prices, ratings, photos, stops, and emissions — and lock in the ones you want.
- **Check the weather at a glance.** See the forecast for your travel dates right
  alongside your itinerary.
- **Fix one day without rebuilding the trip.** Not happy with a single day's plan?
  Regenerate just that day and keep the rest of your itinerary untouched.
- **Recover a weak flight search.** If a flight search comes back thin, Wanderful
  suggests nearby airports and alternate dates and lets you retry in one click.
- **Save trips to your account.** Revisit, edit, or re-plan any saved trip later.
- **Edit as you go.** Swap activities, adjust plans, and see your estimated total
  update automatically.

## Status

Connected selection previews, an exact-money ledger, revision-based undo, account-scoped
offline reloads, and opt-in weather monitoring are implemented locally. The main reopened
workspace updates the original trip with revision checking; stale drafts are retained
for reconciliation. Live provider performance and hosted operation remain unverified. See
[implementation status](docs/IMPLEMENTATION_STATUS.md)
and the [product tour with screenshots](../README.md#product-tour).

See [operations and evaluation commands](docs/OPERATIONS.md) for offline preparation,
the separate disabled-by-default weather worker, capped provider probes, and runtime metrics.

The remaining local hardening includes ledger-backed legacy budget responses, overnight
activity timing checks, resolved/stale weather notices, scheduler retry recovery, accessible
journal/guidebook dialogs and automated accessibility scans. A read-only release preflight
reports missing schema/configuration without changing hosted services. Live hotel/flight
probe samples are recorded in [benchmarks](docs/BENCHMARKS.md), not advertised as p95 guarantees.

Implemented additions include independent provider status/retry, immutable server-owned
offer snapshots, retained selected quotes on refresh, three-flight comparison, flight
filters, outbound/return summaries with local arrival-day changes, and selectable hotel
room-rate quotes. Missing room policies, taxes or totals are not invented. Selected,
user-recorded externally booked, and paid are distinct concepts; choosing an offer does
not reserve or purchase it.

Selection previews show price/budget changes and timing conflicts before applying a
change. Linked booking payments are not counted twice; group balances use exact minor
units and individual revision-checked records. The vault supports a local persistent
volume and non-destructive copy verification; see [vault operations](docs/VAULT_STORAGE.md).
Remaining work includes complete map/accessibility audits, undo UI, account-scoped
IndexedDB offline packs, monitoring, and evaluation benchmarks. Existing offline and
disruption tools are not completion of those upgrades. Groups are owner-managed;
disruptions remain user-triggered.

Wanderful is in a controlled beta. New accounts require admin approval before
planning is enabled. Prices and availability shown are time-sensitive results from
third-party providers, not guarantees — Wanderful does not sell travel, own bookings,
or process payments. Confirm details, entry requirements, and booking terms directly
with the relevant provider before you travel.

## Architecture

- **Frontend:** React 18, TypeScript, TanStack Query, Vite, Tailwind CSS, Leaflet, and GSAP.
- **API:** Flask with cookie sessions, CSRF protection, per-user rate limits, and JSON logging.
- **Planning:** CrewAI/LiteLLM orchestration with structured itinerary validation.
- **Persistence:** SQLAlchemy with local SQLite or PostgreSQL/Neon in hosted environments.
- **Jobs:** RQ and Redis in production, with an in-process executor for local development only.
- **Providers:** SerpAPI for travel/local search and OpenWeather for forecasts.
- **Search state:** Account-owned search sessions and immutable offer snapshots; independent
  provider polling and retries. Session epoch guards cancel/invalidate requests on logout.
- **Feature modules:** `src/features/` separates auth/session, search, flights, stays and trip UI.

## Adaptive trip intelligence

Account-saved trips include a Trip Health workspace that:

- Scores itinerary feasibility and explains weather, pacing, budget, resilience, and evidence risks.
- Lets travelers mark activities as locked, preferred, optional, or avoided.
- Previews running-late, rain, fatigue, and cost-saving repairs before changing the saved plan.
- Protects locked commitments when applying a live adjustment.
- Shows recommendation confidence, ranking reasons, source links, and data freshness.
- Records lightweight activity feedback and reuses positive taste signals in future planning prompts.

The health engine is deterministic and testable; it does not depend on an LLM to identify or
repair common itinerary risks.

## Trip command center

Every account-saved trip now includes three operational travel tools alongside Trip Health:

- **Budget Guardian** separates planned, committed, and actual spend; protects a configurable
  reserve; tracks expenses by category; and surfaces category or forecast overruns.
- **Offline Companion** creates a versioned, integrity-stamped trip pack stored on the device.
  A service worker caches the application shell while authenticated API responses remain out of
  the shared HTTP cache.
- **Disruption Autopilot** turns rain, delays, fatigue, and budget pressure into protect,
  balanced, and rescue scenarios. Travelers preview the health/cost impact before applying a
  reversible itinerary repair, and locked commitments are preserved.

## Planning latency

The planning hot path is optimized for I/O-bound work:

1. Flight, hotel, weather, and local-search providers run concurrently in a bounded thread pool.
2. The default `FAST_PLAN_MODE=true` path creates and validates the complete structured itinerary
   in one model call instead of an outline call followed by one model call per day.
3. The previous bounded parallel day-expansion pipeline remains the automatic fallback if the
   single-pass response fails schema validation.
4. RQ/Redis isolates planning from web requests in production; local development uses a bounded
   in-process executor. CPU multiprocessing is intentionally avoided because the hot path is
   network/LLM I/O rather than CPU-bound computation.

Useful tuning variables are `PLAN_WORKERS`, `DAY_LLM_WORKERS`, `FAST_PLAN_MODE`,
`REQUEST_TIMEOUT_SECONDS`, `PROVIDER_RETRIES`, and `STRUCTURED_MAX_RPM`. Provider and planning timings are returned
in job metrics so latency regressions can be measured rather than guessed.

## Local development

Requirements: Python 3.11, Node.js 20, and npm.

```bash
python -m venv .venv
# Activate .venv for your shell, then:
python -m pip install -r requirements.txt
npm ci
```

Copy `.env.example` to `.env`, add the provider credentials you intend to use, and keep
`APP_ENV=development`. The default SQLite URLs require no database service.

The current `.env.example` is local-only and ignored; fresh clones may not contain it.
Consult `config.py` and the environment-variable references in the provider modules for
configuration, or obtain a sanitized template from the maintainer. Never share a populated
environment file.

Initialize the schema and start both development servers:

```bash
python -m alembic upgrade head
python web_app.py
npm run dev
```

Run the API and Vite commands in separate terminals.

The API listens on port 5052 and Vite listens on port 5173 by default.

## Verification

Run the complete local quality gate before deployment:

```bash
python -m pytest --cov=. --cov-report=term-missing
python -m compileall -q .
python scripts/check_infrastructure.py
npm run typecheck
npm run build
npm run test:browser
```

The Playwright configuration uses installed Google Chrome locally and Chromium in CI;
CI installs it with `npx playwright install --with-deps chromium`. Browser checks start
an isolated Vite server on port 5174, use two workers by default, and mock provider/account APIs. They do not make
bookings or measure live provider performance.

Latest local results: **92 backend tests passed** (September 23, 2026), **20 frontend
checks passed** (14 browser journeys and 6 pure logic checks across two viewport projects),
and TypeScript/production build passed on September 23. Coverage includes quote retention across refresh,
reload and save/reopen; flight comparison; empty/failed stays; and delayed cross-tab logout.
Stay-map coverage also checks invalid coordinates, keyboard selection, failed photos,
provider recovery and dialog focus wrapping/restoration.
The repository CI definition includes browser and disposable PostgreSQL migration jobs;
these local results do not imply a successful hosted GitHub Actions run.

The infrastructure check verifies database connectivity, the Alembic revision, and Redis
read/write behavior. It is expected to fail when Redis is intentionally omitted locally.

## Database changes

Alembic is the only schema owner for PostgreSQL. Application startup creates tables only for
local SQLite databases. Create a revision for every model change, review the generated SQL,
and test `upgrade head` against a disposable database before applying it to a shared branch.

For Neon deployments, use the pooled connection string for `DATABASE_URL` and the direct
connection string for `MIGRATION_DATABASE_URL`.

`scripts/verify_postgres_migrations.py` verifies additive upgrades and preservation of
legacy saved trips against a disposable, empty, localhost-only PostgreSQL database whose
name starts with `wanderful_migration`. It refuses remote/nonempty targets. PostgreSQL 16
verification passed locally, including revision backfill with `20260923_07`; no hosted
migration was applied. Apply reviewed migrations separately before restarting a PostgreSQL
deployment with the new model. Legacy tool endpoints still require revision-contract migration.

## Generated files and repository hygiene

Environment files, runtime state, local databases and journals, dependencies, builds,
coverage and Playwright reports are ignored. Curated README screenshots remain eligible
for version control; routine selection/recovery test captures are ignored. Ignore rules
do not remove files already tracked by Git. Keep credentials and personal trip/document
data out of fixtures and screenshots.

## Production requirements

Production startup fails fast unless PostgreSQL, Redis, a strong `AUTH_SECRET_KEY`, secure
cookies, CSRF enforcement, and at least one administrator email are configured. Run the API
and worker as separate services using the repository-level `render.yaml`, or equivalent
infrastructure.

## Policies

See [SECURITY.md](SECURITY.md), [PRIVACY.md](PRIVACY.md), and [TERMS.md](TERMS.md).
