import { useEffect, useState } from "react";
import { AlertTriangle, CalendarDays, Loader2, MapPin, Sparkles, Wallet } from "lucide-react";
import { apiFetch, readApiJson } from "../../api/client";

type ActivityBlock = {
  time?: string;
  title: string;
  description?: string;
  location?: string;
  estimated_cost?: number;
};

type StructuredDay = {
  day_number: number;
  date?: string;
  title: string;
  summary?: string;
  activities?: ActivityBlock[];
};

type BudgetCategory = { category: string; amount: number; note?: string };

type StructuredItineraryData = {
  trip_summary?: string;
  currency_code?: string;
  budget_categories?: BudgetCategory[];
  estimated_total?: number;
  days?: StructuredDay[];
  packing_list?: string[];
  logistics?: string[];
  risks?: string[];
};

type PublicTrip = {
  name: string;
  destination: string;
  dateRange: string;
  itinerary: string;
  structuredItinerary?: StructuredItineraryData;
};

export function SharedTripView({ token }: { token: string }) {
  const [trip, setTrip] = useState<PublicTrip | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await apiFetch(`/api/share/${token}`);
        const payload = await readApiJson<{ trip: PublicTrip }>(response);
        if (!cancelled) setTrip(payload.trip);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "This share link is invalid or no longer active.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const itinerary = trip?.structuredItinerary;
  const currency = itinerary?.currency_code || "USD";

  return (
    <div className="min-h-screen bg-[#0e1518] px-4 py-10 sm:px-8">
      <div className="mx-auto max-w-3xl">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-24 text-white/58">
            <Loader2 className="animate-spin" size={20} /> Loading trip...
          </div>
        ) : null}

        {!loading && (error || !trip) ? (
          <div className="mt-16 rounded-[28px] border border-red-200/16 bg-red-300/10 p-8 text-center">
            <AlertTriangle className="mx-auto text-red-100" size={28} />
            <p className="mt-4 text-lg font-medium text-white">This link isn't available</p>
            <p className="mt-2 text-sm text-red-50/80">
              {error || "This share link is invalid or no longer active."}
            </p>
            <a
              href="/"
              className="mt-6 inline-block rounded-full bg-[#3fb6c4] px-5 py-2.5 text-sm font-medium text-[#06181a]"
            >
              Plan your own trip with Wanderful
            </a>
          </div>
        ) : null}

        {!loading && trip ? (
          <>
            <header className="rounded-[32px] border border-[#3fb6c4]/12 bg-[#0e1518]/64 p-6 sm:p-8">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/45">Shared trip</p>
              <h1 className="mt-2 text-4xl font-medium tracking-[-0.04em] text-white sm:text-5xl">{trip.name}</h1>
              <div className="mt-4 flex flex-wrap gap-4 text-sm text-white/62">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin size={15} /> {trip.destination}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays size={15} /> {trip.dateRange}
                </span>
              </div>
              {itinerary?.trip_summary ? (
                <p className="mt-5 text-sm leading-relaxed text-white/72">{itinerary.trip_summary}</p>
              ) : null}
            </header>

            {itinerary?.budget_categories?.length ? (
              <section className="mt-5 rounded-[28px] border border-[#3fb6c4]/12 bg-[#3fb6c4]/[0.05] p-6">
                <p className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-white/45">
                  <Wallet size={13} /> Budget breakdown
                </p>
                <div className="mt-4 space-y-2">
                  {itinerary.budget_categories.map((category) => (
                    <div key={category.category} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-white/72">{category.category}</span>
                      <span className="font-medium text-white">
                        {currency} {category.amount.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
                {typeof itinerary.estimated_total === "number" ? (
                  <div className="mt-4 flex items-center justify-between border-t border-[#3fb6c4]/10 pt-3 text-sm font-medium">
                    <span className="text-white">Estimated total</span>
                    <span className="text-white">
                      {currency} {itinerary.estimated_total.toFixed(2)}
                    </span>
                  </div>
                ) : null}
              </section>
            ) : null}

            {itinerary?.days?.length ? (
              <section className="mt-5 space-y-4">
                <p className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-white/45">
                  <Sparkles size={13} /> Day-by-day plan
                </p>
                {itinerary.days.map((day) => (
                  <article
                    key={day.day_number}
                    className="card-hover card-enter rounded-[26px] border border-[#3fb6c4]/12 bg-[#0e1518]/58 p-5"
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
                      Day {day.day_number}
                      {day.date ? ` - ${day.date}` : ""}
                    </p>
                    <h3 className="mt-2 text-xl font-medium tracking-[-0.03em] text-white">{day.title}</h3>
                    {day.summary ? <p className="mt-2 text-sm leading-relaxed text-white/62">{day.summary}</p> : null}
                    {day.activities?.length ? (
                      <div className="mt-4 space-y-2">
                        {day.activities.map((activity, index) => (
                          <div
                            key={`${day.day_number}-${index}`}
                            className="rounded-2xl border border-[#3fb6c4]/10 bg-[#3fb6c4]/[0.04] px-3 py-2.5"
                          >
                            <div className="flex items-baseline justify-between gap-3">
                              <p className="text-sm font-medium text-white">
                                {activity.time ? `${activity.time} - ` : ""}
                                {activity.title}
                              </p>
                              {activity.estimated_cost ? (
                                <span className="shrink-0 text-xs text-white/50">
                                  {currency} {activity.estimated_cost.toFixed(2)}
                                </span>
                              ) : null}
                            </div>
                            {activity.description ? (
                              <p className="mt-1 text-sm leading-relaxed text-white/62">{activity.description}</p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))}
              </section>
            ) : null}

            {itinerary?.packing_list?.length || itinerary?.logistics?.length || itinerary?.risks?.length ? (
              <section className="mt-5 grid gap-4 sm:grid-cols-2">
                <SimpleListCard title="Packing list" items={itinerary?.packing_list} />
                <SimpleListCard title="Logistics" items={itinerary?.logistics} />
                <SimpleListCard title="Risks and notes" items={itinerary?.risks} />
              </section>
            ) : null}

            <div className="mt-10 text-center">
              <a
                href="/"
                className="inline-block rounded-full border border-[#3fb6c4]/16 px-5 py-2.5 text-sm text-white/72 hover:bg-[#3fb6c4]/10"
              >
                Plan your own trip with Wanderful
              </a>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function SimpleListCard({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <article className="rounded-[24px] border border-[#3fb6c4]/12 bg-[#0e1518]/58 p-5">
      <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/45">{title}</p>
      <ul className="mt-3 space-y-1.5">
        {items.map((item, index) => (
          <li key={index} className="text-sm leading-relaxed text-white/68">
            {item}
          </li>
        ))}
      </ul>
    </article>
  );
}
