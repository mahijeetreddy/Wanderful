# Product workspace: comparisons, preferences, inbox and Today

## Where to find them

- Travel preferences: planner form, next to the per-plan preference toggle.
- What if?, Booking inbox, Today mode: toolbar above the tabs of an opened, account-saved trip.
- Offline day view: prepare a pack, open `/offline`, then choose **Open day mode**.

## Behavior and boundaries

Preferences are account-scoped defaults used as soft planning context, not guaranteed
provider filters. The existing trip is unchanged. Changes use a separate revision check.

Comparisons retain up to three snapshots per trip. Date searches publish provider results
independently and support outbound-to-return completion. Missing quotes and timing remain
unknown. Price differences compare flight/full-stay totals against the original selections
at snapshot creation. Whole-trip forecasts reuse the ledger and preserve recorded financial
commitments; other planned costs are carried forward, including when dates change. Remaining
budget includes the reserve. These are estimates, not live revalidation or availability.
Destination time at leisure is labeled elapsed time including nights, after assumed two-hour
arrival and three-hour departure buffers. Conflicting activities are listed, not moved.
Scenarios are comparison-only: applying or regenerating a whole alternative is not included.

The booking inbox supports manual entry, pasted text, plain-text `.txt` and `.eml` imports
up to 100 KB. Only explicitly labeled fields and ISO dates are extracted; unrecognized values
stay blank. Raw imports are not stored or sent to an external LLM. PDF, image/OCR, calendar
files and email-account connections are not supported in this increment. Every extracted
entry is a draft; the user reviews and saves it. Confirmed means confirmed by the user,
not verified with a provider. Payments, ledger commitments and selected offers are separate.
Removing an entry never cancels an external booking. Duplicate references are blocked for
the same booking type within the same trip; existing entries can be reviewed and updated.

Today mode shows the selected day's activities, directions, daily plan estimate and
user-confirmed inbox bookings relevant to that date. It uses an explicit destination IANA
time zone; an unknown/invalid zone disables automatic “today” and “next scheduled” labels.
Outside trip dates it shows a labeled day preview. The offline pack's day view is read-only;
inbox confirmations, document contents, live directions and map tiles are excluded.

## Persistence and privacy

Account preferences extend `user_preferences.memory_json`; tool entries use existing
`trip_records` kinds `scenario` and `inbox`. No new schema migration or hosted configuration
is introduced, but the existing migrations through revision 08 remain prerequisites.
Tools use owner authorization, trip revisions, stable IDs, same-request retries and explicit
deletion. They do not change itinerary/selection history or ledger arithmetic. The shared
API client cancels account requests and rejects late responses after logout; no new browser
storage or shared-cache entry is introduced. Tool dialogs unmount when the account changes.

## Next feature — reminder requested by the owner

**Realistic day planner backed by a RAG pipeline.** This is next, not implemented here.
Ground activity recommendations and schedules in retrieved information instead of relying
only on the LLM's built-in knowledge. Design for source identity, citations, retrieval dates,
opening hours, reservation requirements, duration and routing evidence, freshness rules,
missing/conflicting-source handling, and deterministic schedule/budget checks. Treat source
text as untrusted data. Evaluate groundedness and feasible schedules before enabling it.
Select source access/licensing and retrieval architecture before adding paid services.
