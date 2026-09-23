import type { FlightOption } from "../../domain/travel";
import { formatFlightDuration } from "../search/shared";
import { airportTime, arrivalDayChange, journeyLegs } from "./journey";

export function FlightJourney({ offer }: { offer: FlightOption }) {
  const legs = journeyLegs(offer);
  if (!legs.length) return <p className="mt-4 rounded-2xl border border-white/10 p-4 text-sm text-white/65">Leg timing is incomplete. Open Flight details to inspect the supplied segments.</p>;
  return <div className="mt-4 space-y-3" aria-label="Flight journey summary">
    {legs.map((leg) => {
      const first = leg.segments[0]; const last = leg.segments[leg.segments.length - 1];
      const change = arrivalDayChange(first.depart_at, last.arrive_at);
      return <section key={leg.label} aria-label={leg.label} className="rounded-2xl border border-[#72d7dc]/20 bg-[#72d7dc]/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-xs font-medium uppercase tracking-widest text-[#a9f1f1]">{leg.label}</h3><span className="text-xs text-white/65">{leg.segments.length === 1 ? "Nonstop" : `${leg.segments.length - 1} stop(s)`} · {formatFlightDuration(leg.duration)}</span></div>
        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-start gap-3"><div><p className="text-xl text-white">{first.from || "Airport unknown"}</p><p className="mt-1 text-sm text-white/75">{airportTime(first.depart_at)}</p></div><span aria-hidden="true" className="pt-1 text-[#72d7dc]">→</span><div className="text-right"><p className="text-xl text-white">{last.to || "Airport unknown"}</p><p className="mt-1 text-sm text-white/75">{airportTime(last.arrive_at)}</p>{change !== null && change !== 0 ? <p className="mt-1 text-xs text-amber-100">{change > 0 ? "+" : ""}{change} calendar day{Math.abs(change) === 1 ? "" : "s"}</p> : null}</div></div>
        {leg.segments.length > 1 ? <p className="mt-3 text-xs text-white/65">Via {leg.segments.slice(0, -1).map((segment) => segment.to || "unknown airport").join(" · ")}</p> : null}
      </section>;
    })}
    <p className="text-xs text-white/50">Airport dates and times as supplied by the provider.</p>
  </div>;
}
