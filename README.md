# Wanderful

**A travel workspace that plans with live context, protects what matters, and adapts when the trip changes.**

Wanderful turns a few trip details into a practical, day-by-day journey with live flight and hotel options, weather-aware activities, budget guidance, route maps, and tools for managing the trip after planning.

![Wanderful travel workspace](travel-planner/artifacts/ui-audit/after-hero.png)

## Why Wanderful

Wanderful goes beyond generating a static itinerary. It gives travelers one place to plan, compare, coordinate, and respond to changes.

- **AI itinerary planning:** Build a paced day-by-day plan around dates, budget, interests, and traveler needs.
- **Live travel options:** Compare flights, stays, weather, local activities, prices, ratings, stops, and source freshness.
- **Interactive route maps:** See each day's stops in order and understand how to move between them.
- **Trip Health:** Detect timing, weather, budget, evidence, and resilience risks before they become problems.
- **Budget Guardian:** Track planned, committed, and actual spending while protecting a configurable reserve.
- **Disruption Autopilot:** Preview and apply safe itinerary repairs for rain, delays, fatigue, or budget pressure.
- **Offline Companion:** Keep a versioned trip pack on the device for access when connectivity is unreliable.
- **Group expenses:** Split shared costs, track balances, and settle debts with a simple group workspace.
- **Travel document vault:** Keep tickets, bookings, insurance, and identity documents attached to the trip.
- **PDF export:** Download a concise itinerary for sharing or offline reference.
- **Personal travel memory:** Save trips, preferences, locks, and feedback to improve future plans.

## Product tour

### See the day before you go

The interactive route map connects itinerary stops with a clear sequence, timing, and travel guidance.

![Interactive day route through Lisbon](travel-planner/artifacts/ui-audit/interactive-route-map.png)

### Split the trip, not the mood

Add travelers and shared purchases, calculate balances automatically, and mark settlements as complete.

![Wanderful group expense settlement](travel-planner/artifacts/ui-audit/group-expense-settlement.png)

### Keep important documents with the trip

The private document vault organizes travel files by category and can flag upcoming expiry dates.

![Wanderful travel document vault](travel-planner/artifacts/ui-audit/travel-document-vault.png)

### Stay ahead of changing conditions

The trip command center combines budget monitoring, offline readiness, and disruption recovery.

<table>
  <tr>
    <td width="50%"><img src="travel-planner/artifacts/ui-audit/command-center-budget.png" alt="Budget Guardian" /></td>
    <td width="50%"><img src="travel-planner/artifacts/ui-audit/command-center-autopilot.png" alt="Disruption Autopilot" /></td>
  </tr>
  <tr>
    <td align="center"><strong>Budget Guardian</strong></td>
    <td align="center"><strong>Disruption Autopilot</strong></td>
  </tr>
</table>

## Technology

- React 18, TypeScript, Vite, Tailwind CSS, Leaflet, and GSAP
- Flask API with secure cookie sessions, CSRF protection, rate limits, and structured logging
- CrewAI and LiteLLM orchestration with validated structured itineraries
- SQLAlchemy with SQLite locally and PostgreSQL/Neon in hosted environments
- Redis and RQ for production background planning jobs
- SerpAPI and OpenWeather provider integrations

## Project layout

The application lives in [`travel-planner/`](travel-planner/). See the [application README](travel-planner/README.md) for architecture, local setup, verification, database migrations, and production requirements.

Repository-level deployment and CI definitions live in [`render.yaml`](render.yaml) and [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Status

Wanderful is in controlled beta. New accounts require administrator approval before live planning is enabled. Provider prices and availability are time-sensitive and are not guarantees. Wanderful does not sell travel or process bookings; travelers should confirm booking terms, entry requirements, and final details with the relevant provider.

## Policies

See the [Security Policy](travel-planner/SECURITY.md), [Privacy Policy](travel-planner/PRIVACY.md), and [Terms of Use](travel-planner/TERMS.md).
