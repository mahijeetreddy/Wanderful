import { useEffect, useState } from "react";
import { GitCompareArrows, Inbox, Sun, X } from "lucide-react";
import type { SavedTrip } from "../../domain/travel";
import { apiFetch, readApiJson } from "../../api/client";
import { Modal } from "../search/Modal";
import { WhatIfComparison } from "./WhatIfComparison";
import { BookingInbox } from "./BookingInbox";
import { TodayMode } from "./TodayMode";
import { message, secondary, type ToolRecord } from "./types";

export function ProductWorkspace({ trip, onUpdated }: { trip: SavedTrip; onUpdated: (trip: SavedTrip) => void }) {
  const [open, setOpen] = useState<"compare" | "inbox" | "today" | null>(null);
  return <><div className="mb-5 flex flex-wrap gap-2"><button className="action-button" onClick={() => setOpen("compare")}><GitCompareArrows size={17} />What if?</button><button className="action-button" onClick={() => setOpen("inbox")}><Inbox size={17} />Booking inbox</button><button className="action-button" onClick={() => setOpen("today")}><Sun size={17} />Today mode</button></div>{open && <WorkspaceDialog key={`${trip.id}-${open}`} mode={open} trip={trip} onUpdated={onUpdated} onClose={() => setOpen(null)} />}</>;
}
function WorkspaceDialog({ mode, trip, onUpdated, onClose }: { mode: "compare" | "inbox" | "today"; trip: SavedTrip; onUpdated: (trip: SavedTrip) => void; onClose: () => void }) {
  const [records, setRecords] = useState<ToolRecord[]>([]), [revision, setRevision] = useState(trip.revision), [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void apiFetch(`/api/trips/${trip.id}/travel-tools`, { signal: controller.signal }).then(readApiJson<{ records: ToolRecord[]; revision: number }>).then(data => { setRecords(data.records); setRevision(data.revision); setLoaded(true); setError(""); }).catch(e => { if (!controller.signal.aborted) setError(message(e)); });
    return () => controller.abort();
  }, [trip.id, retry]);
  const save = async (id: string, type: "scenario" | "inbox", data: unknown) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await readApiJson<{ trip: SavedTrip; record: ToolRecord }>(await apiFetch(`/api/trips/${trip.id}/travel-tools`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, type, data, expected_revision: revision }) }));
      setRecords(rows => [...rows.filter(r => r.id !== id), result.record]); setRevision(result.trip.revision); onUpdated(result.trip);
    } finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    setBusy(true);
    try { const result = await readApiJson<{ trip: SavedTrip }>(await apiFetch(`/api/trips/${trip.id}/travel-tools/${id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expected_revision: revision }) })); setRecords(rows => rows.filter(r => r.id !== id)); setRevision(result.trip.revision); onUpdated(result.trip); } finally { setBusy(false); }
  };
  const title = mode === "compare" ? "What if trip comparison" : mode === "inbox" ? "Booking inbox" : "Today travel mode";
  return <Modal label={title} onClose={onClose}><section className="w-full max-w-5xl rounded-[28px] border border-white/20 bg-[#0d2026] p-4 shadow-2xl sm:p-8" onClick={e => e.stopPropagation()}><header className="mb-6 flex items-center justify-between gap-3"><h2 className="text-lg text-slate-200">{title}</h2><button className="action-button" aria-label={`Close ${title}`} onClick={onClose}><X size={20} /></button></header>
    {error && <p role="alert" className="mb-4 text-amber-100">{error} <button className={secondary} onClick={() => setRetry(n => n + 1)}>Retry</button></p>}
    {!loaded && !error && <p role="status">Loading your trip tools…</p>}
    {loaded && mode === "compare" && <WhatIfComparison trip={trip} records={records} save={save} remove={remove} busy={busy} />}
    {loaded && mode === "inbox" && <BookingInbox tripId={trip.id} records={records} save={save} remove={remove} busy={busy} />}
    {mode === "today" && <TodayMode destination={trip.destination} days={trip.structuredItinerary?.days || []} currency={trip.form.currency_code} timezone={trip.form.destination_timezone} bookings={records.flatMap(r => r.type === "inbox" ? [r.data] : [])} />}
  </section></Modal>;
}
