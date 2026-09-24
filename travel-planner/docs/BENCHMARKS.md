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

| Metric | Target | Measured |
|---|---:|---:|
| Partial provider options p95 | <10s | Not measured live |
| Cached provider response p95 | <1s | Not measured live |
| Complete itinerary p95 | <90s | Not measured live |
| Structured output validity | >=98% | Pending |
| Missing-day rate | <1% | Pending |
| Cache-hit rate | >30% | Pending |
| Cross-account access failures | 0 | Pending |
