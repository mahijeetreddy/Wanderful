# Interface, maps and planning latency — 2026-09-29

## Implemented locally

- A date-range dialog with two months on desktop / one on mobile, selected-range
  highlighting, night count, disabled past dates, arrow/Home/End/Page keyboard controls,
  Escape/focus restoration and explicit Apply. Manual date fields remain available.
- Device-persisted light/dark toggle. Light uses cream, blue-grey ink, pale-blue surfaces
  and apricot accents. Existing dark styling remains the default. No image inversion.
- Place matching normalizes accents and accepts a verified name within a descriptive
  activity/location. Known local city names and airport aliases are supported. Provider
  `data_id` can identify a source when `place_id` is absent, without misusing it as a
  Google `query_place_id`. Ambiguous, wrong-city and invalid-coordinate results stay unresolved.
- Route UI retains existing verified coordinates, only requests missing stops, ignores
  cancelled responses, supports retries and list-to-map focus, and distinguishes provider
  errors from unresolved matches. Coordinates are never invented or borrowed from weather.

## Observed latency (not a forecast or a benchmark guarantee)

Read-only inspection of the latest completed six-day job found:

| Stage | Recorded time |
| --- | ---: |
| All provider collection | 50.965 s |
| Local search (slowest provider) | 50.355 s |
| First useful result | 7.465 s |
| All planning | 145.024 s |
| Fallback outline | 26.354 s |
| Day expansion | 65.488 s |
| Whole job | 196.708 s |

The approximately 53-second difference between planning total and the outline/expansion
stages corresponds to the failed fast attempt and surrounding overhead. The stored
metrics mark `parallel_day_fallback` and `outline_fallback: true`, but do not store the
original exception; its cause cannot be recovered from these metrics alone. The recorded
`llm_calls: 7` omits the initial fast attempt and is not an actual SDK request count.

Current code waits for all four provider tasks before drafting. LLM calls allow 120-second
timeouts, agent retries, and a second outline/day pipeline; day expansion defaults to two
workers. Redis is unconfigured. Adding Redis would isolate work from the web process,
but would not by itself reduce an individual LLM or provider request's latency.

Recommended follow-up (diagnosed, not changed in this interface increment):

1. Record sanitized failure categories and actual per-attempt timing/counts.
2. Use direct schema-constrained generation for the structured plan; compact provider
   context field-by-field instead of truncating a JSON string at 18,000 characters.
3. Bound retry/fallback work with an overall deadline. Use a targeted repair for invalid
   fields rather than silently restarting the whole multi-call workflow.
4. Separate itinerary-essential research from optional slow search enrichment; publish
   useful results progressively, with clear missing-evidence status.
5. Measure cached/uncached representative six-day jobs before tuning concurrency or
   enabling Redis/RQ. Do not present a sub-90-second target as an achieved result.

## Free map options evaluated

Map rendering, map tiles, place lookup and street routing are different services. Changing
the renderer alone will not resolve missing coordinates or generate real walking routes.

- **MapLibre + Geoapify:** strongest candidate for an initial commercial product. MapLibre
  is an open-source vector renderer with custom styling. Geoapify currently offers 3,000
  credits/day and allows commercial production use with attribution and usage limits.
  Credits are not equivalent to 3,000 complete itinerary maps. Requires a new account/key.
  Sources: https://maplibre.org/projects/gl-js/ and https://www.geoapify.com/pricing/
- **MapLibre + Protomaps/PMTiles:** open-source map-in-a-file approach with deployment
  control. Data serving/storage/bandwidth and operations still have costs; not unlimited
  free hosted infrastructure. Source: https://protomaps.com/
- **Existing Leaflet + OSM tiles:** no new provider setup for modest interactive use.
  Styling and interaction can improve without replacing Leaflet, but OSM public tiles
  are a community service, not a production SLA or an offline tile source.
  Source: https://operations.osmfoundation.org/policies/tiles/
- **MapTiler:** polished styles; current free tier is positioned for testing/prototyping,
  personal or non-commercial use, so it is not the default free commercial recommendation.
  Source: https://www.maptiler.com/cloud/pricing/

No provider subscriptions, new accounts, paid services, hosted schema changes, commits
or pushes were performed for this increment. Two bounded live SerpAPI lookups resolved the
Colosseum in Rome and South Beach in Miami with source identity and coordinates. The
latter matches a stop from the latest itinerary. This is not global coverage:
fixture tests prove matching/recovery behavior, not availability for every destination.

## Validation results

- Full backend suite: **126 passed (225.31 s)**. The subsequently added endpoint-status
  regression also passed in a four-test endpoint run (**4 passed, 5.40 s**).
- Focused desktop/mobile calendar/theme and route-recovery checks: **4 passed**. These
  include axe scans, keyboard selection, reload persistence and retained verified markers.
- Final production build passed. Full browser suite with `CI=true`: **47 passed / 1 timeout
  (5.8 min)**. The desktop offline test timed out returning online; the trace captured
  HTTP 404 for `/` while the production output was being rebuilt during that run.
  With the build complete and unchanged, both production-offline journeys passed
  (**2 passed, 21.7 s**), including logout and IndexedDB cleanup. No test assertions or
  timeouts were weakened. Future validation should run build and browser checks sequentially.
- Visually inspected desktop light landing/calendar and mobile calendar/route captures.
  Screenshots are in ignored `test-results/`. Automated map tests block public tile requests.
- Wanderful frontend on `127.0.0.1:5176` and restarted API on `127.0.0.1:5052` verified;
  readiness and frontend API proxy both returned HTTP 200. No Redis activation occurred.
