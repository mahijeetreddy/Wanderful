# Product implementation status

Scope: provider handoff, existing SerpAPI/OpenWeather integrations, owner-managed groups.
No commits, deployments, hosted migrations, or service purchases.

| Phase | Status | Acceptance evidence |
| --- | --- | --- |
| 1. Trustworthy search and selection | Core acceptance journeys verified; integration follow-ups remain | SQLite/PostgreSQL migrations; save/reopen/reload, booking status, account isolation and delayed logout tests |
| 2. Flights and stays experience | In progress | Fourteen desktop/mobile journeys and six pure logic checks pass; production build passes |
| 3. Connected decisions | Revision groundwork implemented; impact service pending | Same-trip updates, stale drafts, snapshot prices and two-writer conflict tests pass |
| 4. Operational reliability | Pending | Pending |
| 5. Evaluation and monitoring | Pending | Pending |

Each phase must pass its checks before the next is considered complete. Live provider
latency and hosted infrastructure are not verified by fixture tests.

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
