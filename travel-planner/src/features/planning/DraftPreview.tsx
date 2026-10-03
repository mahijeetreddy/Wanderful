import type { StructuredDayData } from "../../domain/travel";

export function DraftPreview({ days }: { days: StructuredDayData[] }) {
  if (!days.length) return null;
  return <section aria-label="Itinerary draft preview" className="draft-preview mt-4 rounded-2xl border border-sky-300/20 bg-sky-300/5 p-4">
    <h3 className="text-sm font-semibold text-sky-100">Your trip is taking shape</h3>
    <p className="mt-1 text-xs text-slate-300">Draft preview · details may change before completion</p>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {days.map(day => <article key={day.date} className="rounded-xl bg-slate-900/40 p-3">
        <h4 className="text-sm font-medium text-white">Day {day.day_number} · {day.title}</h4>
        <ul className="mt-2 space-y-1 text-xs text-slate-300">{(day.activities || []).map((activity, index) => <li key={index}>{activity.time ? `${activity.time} · ` : ""}{activity.title}</li>)}</ul>
      </article>)}
    </div>
  </section>;
}
