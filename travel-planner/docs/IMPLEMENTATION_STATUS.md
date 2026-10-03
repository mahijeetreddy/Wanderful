# Product implementation status

## Loading experience and latency review (2026-09-30)

Added shared lightweight themed loading scenes across the primary planning and
travel-tool waits, with light/dark palettes, reduced motion and finite animation.
Removed simulated planning-stage text. Added bounded public-provider memory caching,
corrected soft-budget cache keys, protected successful responses from Redis write
failures, and removed duplicated native Gemini prompt schemas.

Backend suite: 167 passed. October 3 final verification: production build passed;
full desktop/mobile browser suite 56 passed; cache-focused suite 5 passed, including
the additional budget-reuse test. See [architecture review and limitations](LOADING_AND_LATENCY_REVIEW.md).
No new live speed claims; no RAG or hosted changes.

## Independent attraction research and review (2026-09-30)

Attraction research no longer blocks itinerary generation. Bounded background work,
short category-specific Maps queries, a dated public-place cache and one transient
retry replace the initial broad organic query. Account-authorized research review is
read-only until the traveler explicitly applies matching map references. Times, costs,
activities and bookings are never automatically changed.

Two concurrent live plans: Rome/6 days **25.992 s**, London/3 days **23.548 s**.
Attraction research succeeded in **4.115 s / 3.846 s**, returning 12 candidates and
four confident itinerary place-identity matches in each. This does not verify hours,
admission or transit times and is not a production p95 claim.

Added server-stage queue/first-options/first-draft/ready metrics and cache/length cohorts.
P95 needs sufficient successful samples; failures remain separately visible. Validation
includes cache reuse, ownership, retry limits and 200 simulated research submissions.
See [research report and production activation caveat](ATTRACTION_RELIABILITY.md).

Production research requires an explicitly enabled separate RQ worker; no hosted
worker, service, migration or flag was activated. RAG remains deferred. No commits/pushes.

## Non-RAG reliability follow-up (2026-09-30)

- Reproduced Rome's empty flight query using `ROM`; the same query with `FCO,CIA`
  returned 11 offers. Flight requests now expand metropolitan airport groups while
  preserving explicit airport choices. Genuine empty inventory is not a provider error.
- Day regeneration and guidebooks use one bounded direct request. Live samples took
  14.430 s and 8.415 s respectively. Failed guidebooks no longer masquerade as complete.
- Gemini streams validated days into read-only previews; final trip state remains
  separate. Previews clear on completion, logout, new searches and saved-trip switching.
- Sanitized provider errors; added exact-date, empty-day and source-support evaluation.
- Capped concurrent live matrix: Rome/6 days 33.183 s, London/3 days 29.370 s,
  Tokyo/10 days 26.966 s, all with usable flights and stays. Local research timed out
  in all three. Source grounding/opening hours/transit accuracy are not claimed.
- Full backend suite: **152 passed**. Full browser suite: **52 passed**. Production
  build passed. Local API restarted and readiness/proxy checks passed; UI is on 5176.
  Remaining transport/benchmark limitations are recorded in the performance report.

RAG remains explicitly deferred. No commits, pushes, purchases, deployments or hosted
infrastructure changes. See [performance details](PLANNING_PERFORMANCE.md).

## Planning latency update (2026-09-29)

Direct schema-constrained drafting replaces the default agent/fallback cascade. Interactive
provider retries are disabled; generation has a shared deadline and one missing-day repair.
Late cancelled results cannot complete the job or send its notification. Failure timings
are retained without raw provider exception text. Existing providers/models remain unchanged.

One live six-day sample: **32.195 s**, first stays at **6.303 s**, one LLM call. Flights
failed in that sample; this is not an all-provider-success or p95 claim. Full backend:
**141 passed**. Production build passed. See [performance report](PLANNING_PERFORMANCE.md)
for the request cap, configuration, measured scope and remaining limitations.

No commits, pushes, deployments or hosted infrastructure changes in this increment.

Follow-up (2026-09-30): 10 desktop/mobile selection and production offline browser
checks passed. Local API restarted on 5052; readiness and frontend proxy checks passed.
Frontend remains on 5176. No commits or pushes.

Scope: provider handoff, existing SerpAPI/OpenWeather integrations, owner-managed groups.
No commits, pushes, deployments, or service purchases. The explicitly approved hosted
schema migration is recorded below; earlier entries describe their original local scope.

| Phase | Status | Acceptance evidence |
| --- | --- | --- |
| 1. Trustworthy search and selection | Core local acceptance journeys verified | SQLite/PostgreSQL migrations; save/reopen/reload, booking status, account isolation and delayed logout tests |
| 2. Flights and stays experience | Local journeys and automated accessibility scans verified | Comparison, room rates, proximity sorting, keyboard dialogs, axe scans and mobile coverage |
| 3. Connected decisions | Ledger integration and duration-aware conflicts implemented | Signed revision-bound previews, overnight timing, linked-payment arithmetic and ledger-backed legacy responses |
| 4. Operational reliability | Local regression gates passed; hosted validation excluded | Revision-safe records/undo, production offline reload/logout, PostgreSQL migration and disposable volume checks |
| 5. Evaluation and monitoring | Implemented; live measurements outstanding | Fixture contracts, missing-credential handling, weather deduplication and no automatic trip mutation |

Each phase must pass its checks before the next is considered complete. Live provider
latency and hosted infrastructure are not verified by fixture tests.

## Calendar, light theme and route recovery (2026-09-29)

- Added a responsive date-range calendar with keyboard navigation and manual input.
- Added a device-persisted cream/blue/apricot light theme; dark remains the default.
- Corrected overly strict verified-place matching and supported provider `data_id` identity.
  Existing verified stops survive partial failures; unresolved stops can be retried and
  resolved stops can be focused from the list. Ambiguous locations are not fabricated.
- A bounded live Colosseum lookup resolved coordinates and source identity successfully.
- Read-only timing analysis found the latest six-day job took 196.708 seconds: 50.965
  seconds collecting providers and 145.024 seconds in a failed-fast/outline/day fallback
  pipeline. Performance architecture recommendations are documented, not implemented
  or presented as measured speedups in this UI increment.
- Full backend run: 126 passed; subsequent endpoint-status tests: 4 passed. Focused
  desktop/mobile calendar and map recovery checks: 4 passed. Broader final validation
  is recorded in [the interface and map review](INTERFACE_AND_MAP_REVIEW.md).
- No hosted schema/infrastructure changes, commits, or pushes. See the review for free
  map-provider tradeoffs; no new map service has been activated.

## Approved hosted schema migration (2026-09-28)

- Upgraded the configured hosted database from `20260920_05` to `20260923_08`
  with the user's explicit approval so the local app can use its existing feature tables.
- Created a private, git-ignored public-schema backup; restored it into an isolated local
  PostgreSQL instance and rehearsed the additive migrations before applying them remotely.
- Verified the target revision and unchanged existing-row hashes after the hosted upgrade.
  Completion evidence: `.secrets/migration-backups/20260928T154335Z-497a72/applied.json`.
- No infrastructure, provider services, vault files, or account roles were changed by this
  migration. This does not establish production readiness or live-provider performance.

## Product workspace increment (2026-09-28)

- Added separate What if?, Booking inbox and Today dialogs to the opened saved-trip
  workspace, plus a standalone personal travel preferences dialog in the planner.
- What-if scenarios retain the original trip, compare up to three historical alternatives,
  search dates independently, complete outbound/return quotes, and show exact quote deltas,
  ledger-backed budget projections and arrival/departure conflicts. Applying a scenario or
  automatically moving activities is not part of this increment.
- Preferences are account-scoped, revision-checked soft planning defaults with a per-plan
  opt-out. Fixed portal form submission so preference saves cannot start a planning job.
- Inbox imports are reviewed drafts from pasted text or `.txt`/`.eml`; no external LLM,
  email access, PDF/OCR, raw-file storage, automatic payment or booking-selection changes.
- Today offers destination-time-zone-aware day previews, next scheduled activity,
  directions and confirmed-by-user inbox entries. Prepared offline packs expose the same
  day view without private inbox data or network directions.
- Reused existing revision-08 tables: no new schema or hosted migrations. The persistence
  approach follows the database guidance while preserving SQLAlchemy and existing accounts.
- Validation: production build passed; final backend suite **121 passed (115.65s)**.
  Full bundled-Chromium suite with `CI=true`: **44 passed (3.4m)**, including desktop/mobile
  feature journeys, axe checks, provider failure/return completion, offline reload and logout.
  Screenshots are in ignored `test-results/`. Hosted Linux CI and live provider calls were
  not run for this increment. No commits, pushes, deployments or hosted changes occurred.
- Details, boundaries and the explicitly requested next-feature reminder are in
  [Product workspace](PRODUCT_WORKSPACE.md). **Next: realistic day planner grounded in
  retrieved sources via RAG**, with provenance, freshness and schedule feasibility checks.

## Offline CI regression fix (2026-09-27)

- Reproduced both desktop/mobile offline reload failures locally with CI's bundled
  Chromium. Vite preview's `Vary: Origin` made module/style requests miss precached
  responses when matched using the incoming request's headers.
- Service-worker lookups now use the same canonical pathname as precaching, only
  within the existing same-origin public build-asset allowlist. API responses,
  documents, query-string URLs and non-GET requests remain excluded.
- Local browser tests now use bundled Chromium too. Added offline script/style
  readability assertions; retained real offline reload, accessibility and cross-tab
  logout/IndexedDB cleanup checks without increasing assertion timeouts.
- Validation: production build passed; targeted offline checks **2 passed (1.8m)**;
  full suite with `CI=true` **34 passed (2.4m)**. These are local Windows results,
  not a rerun of hosted Linux GitHub Actions. Backend tests were not rerun for this
  frontend-only change. No commit, push, deployment or hosted changes were made.

## Remaining-work implementation (2026-09-25)

This section supersedes earlier pending implementation notes.

- Saved-trip intelligence, legacy budget responses and disruption responses now use the
  canonical ledger. Linked payments and commitments use identical expected/remaining
  totals; the command center refreshes when the trip revision changes.
- Selection timing checks use explicit activity ranges or duration minutes, including
  overnight ranges and DST-aware elapsed durations. Missing/ambiguous ends are reported
  as incomplete evidence instead of fabricated durations.
- Weather scheduling retries transient failures, publishes an expiring scheduler heartbeat,
  refreshes unchanged forecast freshness, and classifies current/resolved/stale/expired
  notices. Historical notices do not offer recovery actions.
- Journal/guidebook now use native shared dialogs with focus containment/restoration.
  Added automated WCAG-tagged axe scans to desktop/mobile tool journeys. These checks
  are not a substitute for user testing with every browser or assistive technology.
- Patched frontend dependencies, including Vite 6.4.3; npm reported zero vulnerabilities
  after installation. Production build and optional-monitoring Compose configuration pass.
- Added a read-only release preflight and privacy-safe missing-schema telemetry reporting.
  Actual environment blockers are documented in OPERATIONS.md, not silently changed.
- Capped live provider probes returned hotel inventory in 5.31 seconds and flight inventory
  in 9.28 seconds. Neither is a p95 or full-plan performance guarantee.
- Backend fixture databases are now unique temporary files per process, preventing
  collisions between verification runs. Clean full backend rerun: **116 passed in 142.81s**.
  The production build and Compose configuration passed. Final full frontend run:
  **34 checks passed in 2.7 minutes** (26 desktop/mobile browser journeys plus eight
  pure logic checks). Integrated axe scans found no violations in the tested dialogs
  and offline view; vault input naming and section-text contrast defects were fixed.

Hosted migrations, Redis configuration, production flags, persistent-volume activation,
backup restoration drills, and live end-to-end load benchmarks still require the separately
authorized release environment. No commit, push, deployment or hosted mutation occurred.

## Latest increment: operational tools and monitoring (2026-09-24)

This section supersedes outstanding-work statements in the historical increments below.

- Added explicit itinerary/selection undo; conflicts preserve the selected revision.
  Payments, settlements, documents, and booking status are not implicitly undone.
- Offline packs use account-scoped IndexedDB and versioned application assets. The
  read-only `/offline` entry survives a prepared offline reload. API responses, vault
  documents, and map tiles are excluded from shared caches; logout removes device copies.
- Added exact reserve accounting, direct workspace tools, coordinate/source persistence,
  labelled straight-line stay proximity, and mandatory revisions for selection writes.
- Added opt-in weather monitoring on a separate Redis/RQ queue, disabled by default.
  Checks share forecast requests, deduplicate alerts, and never change trips or email users.
- Added recorded-fixture evaluations, capped explicit live probes, aggregate runtime
  timing/completeness/cache/handoff reports, and missing-data reporting.
- Disposable PostgreSQL migration through revision 08 and local named-volume fixture
  persistence across container replacement passed. Only labelled test resources were
  removed; hosted services and actual vault data were not changed.
- Fixed nested-dialog Escape handling so closing history preserves the saved-trips
  drawer and returns focus. Desktop/mobile history regressions pass.
- Latest full backend suite: **110 passed** in 194.00 seconds, including the added
  missing-runtime-telemetry regression. Production TypeScript/Vite build passed.
  Eight recorded provider-contract scenarios passed without live provider requests.
  Full frontend run: **30 checks passed** in 1.9 minutes (22 browser journeys and eight
  pure logic checks across desktop/mobile projects). This includes production offline
  reload/logout. The offline fixture now waits for service-worker page control before
  disconnecting, rather than relying on registration activation alone.

Historical limitations for this September 24 increment are superseded by the September 25
implementation above. Live end-to-end targets, hosted activation, and backup validation
remain release gates. See [operations](OPERATIONS.md) and [benchmarks](BENCHMARKS.md).

## Latest increment — connected workspace and vault (2026-09-23)

This section supersedes the earlier milestone notes below; no phase is being declared
complete solely because its implementation exists.

- Selection changes can be reviewed in the saved-trip booking panel and main workspace.
  Signed previews are revision-bound and expire; applying updates selections, budgets,
  and itinerary conflict annotations together. Locked activity conflicts block applying.
  Destination time zone and transfer buffers are explicit assumptions; unavailable
  timing evidence produces a warning, not fabricated travel windows.
- The ledger distinguishes planned costs, user-recorded commitments, payments, and
  expected remaining costs. Linking a payment to a booking avoids double counting.
  Expenses/members/settlements use individual records, stable IDs, idempotent creation,
  exact minor units, and revision checks. Original legacy JSON remains preserved.
- Group expenses now use the same ledger as Budget Guardian. Failed writes retain the
  draft. Booking changes with linked payments require explicit payment review.
- Budget, constraint, disruption and live-adjustment API writes require an expected
  revision. SQLite now enforces foreign keys; six job fixtures were corrected to create
  an actual owning account instead of relying on disabled integrity checks.
- Place lookup no longer uses weather geocoding for attractions. Existing SerpAPI Maps
  lookup conservatively matches title/address and preserves source identity; unresolved
  stops retain list entries and external Maps links. Further persistence of verified
  coordinates and stay-proximity ranking remain to be completed.
- Added hotel-photo fallbacks, larger map markers, visible itinerary conflict notices,
  and pausing/hiding the background video inside the trip workspace.
- Vault storage has a filesystem interface, exclusive private file creation, safe paths,
  production mount checks, and a named local Compose volume. Downloads are owner-only
  and non-cacheable. The copy/verification command never deletes originals or overwrites
  mismatched files. See [vault operations](VAULT_STORAGE.md).
- Docker frontend packaging now includes public assets. Full service-worker/offline
  packaging and cache-policy replacement remain outstanding.
- Validation: **100 backend tests passed** in 157.77 seconds; **24 frontend checks passed**
  (18 desktop/mobile browser journeys and six pure logic checks, 2.9 minutes).
  TypeScript/production build and `docker compose config --quiet` passed.
  Mobile decision-preview and desktop ledger screenshots were inspected locally.
  Vault tests reopen storage across instances; this is not a real container recreation.

Remaining acceptance work: finish keyboard/contrast and tool integration checks;
complete coordinate persistence/stay ranking and preview validation; expose safe undo;
verify migration 08 on disposable PostgreSQL; validate mounted-vault container recreation;
move offline packs to account-scoped IndexedDB with a read-only offline entry and versioned
assets; implement disabled-by-default weather monitoring and fixture/live-capped benchmarks.
Legacy selection clients still need the mandatory-revision migration. Existing reserve
budget controls also need integration into the exact ledger. No hosted migration, volume,
monitoring job, deployment, commit, or push was performed.

## Phase 1 implemented locally

- Extracted flight/stay panels and trip state from App; added account-session query cache,
  request cancellation and response epoch guards, including downloaded response bodies.
- Added additive search-session/immutable offer-snapshot/selection tables and API routes.
  Stable identities no longer depend on result order or price. Complete return selections
  are server snapshots, retained when options refresh and persisted in saved-trip payloads.
- Combined/deduplicated flight result groups before filtering; removed implicit hard
  flight-budget cutoffs. Provider results publish independently as collection finishes.
- Added historical-price warnings and independent recheck polling without replacing
  the saved choice. Provider statuses survive client normalization.
- Explicit logout clears account workspace and existing offline localStorage packs,
  aborts account requests and broadcasts to other tabs.
- Fixed flight-dialog stacking with a native top-layer dialog and focus containment.
- Added desktop/mobile browser journeys to the local CI configuration (not pushed/run on GitHub).

## Validation and remaining work

- Latest full backend suite: **92 passed** (2026-09-23), including property-detail
  ownership, missing totals, safe links, selection state and legacy compatibility.
- Frontend runner: 20 passed on 2026-09-23 (fourteen actual browser journeys and six pure logic checks,
  across desktop/mobile projects). Includes booking status, comparison limit, unknown
  prices, filter reset, empty/failed stay recovery, mobile view switching, workspace tabs,
  optional cursor, and delayed cross-tab logout. Fixtures do not measure live providers.
- TypeScript and production build passed, including the final map-resize adjustment.
  PostgreSQL verification is also wired into the local CI workflow; no workflow was pushed
  or triggered on GitHub during implementation.
- PostgreSQL 16 migration verification passed against a disposable localhost-only Docker
  database: legacy schema, additive upgrade, Alembic drift check, original saved-trip JSON,
  expenses and positional historical IDs preserved. The test container/data were removed.
- New saved-trip booking panel persists user-recorded external booking state; payments
  remain separate. Snapshot ownership, dates/travelers, and stale-selection guards are checked.
- Independent provider retry controls and explicit completeness/missing evidence added.
  Explicit rechecks now bypass the application cache (upstream availability still not guaranteed).
- Main workspace Save now updates the same saved trip using its expected revision, including
  after reload. Conflicts preserve the local draft rather than overwrite another version.
  New-trip creation and legacy tool routes still need convergence on the universal mutation
  contract; selection changes are not yet preceded by a connected-impact preview.

## Phase 2 implemented locally

- Overview / Flights / Stays / Itinerary / Trip tools navigation, compact cross-tab trip
  summary and concise overview. Original source content moved into an expandable tools section.
- Flight sorting (best-fit order, cheapest, fastest), airline/stops/local departure/cabin
  filters, optional strict price target, comparison of up to three snapshot options.
  Missing prices sort last; unsupported policy filters are not fabricated.
- Native top-layer comparison and detail dialogs with Escape handling/focus restoration.
- Full-stay estimates lead stay cards; nightly prices are secondary. Removed percentage-fit
  badges, added missing-photo fallbacks, explicit map controls and mobile List/Map switching.
- Independent hotel property details using existing SerpAPI property tokens, original
  search context and account authorization. Provider-supplied photos, amenities and room
  quotes are separate from selected snapshots; unknown totals/terms remain unknown.
  Contract: https://serpapi.com/google-hotels-property-details
- Decorative cursor is opt-in. Pointer-driven background motion stops in the itinerary workspace.
- Connecting-leg outbound/return summaries and local arrival-day indicators are implemented.
  Selectable provider room/rate snapshots preserve the chosen price across refresh, reload,
  saving and reopening; unknown full-stay totals cannot be selected as verified quotes.
- Stay-map tests now cover valid/invalid coordinates, marker-to-list selection, missing
  photos, manual property-provider recovery, and keyboard dialog wrapping/restoration.
  Viewing a map property no longer claims it is selected; chosen stays expose pressed state.
  Shared dialogs explicitly wrap Tab/Shift+Tab between available controls.
- Validation note: a six-worker run alongside the build timed out on the existing desktop
  logout/reload journey (17 passed, one timeout). A complete two-worker rerun passed all 18
  checks in 2.0 minutes; two workers are now the default. Production build passed.
  That earlier UI increment had no backend changes; the newer revision increment passes
  92 backend tests and 20 frontend checks.
- Remaining Phase 2 work: full keyboard/contrast and touch-target audit, additional
  property-photo failure coverage, and fully integrated saved-trip tools.

## Revision foundation for connected decisions (2026-09-23)

- Additive migration `20260923_07` backfills saved trips to revision 1. SQLAlchemy versioned
  writes detect overlapping writers on SQLite and PostgreSQL; conflicts return HTTP 409.
- `PUT /api/trips/:id` requires `expected_revision`, scopes access to the owner, preserves
  independent budget/live-state/constraint records, and updates selected snapshots atomically.
  Server-owned quote prices replace client copies; replacing externally booked selections
  requires an explicit booking-status action. Historical IDs are not resolved as live offers.
- Main workspace persists saved ID/revision across reload, guards duplicate save clicks and
  ignores a late save response after switching/resetting the workspace. Stale drafts remain
  on device; reconciliation currently requires reviewing and reopening the saved version.
- Booking-panel writes now send the revision when available. Legacy selection clients remain
  compatible; other tool endpoints do not yet require a client revision. This is not yet
  complete cross-device protection for all budget/expense/itinerary tools or an undo system.
- Full backend: 92 passed. Frontend: 20 passed with two workers (1.8 minutes). Build passed.
  Disposable PostgreSQL 16: additive upgrade, schema drift, legacy JSON/expense preservation,
  and revision backfill passed. The temporary container and anonymous fixture volume were
  removed; no hosted database was touched.
- Next: deterministic decision preview/apply with exact monetary calculations, local-time
  activity windows and locked-activity conflicts. Then ledger and operational-reliability work.
- Remaining Phase 3–5 work includes decision previews/transactions, exact budget ledger, record-level
  expenses, durable vault configuration, IndexedDB offline access, monitoring and benchmarks.
