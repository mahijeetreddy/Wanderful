import { useState } from "react";
import type { SavedTrip, TripSelection } from "../../domain/travel";
import { apiFetch, readApiJson } from "../../api/client";

export function BookingSelections({ trip, onUpdated }: { trip: SavedTrip; onUpdated: (trip: SavedTrip) => void }) {
  return <details className="mt-3 rounded-2xl border border-amber-200/20 bg-amber-200/5 p-3 text-sm text-white/80">
    <summary className="min-h-11 cursor-pointer content-center text-amber-100">Selections & booking status</summary>
    <p className="my-2 text-xs text-white/65">Bookings are confirmed by you, not verified with providers. Record payments separately in Expenses.</p>
    {(["flights", "hotels"] as const).map((kind) => <BookingSelection key={`${kind}-${trip.savedAt}`} kind={kind} trip={trip} onUpdated={onUpdated} />)}
  </details>;
}

function BookingSelection({ kind, trip, onUpdated }: { kind: TripSelection["kind"]; trip: SavedTrip; onUpdated: (trip: SavedTrip) => void }) {
  const record = trip.selections?.find((entry) => entry.kind === kind);
  const lockedId = kind === "flights" ? trip.structuredItinerary?.locked_flight_id : trip.structuredItinerary?.locked_hotel_id;
  const offers = (trip.options[kind] || []).filter((offer) => offer.snapshot_id && (kind !== "flights" || ("has_return_details" in offer && offer.has_return_details)));
  const [snapshotId, setSnapshotId] = useState(record?.snapshot_id || offers.find((offer) => offer.id === lockedId)?.snapshot_id || "");
  const [status, setStatus] = useState<TripSelection["status"]>(record?.status || "selected");
  const [reference, setReference] = useState(record?.booking_reference || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true); setError("");
    try {
      const response = await apiFetch(`/api/trips/${trip.id}/selection`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot_id: snapshotId, status, booking_reference: reference, expected_snapshot_id: record?.snapshot_id || null }),
      });
      const payload = await readApiJson<{ trip: SavedTrip }>(response);
      onUpdated(payload.trip);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save selection."); }
    finally { setBusy(false); }
  };
  return <fieldset disabled={busy} className="mt-3 space-y-2 border-t border-white/10 pt-3">
    <legend className="font-medium">{kind === "flights" ? "Round-trip flight" : "Stay"}</legend>
    {!offers.length ? <p className="text-xs text-white/60">Search again to select a current {kind === "flights" ? "complete round trip" : "stay"}. Historical choices remain in your itinerary.</p> : <>
      <label className="block text-xs">Option<select value={snapshotId} onChange={(event) => { setSnapshotId(event.target.value); setStatus("selected"); setReference(""); }} className="mt-1 min-h-11 w-full rounded-xl bg-[#0e1518] p-2">
        <option value="">Choose an option</option>
        {offers.map((offer) => <option key={offer.snapshot_id} value={offer.snapshot_id}>{"name" in offer ? offer.name : offer.segments?.map((segment) => segment.from).join(" → ") || "Flight"} · {offer.currency} {"name" in offer ? offer.estimated_total ?? "Price unknown" : offer.total_price ?? "Price unknown"}</option>)}
      </select></label>
      <label className="block text-xs">Status<select value={status} onChange={(event) => setStatus(event.target.value as TripSelection["status"])} className="mt-1 min-h-11 w-full rounded-xl bg-[#0e1518] p-2">
        <option value="selected">Selected · not booked</option><option value="externally_booked">Booked externally · recorded by me</option>
      </select></label>
      {status === "externally_booked" ? <label className="block text-xs">Booking reference (optional)<input maxLength={160} value={reference} onChange={(event) => setReference(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl bg-[#0e1518] p-2" /></label> : null}
      <button type="button" disabled={!snapshotId || busy} onClick={save} className="min-h-11 rounded-full bg-[#72d7dc] px-4 text-[#06181a] disabled:opacity-50">{busy ? "Saving…" : "Save selection"}</button>
    </>}
    {error ? <p role="alert" className="text-xs text-amber-100">{error}</p> : null}
  </fieldset>;
}
