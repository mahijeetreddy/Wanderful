# Planning latency — 2026-09-29

Latest follow-up: [independent attraction research, evidence review and timing cohorts](ATTRACTION_RELIABILITY.md).
The earlier timeout observations below are retained as historical measurements, not the
current research architecture. The new live sample returned place research in 3.8–4.1 s.

## Implemented

- Default structured planning bypasses the agent loop and requests compact JSON directly from the configured model. Gemini uses native schema-constrained output; existing alternative providers use LiteLLM JSON mode and local schema validation.
- Gemini 2.5 Flash uses a 512-token thinking budget. Other models do not receive that model-specific parameter. No model, credential, infrastructure or paid-service changes.
- One generation request, at most one missing-day repair. Valid days are retained. Network failures, invalid JSON and entirely empty responses fail explicitly rather than cascading into outline plus N day-generation calls.
- Generation budget defaults to 70 seconds; first request has a 50-second timeout. SDK retries are disabled; late results are rejected. Timeout controls are not guaranteed wall-clock SLAs: DNS, transport and process scheduling can add overhead.
- Four providers still run concurrently and publish offers independently. Interactive collection no longer retries failed requests. Each task shares a 15-second remaining HTTP timeout budget across its requests; local search is capped at 10 seconds. Requests timeouts are socket inactivity limits, not hard process deadlines. No detached provider threads were introduced.
- Prompts use normalized options and concise evidence, not duplicated raw responses or truncated JSON. Currency, dates, traveler count and day numbering are server-owned. Unsupported generated source URLs are removed; coordinates are not generated.
- Success and failure record request counts, durations and sanitized failure categories. First-useful timing now recognizes normalized flight offers. Cancellation is checked after generation, before completion/email.

## Live measurement

One uncached synthetic six-day LAX → Rome request using existing credentials, without account writes, emails or hosted database access:

| Measurement | Observed |
| --- | ---: |
| First useful options (hotels) | 6.303 s |
| Provider collection | 12.511 s |
| Itinerary generation | 19.671 s |
| Total measured planning | 32.195 s |
| LLM requests | 1 |
| Days / activities | 6 / 17 |

Hotels, weather and local search succeeded. Flights did **not** return usable inventory. The initial benchmark classified the flight failure as unavailable; classification was subsequently corrected to preserve error vs unavailable vs timeout. This sample does not demonstrate all-provider success.

The earlier reported run was 197 seconds (51 collecting, 145 planning). This is a directional comparison, not a controlled same-input benchmark or p95 result. Imports/cold start, queue delay, database snapshot writes and email delivery are outside this script's timer. Under-10-second first-options and under-90-second complete-plan p95 objectives remain targets.

## Reproduce and configure

Offline: `python -m pytest tests/test_direct_planner.py tests/test_data_collector.py tests/test_queue_and_jobs.py tests/test_planner_engine.py -q`.

Live, explicitly spending provider quota: `python scripts/benchmark_planning.py --live`. By default this runs one six-day trip. `--runs 3 --concurrency 2` runs the Rome/6-day, London/3-day, Tokyo/10-day matrix. Hard caps: six runs, two concurrent planners, five provider HTTP requests and two LLM calls per run. Missing credentials produce a failure report. Output separates structural quality from provider availability and does not contain credentials or generated content. No Redis cache, hosted database or emails are used.

Optional settings (defaults work without editing `.env`):

```dotenv
FAST_PLAN_MODE=true
PLAN_GENERATION_SECONDS=70
PLAN_FIRST_REQUEST_SECONDS=50
PLAN_PROVIDER_SECONDS=15
```

`FAST_PLAN_MODE=false` explicitly restores the legacy outline/day path and is **not** covered by the new generation budget. Single-day regeneration and guidebooks now use one direct schema-constrained request with a 35-second timeout and reject late results. Failed guidebooks are reported as failed, not generic successful content. Gemini streams validated day objects into an account-scoped read-only preview; other configured providers publish previews when their response completes. The UI polls those previews and does not save/export/edit them before final validation. Redis remains useful for caching/queue durability but was not required for this improvement.

## Reliability follow-up (2026-09-30)

The Rome failure was reproduced with the metropolitan `ROM` identifier. With the same dates, explicit airports `FCO,CIA` returned 11 offers. Flight lookups now expand ROM/PAR/LON/TYO/NYC metropolitan codes to explicit airport lists, without rewriting a specific airport chosen by the traveler. SerpAPI's explicit no-results response becomes empty inventory, not a provider failure. Exception formatting no longer includes provider response bodies or credential-bearing request URLs. SerpAPI documents comma-separated airport IDs in its [flight search interface](https://serpapi.com/google-flights-api).

Exploratory live matrix, with two concurrent planners:

| Destination | Days | First offers | Generation | Full plan | First draft day (generation elapsed) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Rome | 6 | 8.006 s | 18.594 s | 33.183 s | 10.727 s |
| London | 3 | 8.463 s | 14.838 s | 29.370 s | 10.478 s |
| Tokyo | 10 | 3.648 s | 15.969 s | 26.966 s | 5.160 s |

Each used one LLM request. Flights, hotels and weather returned successfully in all three; local attraction search timed out in all three. Costs and activities therefore remain estimates, not fact-verified recommendations. The planner now adds a deterministic warning when local evidence is absent. Structural/date/link checks passed; Tokyo's estimate exceeded its target budget by USD 5, which is a reported budget warning, not silently suppressed.

The evaluator now rejects wrong-date coverage, empty days and unsupported source links. Opening hours, transit duration and factual verification are explicitly unmeasured, rather than counted as successful grounding. The RAG/day-realism project is deferred at the user's request.

Separate live auxiliary requests: one-day regeneration **14.430 s** (three activities), guidebook **8.415 s**. These and the three-trip matrix are small exploratory samples, not production p95 guarantees. Socket timeouts and streaming elapsed checks still cannot guarantee an exact wall-clock cutoff during OS/DNS stalls. No force-killed threads or hidden background retry loops were introduced.

Final follow-up validation: **152 backend tests passed**, **52 browser tests passed**
across desktop/mobile (including new draft preview completion/logout checks), and
production build passed. API restarted on port 5052; readiness and the frontend API
proxy returned HTTP 200. Test UI: http://127.0.0.1:5176/. No commits or pushes.

Validation: full backend suite **141 passed**; production frontend build passed. Tests cover targeted repair, malformed output, deadline rejection, sanitized failures, provider retry suppression, metadata ownership and cancellation during generation.

Follow-up verification (2026-09-30): **10 browser checks passed** across desktop/mobile selection and production offline/logout journeys. The first sandboxed browser attempt could not spawn (EPERM); the approved rerun passed. Local API restarted with the changes on port 5052; readiness and the frontend API proxy returned HTTP 200. Frontend is available on port 5176. No commits or pushes.

SDK references: [Google GenAI Python](https://googleapis.github.io/python-genai/), [Gemini thinking budgets](https://ai.google.dev/gemini-api/docs/thinking), [LiteLLM JSON mode](https://docs.litellm.ai/docs/completion/json_mode).
