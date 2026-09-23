import type { PlannerForm, PlannerOptions, ResultTab, StructuredItineraryData } from "../../domain/travel";
import { formatFlightPrice, getFlightAirlines } from "../search/shared";

export function TripOverview({ form, options, itinerary, onNavigate }: { form: PlannerForm; options: PlannerOptions; itinerary: StructuredItineraryData | null; onNavigate: (tab: ResultTab) => void }) {
  const flight = options.flights.find((offer) => offer.id === itinerary?.locked_flight_id);
  const stay = options.hotels.find((offer) => offer.id === itinerary?.locked_hotel_id);
  return <section aria-label="Trip overview" className="space-y-5 p-4 sm:p-6">
    <div><p className="text-xs uppercase tracking-widest text-[#a9dada]">Your travel workspace</p><h2 className="mt-2 text-3xl font-medium text-white">Make {form.destination} yours.</h2><p className="mt-2 text-sm text-white/65">Choose your journey, find your base, and shape each day.</p></div>
    <div className="grid gap-4 sm:grid-cols-2">
      <article className="rounded-3xl border border-[#72d7dc]/25 bg-gradient-to-br from-[#173e45] to-[#0e1518] p-5"><h3 className="text-sm text-[#a9f1f1]">Flight · {flight ? "selected" : "not selected"}</h3><p className="mt-3 text-2xl text-white">{flight ? formatFlightPrice(flight) : `${options.flights.length} options to explore`}</p><p className="mt-2 text-sm text-white/65">{flight ? getFlightAirlines(flight) : "Compare timing, stops and total price."}</p><button type="button" onClick={() => onNavigate("flights")} className="mt-4 min-h-11 rounded-full bg-[#72d7dc] px-5 text-sm text-[#06181a]">Explore flights</button></article>
      <article className="rounded-3xl border border-amber-200/20 bg-gradient-to-br from-[#393122] to-[#0e1518] p-5"><h3 className="text-sm text-amber-100">Stay · {stay ? "selected" : "not selected"}</h3><p className="mt-3 text-2xl text-white">{stay?.name || "Find your home base"}</p><p className="mt-2 text-sm text-white/65">{stay?.estimated_total != null ? `${stay.currency || form.currency_code} ${stay.estimated_total} estimated full stay` : "Compare stays and their locations."}</p><button type="button" onClick={() => onNavigate("hotels")} className="mt-4 min-h-11 rounded-full border border-amber-200/35 px-5 text-sm text-amber-100">Explore stays</button></article>
    </div>
    <section className="rounded-3xl border border-white/10 p-5"><div className="flex items-center justify-between gap-3"><h3 className="text-xl text-white">Your days at a glance</h3><button type="button" onClick={() => onNavigate("itinerary")} className="min-h-11 px-3 text-sm text-[#a9f1f1]">Open itinerary</button></div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">{(itinerary?.days || []).slice(0, 3).map((day) => <div key={day.day_number} className="rounded-2xl bg-white/5 p-4"><p className="text-xs text-[#a9dada]">Day {day.day_number}</p><p className="mt-2 text-sm text-white">{day.title}</p><p className="mt-2 text-xs text-white/60">{day.activities?.slice(0, 2).map((activity) => activity.title).join(" · ")}</p></div>)}</div>
      {!itinerary?.days?.length ? <p className="mt-3 text-sm text-white/65">Your daily plan will appear here when it is ready.</p> : null}
    </section>
  </section>;
}
