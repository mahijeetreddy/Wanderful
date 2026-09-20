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

Wanderful is in a controlled beta. New accounts require admin approval before
planning is enabled. Prices and availability shown are time-sensitive results from
third-party providers, not guarantees — Wanderful does not sell travel, own bookings,
or process payments. Confirm details, entry requirements, and booking terms directly
with the relevant provider before you travel.

## Architecture

- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, Leaflet, and GSAP.
- **API:** Flask with cookie sessions, CSRF protection, per-user rate limits, and JSON logging.
- **Planning:** CrewAI/LiteLLM orchestration with structured itinerary validation.
- **Persistence:** SQLAlchemy with local SQLite or PostgreSQL/Neon in hosted environments.
- **Jobs:** RQ and Redis in production, with an in-process executor for local development only.
- **Providers:** SerpAPI for travel/local search and OpenWeather for forecasts.

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

Initialize the schema and start both development servers:

```bash
python -m alembic upgrade head
python web_app.py
npm run dev
```

The API listens on port 5052 and Vite listens on port 5173 by default.

## Verification

Run the complete local quality gate before deployment:

```bash
python -m pytest --cov=. --cov-report=term-missing
python -m compileall -q .
python scripts/check_infrastructure.py
npm run typecheck
npm run build
```

The infrastructure check verifies database connectivity, the Alembic revision, and Redis
read/write behavior. It is expected to fail when Redis is intentionally omitted locally.

## Database changes

Alembic is the only schema owner for PostgreSQL. Application startup creates tables only for
local SQLite databases. Create a revision for every model change, review the generated SQL,
and test `upgrade head` against a disposable database before applying it to a shared branch.

For Neon deployments, use the pooled connection string for `DATABASE_URL` and the direct
connection string for `MIGRATION_DATABASE_URL`.

## Production requirements

Production startup fails fast unless PostgreSQL, Redis, a strong `AUTH_SECRET_KEY`, secure
cookies, CSRF enforcement, and at least one administrator email are configured. Run the API
and worker as separate services using the repository-level `render.yaml`, or equivalent
infrastructure.

## Policies

See [SECURITY.md](SECURITY.md), [PRIVACY.md](PRIVACY.md), and [TERMS.md](TERMS.md).
