import { useEffect, useState } from "react";
import { apiFetch, readApiJson } from "../../api/client";
import type { SavedTrip } from "../../domain/travel";
type WeatherState = { configured: boolean; enabled: boolean; trip: SavedTrip; alerts: { id: string; date: string; message: string; status?: "current" | "resolved" | "stale" | "expired" }[] };
export function WeatherMonitoring({ trip, onUpdated, onPreview }: { trip: SavedTrip; onUpdated: (trip: SavedTrip) => void; onPreview: (date: string) => void }) {
  const [state, setState] = useState<WeatherState | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void apiFetch(`/api/trips/${trip.id}/weather-monitoring`, { signal: controller.signal }).then(r => readApiJson<WeatherState>(r)).then(setState).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [trip.id, trip.revision]);
  const toggle = async () => {
    if (!state) return;
    setBusy(true); setError("");
    try { const payload = await apiFetch(`/api/trips/${trip.id}/weather-monitoring`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !state.enabled, expected_revision: state.trip.revision }) }).then(r => readApiJson<WeatherState>(r)); setState(payload); onUpdated(payload.trip); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not update monitoring."); }
    finally { setBusy(false); }
  };
  return <section aria-label="Weather monitoring" className="mt-6 rounded-3xl border border-[#72d7dc]/25 bg-[#72d7dc]/5 p-5 text-white">
    <h3 className="text-xl">Weather watch</h3><p className="mt-2 text-sm text-white/75">Optional six-hour checks within the five-day forecast. In-app alerts only. Your itinerary never changes automatically.</p>
    {error && <p role="alert" className="mt-3 text-amber-100">{error}</p>}
    {state && <><button disabled={busy || (!state.configured && !state.enabled)} onClick={() => void toggle()} className="mt-4 min-h-11 rounded-full border border-white/25 px-5 disabled:opacity-50">{!state.configured ? "Not configured" : state.enabled ? "Turn off weather watch" : "Enable weather watch"}</button>
      {state.alerts.map(alert => <article key={alert.id} className="mt-4 rounded-xl border border-amber-200/25 p-4"><p className="mb-2 text-sm capitalize text-white/75">{alert.status || "stale"}</p><p>{alert.message}</p>{alert.status === "current" && state.enabled ? <button className="mt-3 min-h-11 rounded-full border border-white/25 px-4" onClick={() => onPreview(alert.date)}>Preview indoor-day recovery</button> : <p className="mt-2 text-sm text-white/75">Historical notice. No recovery action is suggested.</p>}</article>)}
    </>}
  </section>;
}
