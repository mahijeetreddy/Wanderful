import { useEffect, useState } from "react";
import type { OfflineTripPack } from "../../domain/travel";
import { listOfflinePacks } from "./storage";

export function OfflineView() {
  const [packs, setPacks] = useState<OfflineTripPack[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const load = () => { void listOfflinePacks().then(values => { if (active) setPacks(values); }).catch(() => { if (active) setError("This browser could not open offline storage."); }); };
    load(); window.addEventListener("storage", load);
    return () => { active = false; window.removeEventListener("storage", load); };
  }, []);
  return <main className="min-h-screen bg-[#081416] px-5 py-12 text-white"><div className="mx-auto max-w-3xl">
    <p className="text-sm uppercase tracking-widest text-[#72d7dc]">Wanderful · Offline companion</p>
    <h1 className="mt-4 text-4xl">Your trip, within reach.</h1>
    <p className="my-5 text-white/75">Read-only saved plans. No live prices, documents, or offline map tiles. Reconnect and sign in before editing.</p>
    <a className="inline-flex min-h-11 items-center rounded-full border border-white/25 px-5" href="/">Back to online workspace</a>
    {error && <p role="alert" className="mt-6 text-amber-100">{error}</p>}
    {!packs.length && <p className="mt-8">No prepared trips on this device. Prepare one from your saved trip while online.</p>}
    {packs.map(pack => <article key={pack.trip.id} className="mt-8 rounded-3xl border border-[#72d7dc]/25 bg-white/5 p-6">
      <h2 className="text-3xl">{pack.trip.name || pack.trip.destination}</h2>
      <p className="mt-2 text-sm text-white/75">{pack.trip.date_range} · Saved {new Date(pack.generated_at).toLocaleString()}</p>
      {pack.days.map(day => <section key={day.day_number} className="mt-6">
        <h3 className="text-xl text-[#72d7dc]">Day {day.day_number} · {day.title}</h3>
        <ul className="mt-3 space-y-4">{(day.activities || []).map((activity, index) => <li key={index} className="rounded-2xl bg-black/20 p-4">
          <p className="text-sm text-white/75">{activity.time || activity.period || "Flexible"}</p><p className="mt-1 font-medium">{activity.title}</p>
          <p className="text-sm text-white/75">{activity.location}</p>{activity.schedule_conflict && <p className="mt-2 text-amber-100">{activity.schedule_conflict}</p>}
        </li>)}</ul>
      </section>)}
      {pack.essentials.packing.length > 0 && <details className="mt-6"><summary className="min-h-11 cursor-pointer py-3">Packing checklist</summary>
        <ul className="space-y-2">{pack.essentials.packing.map((item, index) => <li key={index}>{item}</li>)}</ul>
      </details>}
    </article>)}
  </div></main>;
}
