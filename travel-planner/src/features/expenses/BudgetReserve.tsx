import { useState } from "react";
import { apiFetch, readApiJson } from "../../api/client";
import type { SavedTrip } from "../../domain/travel";
export function BudgetReserve({ trip, revision, percent, amount, remaining, onUpdated }: { trip: SavedTrip; revision: number; percent: string; amount: string; remaining: string; onUpdated: (trip: SavedTrip) => void }) {
  const [value, setValue] = useState(percent), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const save = async () => {
    setBusy(true); setError("");
    try { const payload = await apiFetch(`/api/trips/${trip.id}/reserve`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expected_revision: revision, reserve_percent: value }) }).then(r => readApiJson<{ trip: SavedTrip }>(r)); onUpdated(payload.trip); }
    catch (e) { setError(e instanceof Error ? e.message : "Reserve could not be saved. Your draft is retained."); }
    finally { setBusy(false); }
  };
  return <section className="rounded-2xl border border-amber-200/25 p-4"><div className="flex flex-wrap items-end gap-4"><label className="text-sm text-white/75">Safety reserve (%)<input aria-label="Safety reserve percentage" type="number" min={0} max={50} step="0.01" value={value} onChange={e => setValue(e.target.value)} className="expense-input mt-2 max-w-32" /></label><button disabled={busy} onClick={() => void save()} className="min-h-11 rounded-full border border-white/25 px-4">Save reserve</button><p className="text-sm">{amount} reserved · {remaining} available after reserve</p></div>{error && <p role="alert" className="mt-3 text-amber-100">{error}</p>}</section>;
}
