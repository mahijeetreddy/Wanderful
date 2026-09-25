# Benchmarks

Do not replace missing measurements with estimates. Fixture results below do not measure
live search or end-to-end planning. Run explicit capped probes and inspect runtime telemetry
before making product latency claims. Commands are in [operations](OPERATIONS.md).

## Recorded local results (2026-09-24)

- Eight recorded-fixture contract cases passed: success, missing totals, empty inventory,
  unavailable capability, timeout, outage, historical selection, and planning failure.
- 100 classification repetitions per case: aggregate p95 **0.004900 ms** on this run.
  This is only in-process response classification, not provider/network latency.
- One of three deliberately mixed offer fixtures was complete (**33.33%**). This is a
  fixture property, not a production completeness claim.
- Production offline reload and logout deletion passed on desktop and mobile.
- PostgreSQL additive upgrade/schema drift/legacy preservation and mounted-volume
  container recreation checks passed locally. Temporary fixture resources were removed.
- Live probes were not run; no quota was consumed. No production latency claim is made.
- Repeat fixture run at 23:16 UTC: eight cases passed, classification p95 **0.030800 ms**
  while backend/browser checks were also running. Variation is local processing overhead,
  not a measurement of provider response time or full planning latency.

| Metric | Target | Measured |
|---|---:|---:|
| Partial provider options p95 | <10s | Not measured live |
| Cached provider response p95 | <1s | Not measured live |
| Complete itinerary p95 | <90s | Not measured live |
| Structured output validity | >=98% | Pending |
| Missing-day rate | <1% | Pending |
| Cache-hit rate | >30% | Pending |
| Cross-account access failures | 0 | Pending |

## Capped live probe (2026-09-25)

One network-enabled SerpAPI hotel search returned inventory successfully in **5,307.55 ms**.
The synthetic query used Lisbon, October 22–25, 2026, two adults, USD; no personal data or
bookings. An earlier sandbox-restricted attempt failed after 2,057.55 ms. No automatic
retries or full-plan generation were performed. One successful sample cannot establish
p95, cache behavior, flight latency, or end-to-end planning performance.

Runtime aggregation is blocked by missing `offer_snapshots` in the configured database;
it now returns `migration_required` instead of an unhandled traceback. Redis is unset.
Hosted migrations and service activation remain separate authorized operator steps.

A second capped probe, for a synthetic LAX–JFK round trip on October 22–25, 2026,
two adults in USD, returned flight inventory in **9,281.64 ms**. This is also one sample,
not proof of the first-options p95 target. Total network-enabled probes: one hotel and
one flight request; no bookings or background monitoring were started.
