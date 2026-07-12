import { useEffect, useState } from "react";
import { Clock, Loader2, RotateCcw, XCircle } from "lucide-react";
import { apiFetch, readApiJson } from "../../api/client";

type PlanJobSummary = { id: string; status: string; progress: string; error?: string; created_at: string };

export function JobHistoryPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [jobs, setJobs] = useState<PlanJobSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = async () => {
    setLoading(true);
    try {
      const payload = await readApiJson<{ jobs: PlanJobSummary[] }>(await apiFetch("/api/plan-jobs"));
      setJobs(payload.jobs || []);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load job history.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (open) void refresh();
  }, [open]);
  if (!open) return null;

  const cancel = async (jobId: string) => {
    try {
      await readApiJson(await apiFetch(`/api/plan-jobs/${jobId}/cancel`, { method: "POST" }));
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not cancel job.");
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/68 backdrop-blur-md" onClick={onClose}>
      <aside className="absolute right-0 top-0 h-full w-[min(95vw,500px)] overflow-auto border-l border-white/12 bg-black/94 p-5" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-[10px] uppercase tracking-[0.18em] text-white/45">Operations</p><h2 className="mt-2 flex items-center gap-2 text-3xl font-medium text-white"><Clock size={24} /> Plan jobs</h2></div>
          <button type="button" onClick={onClose} className="rounded-full border border-white/12 px-3 py-2 text-sm text-white/68">Close</button>
        </div>
        <button type="button" onClick={refresh} className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/12 px-3 py-2 text-sm text-white/68"><RotateCcw size={14} /> Refresh</button>
        {error ? <p className="mt-4 text-sm text-red-100">{error}</p> : null}
        {loading ? <Loader2 className="mx-auto mt-8 animate-spin text-white/60" /> : null}
        <div className="mt-5 space-y-3">
          {jobs.map((job) => (
            <article key={job.id} className="rounded-[22px] border border-white/10 bg-white/[0.055] p-4">
              <div className="flex items-center justify-between gap-3"><span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.12em] text-white/62">{job.status}</span><span className="text-xs text-white/38">{new Date(job.created_at).toLocaleString()}</span></div>
              <p className="mt-3 text-sm text-white/68">{job.progress}</p>
              {job.error ? <p className="mt-2 text-xs leading-relaxed text-red-100/72">{job.error}</p> : null}
              {["queued", "collecting", "planning"].includes(job.status) ? <button type="button" onClick={() => cancel(job.id)} className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-red-200/14 px-3 py-1.5 text-sm text-red-50/70"><XCircle size={14} /> Cancel</button> : null}
            </article>
          ))}
        </div>
      </aside>
    </div>
  );
}
