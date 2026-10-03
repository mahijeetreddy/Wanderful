import { useEffect, useState } from "react";
import { apiFetch } from "../../api/client";
import type { StructuredItineraryData } from "../../domain/travel";

type Place = { title: string; address: string; source_url: string; source_id: string; coordinates: { lat: number; lng: number } };
type Check = { date: string; activity_index: number; activity_title: string; activity_location: string; status: string; place: Place | null };
type Report = { research: { status: string; retrieved_at?: string }; checks: Check[] };

export function ResearchReview({ jobId, plan, onApply }: { jobId: string; plan: StructuredItineraryData; onApply: (plan: StructuredItineraryData) => void }) {
  const [report, setReport] = useState<Report | null>(null);
  const [open, setOpen] = useState(false);
  const [applied, setApplied] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let count = 0;
    setReport(null); setOpen(false); setApplied(false);
    async function poll() {
      try {
        const response = await apiFetch(`/api/plan-jobs/${encodeURIComponent(jobId)}/research`, { signal: controller.signal });
        if (!response.ok) throw new Error("Research unavailable");
        const value = await response.json() as Report;
        if (controller.signal.aborted) return;
        if (!value.research || !Array.isArray(value.checks)) throw new Error("Invalid research response");
        setReport(value);
        if (value.research.status === "pending") {
          if (++count < 30) timer = setTimeout(poll, 2000);
          else setReport({ research: { status: "unavailable" }, checks: [] });
        }
      } catch {
        if (!controller.signal.aborted) setReport({ research: { status: "unavailable" }, checks: [] });
      }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [jobId, refresh]);
  const matches = (report?.checks || []).filter(check => check.status === "place_identity_matched" && check.place);
  const eligible = matches.filter(check => {
    const activity = plan.days?.find(day => day.date === check.date)?.activities?.[check.activity_index];
    return activity?.title === check.activity_title && (activity.location || "") === check.activity_location;
  });
  function apply() {
    onApply({ ...plan, days: (plan.days || []).map(day => ({ ...day, activities: (day.activities || []).map((activity, index) => {
      const match = matches.find(check => check.date === day.date && check.activity_index === index && check.activity_title === activity.title && check.activity_location === (activity.location || ""));
      return match?.place ? { ...activity, coordinates: match.place.coordinates, source_id: match.place.source_id, source_url: match.place.source_url } : activity;
    }) })) });
    setApplied(true);
  }
  const status = report?.research.status || "pending";
  return <section aria-label="Place research" className="draft-preview mb-4 rounded-2xl border border-sky-300/20 bg-sky-300/5 p-4 text-sm text-slate-200">
    <h3 className="font-semibold">{status === "pending" ? "Draft itinerary · place checks in progress" : status === "success" ? "Place checks available" : "Draft itinerary · place research unavailable"}</h3>
    <p className="mt-1 text-xs">Opening hours, admission prices and travel times remain unverified. Research never changes your trip automatically.</p>
    {report?.research.retrieved_at && <p className="mt-1 text-xs">Sources retrieved {new Date(report.research.retrieved_at).toLocaleString()}</p>}
    {status === "success" && <button type="button" className="action-button mt-2" aria-expanded={open} onClick={() => setOpen(value => !value)}>Review place checks ({matches.length})</button>}
    {status !== "pending" && status !== "success" && <button type="button" className="action-button mt-2" onClick={() => setRefresh(value => value + 1)}>Check again</button>}
    {open && <div className="mt-3 space-y-3">
      {!matches.length && <p>No confident matches for this itinerary. Keep these activities marked unverified.</p>}
      {matches.map(check => <article key={`${check.date}-${check.activity_index}`}><p>{check.activity_title}</p><a className="underline" href={check.place!.source_url} target="_blank" rel="noreferrer">{check.place!.title} · {check.place!.address}</a></article>)}
      {!!matches.length && <button type="button" className="action-button" disabled={applied || !eligible.length} onClick={apply}>{applied ? "Place references applied · save your trip to keep them" : !eligible.length ? "These checks no longer match your edited draft" : "Apply reviewed map references"}</button>}
    </div>}
  </section>;
}
