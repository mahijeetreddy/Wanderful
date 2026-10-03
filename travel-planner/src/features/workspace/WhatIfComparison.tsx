import { useEffect, useRef, useState } from "react";
import { TravelLoading } from "../loading/TravelLoading";
import type { FlightOption, HotelOption, SavedTrip, SearchSession } from "../../domain/travel";
import { apiFetch, readApiJson } from "../../api/client";
import { field, message, primary, secondary, type Scenario, type ToolRecord } from "./types";

export function WhatIfComparison({ trip, records, save, remove, busy }: { trip: SavedTrip; records: ToolRecord[]; save: (id: string, type: "scenario", data: Record<string, unknown>) => Promise<void>; remove: (id: string) => Promise<void>; busy: boolean }) {
  const [name, setName] = useState("Alternative"), [start, setStart] = useState(trip.form.start_date), [end, setEnd] = useState(trip.form.end_date);
  const [zone, setZone] = useState(trip.form.destination_timezone || "");
  const [flights, setFlights] = useState<FlightOption[]>(trip.options.flights || []), [hotels, setHotels] = useState<HotelOption[]>(trip.options.hotels || []);
  const [flight, setFlight] = useState(""), [hotel, setHotel] = useState("");
  const [outbound, setOutbound] = useState(""), [returnBusy, setReturnBusy] = useState(false);
  const returnRequest = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<Record<string, string>>({}), [error, setError] = useState("");
  const request = useRef<AbortController | null>(null), timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const cancel = () => { request.current?.abort(); returnRequest.current?.abort(); timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => cancel, []);
  const datesChanged = start !== trip.form.start_date || end !== trip.form.end_date;
  const changeDates = (value: string, first: boolean) => { cancel(); first ? setStart(value) : setEnd(value); setFlight(""); setHotel(""); setOutbound(""); setReturnBusy(false); setFlights([]); setHotels([]); setStatus({}); };
  const search = async () => {
    cancel(); const controller = new AbortController(); request.current = controller;
    setError(""); setFlight(""); setHotel(""); setOutbound(""); setReturnBusy(false); setFlights([]); setHotels([]); setStatus({ flights: "searching", hotels: "searching" });
    await Promise.all((["flights", "hotels"] as const).map(async kind => {
      try {
        const created = await readApiJson<{ id: string }>(await apiFetch("/api/search-sessions", { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...trip.form, start_date: start, end_date: end, kind }) }));
        const deadline = Date.now() + 120_000;
        const poll = async (): Promise<void> => {
          if (controller.signal.aborted) return;
          try {
            const result = await readApiJson<SearchSession>(await apiFetch(`/api/search-sessions/${created.id}`, { signal: controller.signal }));
            if (["queued", "searching"].includes(result.status)) {
              if (Date.now() >= deadline) { setStatus(s => ({ ...s, [kind]: "timeout — retry search" })); return; }
              timers.current.push(setTimeout(() => void poll(), 1500)); return;
            }
            setStatus(s => ({ ...s, [kind]: result.status }));
            if (kind === "flights") setFlights(result.flights || []); else setHotels(result.hotels || []);
          } catch (e) { if (!controller.signal.aborted) { setStatus(s => ({ ...s, [kind]: "failed" })); setError(message(e)); } }
        };
        await poll();
      } catch (e) { if (!controller.signal.aborted) { setStatus(s => ({ ...s, [kind]: "failed" })); setError(message(e)); } }
    }));
  };
  const scenarios = records.filter((r): r is ToolRecord & { type: "scenario"; data: Scenario } => r.type === "scenario");
  const searching = Object.values(status).some(s => s === "searching");
  return <div className="space-y-6"><div><p className="text-xs uppercase tracking-widest text-[#91e4db]">Room to explore</p><h3 className="mt-2 text-3xl">What if you went another way?</h3><p className="mt-3 text-sm text-slate-300">Compare up to three alternatives. Your trip and bookings stay untouched.</p></div>
    <form className="space-y-4 rounded-2xl border border-white/20 bg-white/5 p-5" onSubmit={async e => { e.preventDefault(); setError(""); try { await save(`tool-${crypto.randomUUID()}`, "scenario", { name, start_date: start, end_date: end, flights_snapshot_id: flight || undefined, hotels_snapshot_id: hotel || undefined, assumptions: { destination_timezone: zone } }); } catch (e) { setError(message(e)); } }}>
      <div className="grid gap-4 sm:grid-cols-3"><label className="text-sm">Alternative name<input className={field} required maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label><label className="text-sm">Departure date<input className={field} type="date" required value={start} onChange={e => changeDates(e.target.value, true)} /></label><label className="text-sm">Return date<input className={field} type="date" required min={start} value={end} onChange={e => changeDates(e.target.value, false)} /></label></div>
      <button type="button" className={secondary} disabled={!start || end <= start} onClick={() => void search()}>{searching ? "Restart search" : "Search these dates"}</button>
      {(status.flights === "searching" || returnBusy) && <TravelLoading theme="flights" label={returnBusy ? "Finding your return flight" : "Finding alternative flights"} compact />}
      {status.hotels === "searching" && <TravelLoading theme="stays" label="Finding alternative stays" compact />}
      {Object.keys(status).length > 0 && <p role="status" className="text-sm text-slate-300">Flights: {status.flights} · Stays: {status.hotels}</p>}
      {flights.some(o => o.snapshot_id && !o.has_return_details && o.departure_token) && <div className="rounded-xl border border-white/20 p-4"><label className="block text-sm">Complete an outbound flight<select className={field} value={outbound} onChange={e => setOutbound(e.target.value)}><option value="">Choose outbound</option>{flights.filter(o => o.snapshot_id && !o.has_return_details && o.departure_token).map(o => <option key={o.snapshot_id} value={o.snapshot_id}>{o.segments?.[0]?.airline || "Flight"} · {o.segments?.[0]?.depart_at || "time unknown"}</option>)}</select></label><button type="button" className={`${secondary} mt-3`} disabled={!outbound || returnBusy} onClick={async () => {
        returnRequest.current?.abort(); const controller = new AbortController(); returnRequest.current = controller;
        setReturnBusy(true); setError("");
        try { const result = await readApiJson<{ return_options: FlightOption[] }>(await apiFetch("/api/flight-return-options", { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ snapshot_id: outbound }) })); setFlights(current => [...current.filter(o => !result.return_options.some(next => next.snapshot_id === o.snapshot_id)), ...result.return_options]); if (!result.return_options.length) setError("No return choices found. Try another outbound flight."); }
        catch (e) { if (!controller.signal.aborted) setError(message(e)); }
        finally { if (!controller.signal.aborted) setReturnBusy(false); }
      }}>{returnBusy ? "Finding returns…" : "Find return choices"}</button><p className="mt-2 text-xs text-slate-300">Choose the completed round trip below after returns arrive.</p></div>}
      <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">Round-trip flight<select className={field} value={flight} onChange={e => setFlight(e.target.value)}><option value="">{datesChanged ? "Choose a new-date quote" : "Keep current selection"}</option>{flights.filter(o => o.snapshot_id && o.has_return_details).map(o => <option key={o.snapshot_id} value={o.snapshot_id}>{o.segments?.[0]?.airline || "Flight"} · {o.currency} {o.total_price ?? "price unknown"} · {o.segments?.[0]?.depart_at || "time unknown"}</option>)}</select></label>
        <label className="text-sm">Stay<select className={field} value={hotel} onChange={e => setHotel(e.target.value)}><option value="">{datesChanged ? "Choose a new-date quote" : "Keep current selection"}</option>{hotels.filter(o => o.snapshot_id).map(o => <option key={o.snapshot_id} value={o.snapshot_id}>{o.name} · {o.currency} {o.estimated_total ?? "total unknown"}</option>)}</select></label></div>
      <label className="block text-sm">Destination time zone <span className="text-slate-300">(optional, for timing)</span><input className={field} placeholder="Europe/Lisbon" value={zone} onChange={e => setZone(e.target.value)} /></label>
      <p className="text-xs text-slate-300">Only complete round-trip quotes are comparable. Arrival +2h and departure −3h are transfer/check-in assumptions. Changed dates need new quotes.</p>
      {error && <p role="alert" className="text-amber-100">{error}</p>}
      <button className={primary} disabled={busy || searching || returnBusy || scenarios.length >= 3}>{busy ? "Saving…" : "Add to comparison"}</button>
    </form>
    {!scenarios.length && <p className="rounded-2xl border border-dashed border-white/25 p-6 text-slate-300">Try a later departure, a different stay, or a new set of dates.</p>}
    <div className="grid items-start gap-4 lg:grid-cols-3">{scenarios.map(({ id, data }) => {
      const money = (n: number | null) => n == null ? "Not enough price data" : `${data.currency} ${(n / 10 ** data.exponent).toFixed(data.exponent)}`;
      const issues = data.impacts.flatMap(i => i.affected_activities);
      return <article key={id} className="rounded-3xl border border-[#91e4db]/25 bg-gradient-to-b from-[#1a393a] to-[#102127] p-5"><p className="text-xs text-[#91e4db]">Saved snapshot · base revision {data.base_revision}</p><h4 className="mt-2 text-2xl">{data.name}</h4><p className="mt-2 text-sm text-slate-300">{data.form.start_date} → {data.form.end_date}</p><p className="mt-5 text-2xl">{money(data.travel_total_minor)}</p><p className="text-xs text-slate-300">Flight + full stay estimate, not whole-trip spending</p><dl className="mt-4 space-y-3 text-sm"><div><dt className="text-slate-300">Original flight + stay</dt><dd>{money(data.baseline_travel_total_minor)}</dd></div><div><dt className="text-slate-300">Difference from original</dt><dd>{money(data.delta_minor)}</dd></div><div><dt className="text-slate-300">Time at destination after buffers</dt><dd>{data.available_hours == null ? "Timing not verified" : `${data.available_hours.toFixed(1)} hours (includes nights)`}</dd></div></dl>
        <dl className="mt-4 space-y-3 border-t border-white/20 pt-4 text-sm"><div><dt className="text-slate-300">Whole-trip expected estimate</dt><dd>{money(data.expected_trip_total_minor ?? null)}</dd></div><div><dt className="text-slate-300">Remaining after reserve</dt><dd>{money(data.budget_remaining_minor ?? null)}</dd></div></dl>
        <p className="mt-4 text-sm">{data.selected.hotels?.name || "Stay not selected"}</p>{issues.length > 0 && <div className="mt-4 rounded-xl bg-amber-100/10 p-3 text-sm text-amber-100"><p>{issues.length} activities need review</p>{issues.map((i, index) => <p key={index}>{i.title}{i.locked ? " · locked" : ""}</p>)}</div>}
        <details className="mt-3 text-sm text-slate-300"><summary className="min-h-11 cursor-pointer py-3">Price & timing notes</summary><ul className="space-y-2">{data.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details><button className={`${secondary} mt-3`} disabled={busy} onClick={async () => { if (!window.confirm("Remove this comparison snapshot? Your trip stays unchanged.")) return; try { await remove(id); } catch (e) { setError(message(e)); } }}>Remove alternative</button>
      </article>;
    })}</div>
  </div>;
}
