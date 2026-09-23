import { useState } from "react";
import { apiFetch, readApiJson } from "../../api/client";
import type { SavedTrip } from "../../domain/travel";
import { Modal } from "../search/Modal";

export type TripImpact = {
  currency: string; expected_revision: number; price_delta_minor: number | null;
  can_apply: boolean; warnings: string[]; affected_activities: { activity_key: string; title: string; date: string; locked: boolean; reason: string }[];
  activity_windows: { available_from?: string; available_until?: string };
  assumptions: { arrival_buffer_minutes: number; departure_buffer_minutes: number; destination_timezone: string; label: string };
  budget_after: { budget_remaining_minor: number; exponent: number };
  proximity?: { mean_km: number; places: number; basis: string } | null;
};
export type Decision = { impact: TripImpact; preview_token: string };

export function DecisionPreview({ tripId, decision, onClose, onApplied }: { tripId: string; decision: Decision; onClose: () => void; onApplied: (trip: SavedTrip) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const value = decision.impact;
  const money = (amount: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: value.currency }).format(amount / 10 ** value.budget_after.exponent);
  const apply = async () => {
    setBusy(true); setError("");
    try {
      const response = await apiFetch(`/api/trips/${tripId}/decisions/apply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preview_token: decision.preview_token }) });
      const payload = await readApiJson<{ trip: SavedTrip }>(response);
      onApplied(payload.trip);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not apply this choice."); }
    finally { setBusy(false); }
  };
  return <Modal label="Review trip impact" onClose={onClose}><section className="w-full max-w-2xl rounded-3xl border border-amber-200/25 bg-[#0e1518] p-6 text-white">
    <header className="flex items-center justify-between gap-4"><h2 className="text-2xl">Before you choose</h2><button className="min-h-11 rounded-full border border-white/25 px-4" onClick={onClose}>Keep current choice</button></header>
    <div className="my-6 grid grid-cols-2 gap-4"><div className="rounded-2xl bg-[#72d7dc]/10 p-4"><p className="text-sm text-white/75">Price change</p><p className="mt-2 text-2xl">{value.price_delta_minor == null ? "Not comparable" : `${value.price_delta_minor > 0 ? "+" : ""}${money(value.price_delta_minor)}`}</p></div><div className="rounded-2xl bg-amber-200/10 p-4"><p className="text-sm text-white/75">Budget remaining</p><p className="mt-2 text-2xl">{money(value.budget_after.budget_remaining_minor)}</p></div></div>
    {value.activity_windows.available_from && <p className="mb-3 text-sm text-white/80">Available for activities: {value.activity_windows.available_from} to {value.activity_windows.available_until}</p>}
    {!!value.affected_activities.length && <ul className="space-y-2">{value.affected_activities.map(item => <li key={item.activity_key} className="rounded-xl border border-amber-200/25 p-3 text-sm text-amber-100">{item.locked ? "Locked conflict" : "Needs replanning"}: {item.title} · {item.date}</li>)}</ul>}
    {value.proximity && <p className="mt-3 text-sm text-white/75">{value.proximity.mean_km} km average from {value.proximity.places} known places. {value.proximity.basis}.</p>}
    <p className="mt-4 text-xs text-white/75">Assumptions: {value.assumptions.arrival_buffer_minutes} minutes after arrival; {value.assumptions.departure_buffer_minutes} minutes before departure. Time zone: {value.assumptions.destination_timezone || "Not supplied"}. Activities are flagged, never silently moved.</p>
    {value.warnings.map((warning, index) => <p key={index} className="mt-3 text-sm text-amber-100">{warning}</p>)}
    {error && <p role="alert" className="mt-4 text-amber-100">{error}</p>}
    <button disabled={busy || !value.can_apply} onClick={() => void apply()} className="mt-6 min-h-11 w-full rounded-full bg-[#72d7dc] px-5 text-[#06181a] disabled:opacity-50">{busy ? "Applying…" : value.can_apply ? "Apply reviewed choice" : "Resolve locked conflicts first"}</button>
  </section></Modal>;
}
