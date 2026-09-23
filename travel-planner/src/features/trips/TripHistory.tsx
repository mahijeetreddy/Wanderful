import { useState } from "react";
import { apiFetch, readApiJson } from "../../api/client";
import type { SavedTrip } from "../../domain/travel";
import { Modal } from "../search/Modal";

type HistoryEntry = { revision: number; created_at: string; days: number };
export function TripHistory({ trip, onUpdated }: { trip: SavedTrip; onUpdated: (trip: SavedTrip) => void }) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [revision, setRevision] = useState(trip.revision);
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = async () => {
    setOpen(true); setBusy(true); setError(""); setChosen(null);
    try { const payload = await apiFetch(`/api/trips/${trip.id}/history`).then(r => readApiJson<{ revision: number; history: HistoryEntry[] }>(r)); setEntries(payload.history); setRevision(payload.revision); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load history."); }
    finally { setBusy(false); }
  };
  const restore = async () => {
    setBusy(true); setError("");
    try {
      const payload = await apiFetch(`/api/trips/${trip.id}/undo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expected_revision: revision, target_revision: chosen }) }).then(r => readApiJson<{ trip: SavedTrip }>(r));
      onUpdated(payload.trip); setOpen(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Restore failed. Your current trip is unchanged."); }
    finally { setBusy(false); }
  };
  return <><button onClick={() => void load()} className="mt-3 min-h-11 rounded-full border border-white/25 px-4 text-sm text-white/80">Itinerary history</button>{open && <Modal label="Itinerary history" onClose={() => { if (!busy) setOpen(false); }}><section className="w-full max-w-xl rounded-3xl border border-[#72d7dc]/25 bg-[#0e1518] p-6 text-white"><div className="flex items-center justify-between gap-4"><h2 className="text-2xl">Restore a previous plan</h2><button disabled={busy} className="min-h-11 rounded-full border border-white/25 px-4" onClick={() => setOpen(false)}>Close</button></div><p className="my-4 text-sm text-white/75">Restores itinerary and selections only. Payments, settlements, documents, and booking status stay unchanged.</p>{error && <p role="alert" className="my-3 text-amber-100">{error}</p>}{!busy && !entries.length && <p>No earlier itinerary revisions yet.</p>}<fieldset className="space-y-2"><legend className="sr-only">Choose a revision</legend>{entries.map(entry => <label key={entry.revision} className="flex min-h-11 items-center gap-3 rounded-xl border border-white/20 p-3"><input type="radio" name={`history-${trip.id}`} checked={chosen === entry.revision} onChange={() => setChosen(entry.revision)} disabled={busy} /><span>Revision {entry.revision} · {entry.days} days<span className="block text-xs text-white/75">{new Date(entry.created_at).toLocaleString()}</span></span></label>)}</fieldset><button disabled={busy || chosen == null} onClick={() => void restore()} className="mt-5 min-h-11 w-full rounded-full bg-[#72d7dc] px-4 text-[#06181a] disabled:opacity-50">{busy ? "Please wait…" : "Restore selected revision"}</button></section></Modal>}</>;
}
